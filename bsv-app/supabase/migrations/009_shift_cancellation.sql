begin;

create table public.shift_cancellations (
  shift_id text primary key check (shift_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  cancelled_at timestamptz not null,
  cancelled_by uuid references public.members(id) on delete set null,
  reason text check (reason is null or length(btrim(reason)) between 1 and 160),
  reactivated_at timestamptz
);
alter table public.shift_cancellations enable row level security;
revoke all on public.shift_cancellations from public, anon, authenticated, service_role;

create or replace function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object('version',state.version,
    'shifts',coalesce((
      select jsonb_agg(shift || jsonb_build_object('cancellation',case
        when cancellation.cancelled_at is not null and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at)
          then jsonb_build_object('cancelledAt',cancellation.cancelled_at,'cancelledBy',cancellation.cancelled_by,'reason',cancellation.reason)
        else 'null'::jsonb end) order by entry.position)
      from jsonb_array_elements(state.data) with ordinality as entry(shift,position)
      left join public.shift_cancellations cancellation on cancellation.shift_id = shift->>'id'
      where actor.role = 'admin' or ((shift->>'published')::boolean and not (
        cancellation.cancelled_at is not null and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at)
      ))
    ),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',member.id,'name',member.name,
      'active',member.account_status <> 'deaktiviert' and member.archived_at is null,'qualifications',member.qualifications,
      'status',member.status,'winterActive',member.winter_active,'summerActive',member.summer_active)
      || case when actor.role = 'admin' then jsonb_build_object('email',member.email,'role',member.role) else '{}'::jsonb end order by member.name,member.id)
      from public.members as member where member.archived_at is null or exists(select 1 from bsv_private.task_windows(state.data) as task_window
        where task_window.task->>'memberId' = member.id::text)),'[]'::jsonb),
    'planningPeriods',coalesce((select jsonb_object_agg(to_char(month,'YYYY-MM'),status) from public.planning_periods),'{}'::jsonb))
  from public.schedule_state as state where state.id = 1;
$$;

create function bsv_private.queue_shift_notice(notice_type text, next_version bigint, shift jsonb, reason text)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare assigned record; changed_at text;
begin
  if notice_type not in ('cancelled','reactivated') then raise exception 'Invalid notice type'; end if;
  changed_at := to_char(statement_timestamp() at time zone 'Europe/Berlin','YYYY-MM-DD HH24:MI:SS');
  for assigned in
    select member.id,member.name,member.email,string_agg(task_entry.value->>'name',', ' order by task_entry.value->>'name') as task_names
    from jsonb_array_elements(shift->'tasks') as task_entry(value)
    join public.members as member on member.id = (task_entry.value->>'memberId')::uuid
    where task_entry.value->'memberId' <> 'null'::jsonb and member.email is not null
    group by member.id,member.name,member.email
  loop
    insert into public.notification_outbox(event_key,recipient,payload) values (
      case when notice_type = 'cancelled' then 'cancel:' else 'reactivate:' end || next_version::text || ':' || (shift->>'id') || ':' || assigned.id::text,
      assigned.email,
      jsonb_build_object('type',notice_type,'memberName',assigned.name,'taskNames',assigned.task_names,
        'shiftTitle',shift->>'title','shiftId',shift->>'id','date',shift->>'date','start',shift->>'start','end',shift->>'end',
        'reason',reason,'changedAt',changed_at)
    ) on conflict (event_key) do nothing;
  end loop;
end;
$$;

create function public.manage_shift(expected_version bigint, action text, shift_id text, reason text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; target jsonb; new_data jsonb; previous_reason text;
  target_shift_id text := shift_id; cancellation_reason text := reason;
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if actor.role <> 'admin' then raise exception 'Administrator required' using errcode = '42501'; end if;
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  if action not in ('deleteDraft','cancelShift','reactivateShift') or target_shift_id is null or target_shift_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'Invalid shift action' using errcode = '22023';
  end if;
  select value into target from jsonb_array_elements(state.data) as entry(value) where value->>'id' = target_shift_id;
  if target is null then raise exception 'Shift not found' using errcode = '22023'; end if;

  if action = 'deleteDraft' then
    if (target->>'published')::boolean then raise exception 'Published shifts must be cancelled, not deleted' using errcode = '22023'; end if;
    if bsv_private.local_instant(target->>'date',target->>'start') <= statement_timestamp() then
      raise exception 'Past drafts are retained as history' using errcode = '22023';
    end if;
    if exists(select 1 from public.planning_periods where month = date_trunc('month',(target->>'date')::date)::date and status = 'closed') then
      raise exception 'Planning period is closed' using errcode = '55000';
    end if;
    select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into new_data
      from jsonb_array_elements(state.data) with ordinality as entry(value,position) where value->>'id' <> target_shift_id;
    delete from public.shift_cancellations where shift_cancellations.shift_id = target_shift_id;
    update public.schedule_state set data = new_data,version = state.version + 1 where id = 1;
  elsif action = 'cancelShift' then
    if not (target->>'published')::boolean then raise exception 'Only published shifts can be cancelled' using errcode = '22023'; end if;
    if bsv_private.local_instant(target->>'date',target->>'start') <= statement_timestamp() then
      raise exception 'Past shifts cannot be cancelled' using errcode = '22023';
    end if;
    if cancellation_reason is not null and length(btrim(cancellation_reason)) not between 1 and 160 then raise exception 'Invalid cancellation reason' using errcode = '22023'; end if;
    if exists(select 1 from public.shift_cancellations where shift_cancellations.shift_id = target_shift_id
      and (reactivated_at is null or reactivated_at < cancelled_at)) then raise exception 'Shift is already cancelled' using errcode = '22023'; end if;
    insert into public.shift_cancellations(shift_id,cancelled_at,cancelled_by,reason,reactivated_at)
      values (target_shift_id,statement_timestamp(),actor.id,nullif(btrim(cancellation_reason),''),null)
      on conflict on constraint shift_cancellations_pkey do update set cancelled_at = excluded.cancelled_at,cancelled_by = excluded.cancelled_by,
        reason = excluded.reason,reactivated_at = null;
    perform bsv_private.queue_shift_notice('cancelled',state.version + 1,target,nullif(btrim(cancellation_reason),''));
    update public.schedule_state set version = state.version + 1 where id = 1;
  else
    if not (target->>'published')::boolean then raise exception 'Drafts cannot be reactivated' using errcode = '22023'; end if;
    if bsv_private.local_instant(target->>'date',target->>'start') <= statement_timestamp() then
      raise exception 'Past shifts cannot be reactivated' using errcode = '22023';
    end if;
    update public.shift_cancellations set reactivated_at = statement_timestamp()
      where shift_cancellations.shift_id = target_shift_id
        and (reactivated_at is null or reactivated_at < cancelled_at)
      returning public.shift_cancellations.reason into previous_reason;
    if not found then raise exception 'Shift is not cancelled' using errcode = '22023'; end if;
    perform bsv_private.queue_shift_notice('reactivated',state.version + 1,target,previous_reason);
    update public.schedule_state set version = state.version + 1 where id = 1;
  end if;
  return bsv_private.snapshot(actor);
end;
$$;

create function bsv_private.guard_cancelled_shift_mutations() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if old.data is distinct from new.data and exists (
    select 1 from jsonb_array_elements(old.data) as old_entry(shift)
    join public.shift_cancellations cancellation on cancellation.shift_id = old_entry.shift->>'id'
    where (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at)
      and not (
        auth.uid() is null and exists (
        select 1 from jsonb_array_elements(new.data) as new_entry(shift)
        where new_entry.shift->>'id' = old_entry.shift->>'id'
          and new_entry.shift - 'tasks' = old_entry.shift - 'tasks'
          and jsonb_array_length(new_entry.shift->'tasks') = jsonb_array_length(old_entry.shift->'tasks')
          and not exists (
            select 1 from jsonb_array_elements(old_entry.shift->'tasks') with ordinality as old_task(value,position)
            left join jsonb_array_elements(new_entry.shift->'tasks') with ordinality as new_task(value,position) using (position)
            where new_task.value is null
              or new_task.value - 'memberId' is distinct from old_task.value - 'memberId'
              or (new_task.value->'memberId' <> 'null'::jsonb and new_task.value->'memberId' is distinct from old_task.value->'memberId')
          )
            )
      )
  ) then
    raise exception 'Cancelled shifts cannot be changed before reactivation' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger schedule_guard_cancelled_shifts before update of data on public.schedule_state
  for each row execute function bsv_private.guard_cancelled_shift_mutations();

create or replace function public.set_month_phase(expected_version bigint, month_key text, next_phase text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; month_start date;
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if actor.role <> 'admin' then raise exception 'Administrator required' using errcode = '42501'; end if;
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  if month_key is null or month_key !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' or next_phase is null or next_phase not in ('open', 'closed') then
    raise exception 'Invalid month phase' using errcode = '22023';
  end if;
  month_start := (month_key || '-01')::date;
  if not exists (select 1 from jsonb_array_elements(state.data) shift where (shift->>'date')::date >= month_start and (shift->>'date')::date < month_start + interval '1 month') then
    raise exception 'No shifts for this month' using errcode = '22023';
  end if;
  if next_phase = 'closed' then
    if exists (
      select 1 from jsonb_array_elements(state.data) as entry(shift)
      where (entry.shift->>'date')::date >= month_start and (entry.shift->>'date')::date < month_start + interval '1 month'
        and bsv_private.local_instant(entry.shift->>'date',entry.shift->>'start') > statement_timestamp()
        and not exists (select 1 from public.shift_cancellations cancellation where cancellation.shift_id = entry.shift->>'id'
          and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at))
        and ((entry.shift->>'published')::boolean is false or exists (
          select 1 from jsonb_array_elements(entry.shift->'tasks') task
          where task->'memberId' = 'null'::jsonb
            and bsv_private.local_instant(entry.shift->>'date',entry.shift->>'start')
              + (task->>'offsetMinutes')::integer * interval '1 minute' > statement_timestamp()
        ))) then
      raise exception 'All future shifts must be published and fully assigned' using errcode = '22023';
    end if;
    insert into public.planning_periods(month,status) values (month_start,'closed')
      on conflict (month) do update set status = 'closed';
  else
    if not exists (select 1 from public.planning_periods where month = month_start and status = 'closed') then
      raise exception 'Only closed months can be reopened' using errcode = '22023';
    end if;
    update public.planning_periods set status = 'open' where month = month_start;
  end if;
  update public.schedule_state set version = state.version + 1 where id = 1;
  return bsv_private.snapshot(actor);
end;
$$;

revoke all on public.shift_cancellations from public,anon,authenticated,service_role;
revoke all on function bsv_private.queue_shift_notice(text,bigint,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.manage_shift(bigint,text,text,text) from public,anon,authenticated,service_role;
revoke all on function bsv_private.guard_cancelled_shift_mutations() from public,anon,authenticated,service_role;
revoke all on function public.set_month_phase(bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.manage_shift(bigint,text,text,text) to authenticated;
grant execute on function public.set_month_phase(bigint,text,text) to authenticated;

commit;
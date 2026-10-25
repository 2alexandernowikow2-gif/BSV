begin;

create table public.planning_periods (
  month date primary key check (extract(day from month) = 1),
  status text not null check (status in ('draft', 'open', 'closed'))
);
alter table public.planning_periods enable row level security;
revoke all on public.planning_periods from public, anon, authenticated, service_role;

insert into public.planning_periods(month, status)
select date_trunc('month', (shift->>'date')::date)::date,
  case when bool_or((shift->>'published')::boolean) then 'open' else 'draft' end
from public.schedule_state state
cross join lateral jsonb_array_elements(state.data) as entry(shift)
where state.id = 1
group by 1
on conflict (month) do nothing;

create or replace function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'version', state.version,
    'shifts', case when actor.role = 'admin' then state.data else
      coalesce((select jsonb_agg(shift order by position) from jsonb_array_elements(state.data) with ordinality as entry(shift, position)
        where (shift->>'published')::boolean), '[]'::jsonb) end,
    'members', coalesce((select jsonb_agg(case when actor.role = 'admin' then to_jsonb(member)
      else jsonb_build_object('id', member.id, 'name', member.name, 'active', member.active, 'qualifications', member.qualifications) end order by member.name, member.id)
      from public.members as member where actor.role = 'admin' or member.active or exists (
        select 1 from bsv_private.task_windows(state.data) as task_window
        where (task_window.shift->>'published')::boolean and task_window.task->>'memberId' = member.id::text
      )), '[]'::jsonb),
    'planningPeriods', coalesce((select jsonb_object_agg(to_char(month, 'YYYY-MM'), status) from public.planning_periods), '{}'::jsonb)
  )
  from public.schedule_state as state where state.id = 1;
$$;

create function bsv_private.guard_closed_planning_period() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare old_shift jsonb; new_shift jsonb;
begin
  if old.data is distinct from new.data then
    for old_shift in
      select value from jsonb_array_elements(old.data) as entry(value)
      join public.planning_periods period on period.month = date_trunc('month', (value->>'date')::date)::date
      where period.status = 'closed'
    loop
      select value into new_shift from jsonb_array_elements(new.data) as entry(value)
        where value->>'id' = old_shift->>'id';
      if new_shift is distinct from old_shift then
        raise exception 'Planning period % is closed', left(old_shift->>'date', 7) using errcode = '55000';
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(new.data) as entry(value)
      join public.planning_periods period on period.month = date_trunc('month', (value->>'date')::date)::date
      where period.status = 'closed'
        and not exists (select 1 from jsonb_array_elements(old.data) prior where prior->>'id' = value->>'id')
    ) then
      raise exception 'Cannot add shifts to a closed planning period' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
create trigger schedule_state_guard_closed_period
before update of data on public.schedule_state
for each row execute function bsv_private.guard_closed_planning_period();

create function bsv_private.sync_planning_periods() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.planning_periods(month, status)
  select date_trunc('month', (shift->>'date')::date)::date,
    case when bool_or((shift->>'published')::boolean) then 'open' else 'draft' end
  from jsonb_array_elements(new.data) as entry(shift)
  group by 1
  on conflict (month) do update set status = case
    when public.planning_periods.status = 'closed' then 'closed'
    when public.planning_periods.status = 'open' then 'open'
    when excluded.status = 'open' then 'open'
    else 'draft' end;
  return new;
end;
$$;
create trigger schedule_state_sync_planning_periods
after update of data on public.schedule_state
for each row execute function bsv_private.sync_planning_periods();

create function public.set_month_phase(expected_version bigint, month_key text, next_phase text)
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
      where (shift->>'date')::date >= month_start and (shift->>'date')::date < month_start + interval '1 month'
        and bsv_private.local_instant(shift->>'date', shift->>'start') > statement_timestamp()
        and ((shift->>'published')::boolean is false or exists (
          select 1 from jsonb_array_elements(shift->'tasks') task
          where task->'memberId' = 'null'::jsonb
            and bsv_private.local_instant(shift->>'date', shift->>'start')
              + (task->>'offsetMinutes')::integer * interval '1 minute' > statement_timestamp()
        ))) then
      raise exception 'All future shifts must be published and fully assigned' using errcode = '22023';
    end if;
    insert into public.planning_periods(month, status) values (month_start, 'closed')
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

revoke all on all functions in schema bsv_private from public, anon, authenticated, service_role;
revoke all on function public.set_month_phase(bigint,text,text) from public, anon, authenticated, service_role;
grant execute on function public.load_schedule(), public.mutate_schedule(bigint,jsonb), public.set_month_phase(bigint,text,text) to authenticated;

commit;

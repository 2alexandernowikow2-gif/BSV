begin;

create schema if not exists bsv_private;
revoke all on schema bsv_private from public, anon, authenticated;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  email text check (email is null or (length(email) <= 254 and email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$')),
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  qualifications text[] not null default '{}'
);

create table public.schedule_state (
  id integer primary key default 1 check (id = 1),
  version bigint not null default 0 check (version >= 0),
  data jsonb not null default '[]'::jsonb check (jsonb_typeof(data) = 'array')
);
insert into public.schedule_state(id) values (1);

create table public.admin_settings (
  id integer primary key default 1 check (id = 1),
  email text not null check (length(email) <= 254 and email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$')
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_ready on public.notification_outbox(next_attempt_at)
  where status in ('pending', 'processing');

alter table public.members enable row level security;
alter table public.schedule_state enable row level security;
alter table public.admin_settings enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on public.members, public.schedule_state, public.admin_settings, public.notification_outbox from public, anon, authenticated, service_role;

create function bsv_private.actor() returns public.members
language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor public.members;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into actor from public.members where user_id = auth.uid() and active;
  if not found then
    raise exception 'Active linked member required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function bsv_private.exact_keys(value jsonb, keys text[]) returns void
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(value) as entry(key) where not (key = any(keys))
  ) then
    raise exception 'Invalid object or unsupported fields' using errcode = '22023';
  end if;
end;
$$;

create function bsv_private.local_instant(local_date text, local_time text) returns timestamptz
language plpgsql immutable set search_path = pg_catalog as $$
declare local_value timestamp; instant timestamptz;
begin
  if local_date is null or local_date !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$'
    or local_time is null or local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid ISO date or HH:mm time' using errcode = '22023';
  end if;
  local_value := (local_date || ' ' || local_time)::timestamp;
  if to_char(local_value, 'YYYY-MM-DD HH24:MI') <> local_date || ' ' || local_time then
    raise exception 'Invalid local datetime' using errcode = '22023';
  end if;
  instant := local_value at time zone 'Europe/Berlin';
  if instant at time zone 'Europe/Berlin' <> local_value
    or (instant - interval '1 hour') at time zone 'Europe/Berlin' = local_value
    or (instant + interval '1 hour') at time zone 'Europe/Berlin' = local_value then
    raise exception 'Nonexistent or ambiguous Berlin local time' using errcode = '22023';
  end if;
  return instant;
end;
$$;

create function bsv_private.task_windows(shifts jsonb)
returns table(shift jsonb, task jsonb, starts_at timestamptz, ends_at timestamptz)
language sql immutable set search_path = pg_catalog as $$
  select shift, task,
    bsv_private.local_instant(shift->>'date', shift->>'start') + (task->>'offsetMinutes')::integer * interval '1 minute',
    case when task->'durationMinutes' = 'null'::jsonb
      then bsv_private.local_instant(shift->>'date', shift->>'end')
      else bsv_private.local_instant(shift->>'date', shift->>'start')
        + ((task->>'offsetMinutes')::integer + (task->>'durationMinutes')::integer) * interval '1 minute' end
  from jsonb_array_elements(shifts) as shifts_entry(shift)
  cross join lateral jsonb_array_elements(shift->'tasks') as tasks_entry(task);
$$;

create function bsv_private.validate_state(shifts jsonb) returns void
language plpgsql set search_path = pg_catalog as $$
declare shift jsonb; task jsonb; shift_ids text[] := '{}'; task_ids text[] := '{}';
  starts_at timestamptz; ends_at timestamptz; assigned public.members;
begin
  if jsonb_typeof(shifts) is distinct from 'array' or jsonb_array_length(shifts) > 5000 then
    raise exception 'Expected shifts array, maximum 5000' using errcode = '22023';
  end if;
  for shift in select value from jsonb_array_elements(shifts) loop
    perform bsv_private.exact_keys(shift, array['id','date','title','kind','start','end','published','tasks']);
    if not (shift ?& array['id','date','title','kind','start','end','published','tasks'])
      or jsonb_typeof(shift->'id') <> 'string' or (shift->>'id') !~ '^[A-Za-z0-9_-]{1,100}$'
      or shift->>'id' = any(shift_ids)
      or jsonb_typeof(shift->'date') <> 'string' or jsonb_typeof(shift->'start') <> 'string'
      or jsonb_typeof(shift->'end') <> 'string'
      or jsonb_typeof(shift->'title') <> 'string' or length(btrim(shift->>'title')) not between 1 and 160
      or jsonb_typeof(shift->'kind') <> 'string' or length(btrim(shift->>'kind')) not between 1 and 80
      or jsonb_typeof(shift->'published') <> 'boolean' or jsonb_typeof(shift->'tasks') <> 'array' then
      raise exception 'Invalid shift' using errcode = '22023';
    end if;
    shift_ids := array_append(shift_ids, shift->>'id');
    starts_at := bsv_private.local_instant(shift->>'date', shift->>'start');
    ends_at := bsv_private.local_instant(shift->>'date', shift->>'end');
    if shift->>'start' >= shift->>'end' or starts_at >= ends_at then
      raise exception 'Shift must end on the same date after start' using errcode = '22023';
    end if;
    if jsonb_array_length(shift->'tasks') not between 1 and 32 then
      raise exception 'Expected 1 to 32 tasks per shift' using errcode = '22023';
    end if;
    for task in select value from jsonb_array_elements(shift->'tasks') loop
      perform bsv_private.exact_keys(task, array['id','name','qualification','offsetMinutes','durationMinutes','memberId']);
      if not (task ?& array['id','name','qualification','offsetMinutes','durationMinutes','memberId'])
        or jsonb_typeof(task->'id') <> 'string' or (task->>'id') !~ '^[A-Za-z0-9_-]{1,100}$'
        or task->>'id' = any(task_ids)
        or jsonb_typeof(task->'name') <> 'string' or length(btrim(task->>'name')) not between 1 and 120
        or (task->'qualification' <> 'null'::jsonb and (jsonb_typeof(task->'qualification') <> 'string'
          or length(btrim(task->>'qualification')) not between 1 and 80))
        or task->'offsetMinutes' <> '0'::jsonb
        or task->'durationMinutes' not in ('null'::jsonb, '120'::jsonb)
        or (task->'memberId' <> 'null'::jsonb and jsonb_typeof(task->'memberId') <> 'string') then
        raise exception 'Invalid task' using errcode = '22023';
      end if;
      task_ids := array_append(task_ids, task->>'id');
      if task->'durationMinutes' = '120'::jsonb and starts_at + interval '120 minutes' > ends_at then
        raise exception '120-minute task does not fit shift' using errcode = '22023';
      end if;
      if task->'memberId' <> 'null'::jsonb then
        select * into assigned from public.members where id = (task->>'memberId')::uuid;
        if not found then
          raise exception 'Unknown assigned member' using errcode = '22023';
        end if;
        if starts_at > statement_timestamp() and (not assigned.active or
          (task->'qualification' <> 'null'::jsonb and not (task->>'qualification' = any(assigned.qualifications)))) then
          raise exception 'Assigned member inactive or unqualified' using errcode = '22023';
        end if;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from bsv_private.task_windows(shifts) as first_task
    join bsv_private.task_windows(shifts) as second_task
      on first_task.task->>'id' < second_task.task->>'id'
      and (first_task.task->>'memberId')::uuid = (second_task.task->>'memberId')::uuid
      and first_task.starts_at < second_task.ends_at and second_task.starts_at < first_task.ends_at
  ) then
    raise exception 'Overlapping member assignments' using errcode = '23P01';
  end if;
  if exists (select 1 from jsonb_array_elements(shifts) as entry(shift) where (entry.shift->>'published')::boolean)
    and not exists (select 1 from public.admin_settings where id = 1) then
    raise exception 'Notification recipient required before publication' using errcode = '22023';
  end if;
end;
$$;

create function bsv_private.snapshot(actor public.members) returns jsonb
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
      )), '[]'::jsonb))
  from public.schedule_state as state where state.id = 1;
$$;

create function public.load_schedule() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members;
begin
  perform 1 from public.schedule_state where id = 1 for share;
  actor := bsv_private.actor();
  return bsv_private.snapshot(actor);
end;
$$;

create function public.mutate_schedule(expected_version bigint, command jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; shifts jsonb; operation text;
  shift jsonb; task jsonb; replacement jsonb; entry jsonb; update_entry jsonb; member_data jsonb;
  target_shift integer; target_task integer; shift_position integer; task_position integer;
  target_member uuid; recipient text; selected_ids text[] := '{}'; changed_ids text[] := '{}';
  member_qualifications text[]; task_start timestamptz; task_end timestamptz;
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(command) is distinct from 'object' or jsonb_typeof(command->'type') is distinct from 'string' then
    raise exception 'Command requires type' using errcode = '22023';
  end if;
  operation := command->>'type';
  shifts := state.data;
  if operation not in ('signup','withdraw') and actor.role <> 'admin' then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  if operation in ('signup','withdraw','assign') then
    perform bsv_private.exact_keys(command, case when operation = 'assign' then array['type','taskId','memberId'] else array['type','taskId'] end);
    if jsonb_typeof(command->'taskId') is distinct from 'string' then
      raise exception 'taskId required' using errcode = '22023';
    end if;
    for shift, shift_position in select value, (ordinality - 1)::integer from jsonb_array_elements(shifts) with ordinality loop
      for task, task_position in select value, (ordinality - 1)::integer from jsonb_array_elements(shift->'tasks') with ordinality loop
        if task->>'id' = command->>'taskId' then
          target_shift := shift_position; target_task := task_position;
          exit;
        end if;
      end loop;
      if target_shift is not null then exit; end if;
    end loop;
    if target_shift is null then raise exception 'Task not found' using errcode = '22023'; end if;
    select starts_at, ends_at into task_start, task_end from bsv_private.task_windows(jsonb_build_array(shift)) as task_window
      where task_window.task->>'id' = command->>'taskId';
    if task_start <= statement_timestamp() then raise exception 'Task has already started' using errcode = '22023'; end if;
    if operation in ('signup','withdraw') and not (shift->>'published')::boolean then
      raise exception 'Task is not published' using errcode = '42501';
    end if;
    if operation = 'signup' then
      if task->'memberId' <> 'null'::jsonb then raise exception 'Task already assigned' using errcode = '23505'; end if;
      target_member := actor.id;
    elsif operation = 'withdraw' then
      if (task->>'memberId')::uuid is distinct from actor.id then
        raise exception 'Only own assignment can be withdrawn' using errcode = '42501';
      end if;
      if task->'qualification' <> 'null'::jsonb and not (task->>'qualification' = any(actor.qualifications)) then
        raise exception 'Required qualification missing' using errcode = '22023';
      end if;
      select email into recipient from public.admin_settings where id = 1;
      if recipient is null then raise exception 'Notification recipient not configured' using errcode = '22023'; end if;
      insert into public.notification_outbox(event_key, recipient, payload) values (
        'withdraw:' || (state.version + 1)::text || ':' || (task->>'id'), recipient,
        jsonb_build_object('memberName', actor.name, 'taskName', task->>'name', 'shiftTitle', shift->>'title',
          'shiftId', shift->>'id', 'date', shift->>'date',
          'start', to_char(task_start at time zone 'Europe/Berlin', 'HH24:MI'),
          'end', to_char(task_end at time zone 'Europe/Berlin', 'HH24:MI'),
          'withdrawnAt', to_char(statement_timestamp() at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI:SS'))
      );
      target_member := null;
    else
      if not (command ? 'memberId') or jsonb_typeof(command->'memberId') not in ('null','string') then
        raise exception 'memberId must be UUID or null' using errcode = '22023';
      end if;
      target_member := (command->>'memberId')::uuid;
    end if;
    shifts := jsonb_set(shifts, array[target_shift::text,'tasks',target_task::text,'memberId'], coalesce(to_jsonb(target_member), 'null'::jsonb), false);

  elsif operation in ('create','generate') then
    perform bsv_private.exact_keys(command, case when operation = 'create' then array['type','shift'] else array['type','shifts'] end);
    replacement := case when operation = 'create' then jsonb_build_array(command->'shift') else command->'shifts' end;
    if jsonb_typeof(replacement) is distinct from 'array' or jsonb_array_length(replacement) not between 1 and 5000 then
      raise exception 'Nonempty shifts array required' using errcode = '22023';
    end if;
    for entry in select value from jsonb_array_elements(replacement) loop
      if jsonb_typeof(entry->'id') is distinct from 'string' or entry->>'id' = any(selected_ids) then
        raise exception 'Missing or duplicate generated shift id' using errcode = '22023';
      end if;
      selected_ids := array_append(selected_ids, entry->>'id');
      if exists (select 1 from jsonb_array_elements(shifts) as existing(shift) where existing.shift->>'id' = entry->>'id') then
        continue;
      end if;
      perform bsv_private.validate_state(jsonb_build_array(entry));
      if bsv_private.local_instant(entry->>'date', entry->>'start') <= statement_timestamp() then
        raise exception 'New shifts must be future' using errcode = '22023';
      end if;
      shifts := shifts || jsonb_build_array(entry);
    end loop;

  elsif operation = 'updateTimes' then
    perform bsv_private.exact_keys(command, array['type','updates']);
    if jsonb_typeof(command->'updates') is distinct from 'array' or jsonb_array_length(command->'updates') not between 1 and 5000 then
      raise exception 'Nonempty updates array required' using errcode = '22023';
    end if;
    for update_entry in select value from jsonb_array_elements(command->'updates') loop
      perform bsv_private.exact_keys(update_entry, array['id','start','end']);
      if jsonb_typeof(update_entry->'id') is distinct from 'string' or update_entry->>'id' = any(changed_ids) then
        raise exception 'Missing or duplicate update id' using errcode = '22023';
      end if;
      target_shift := null;
      select value, (ordinality - 1)::integer into shift, target_shift from jsonb_array_elements(shifts) with ordinality
        where value->>'id' = update_entry->>'id';
      if target_shift is null then raise exception 'Shift not found' using errcode = '22023'; end if;
      if bsv_private.local_instant(shift->>'date', shift->>'start') <= statement_timestamp()
        or bsv_private.local_instant(shift->>'date', update_entry->>'start') <= statement_timestamp() then
        raise exception 'Time edits must remain future' using errcode = '22023';
      end if;
      replacement := shift || jsonb_build_object('start', update_entry->'start', 'end', update_entry->'end');
      shifts := jsonb_set(shifts, array[target_shift::text], replacement, false);
      changed_ids := array_append(changed_ids, shift->>'id');
    end loop;

  elsif operation = 'publish' then
    perform bsv_private.exact_keys(command, array['type','ids']);
    if jsonb_typeof(command->'ids') is distinct from 'array' or jsonb_array_length(command->'ids') not between 1 and 5000 then
      raise exception 'Nonempty ids array required' using errcode = '22023';
    end if;
    for entry in select value from jsonb_array_elements(command->'ids') loop
      if jsonb_typeof(entry) <> 'string' or entry #>> '{}' = any(selected_ids) then
        raise exception 'Invalid or duplicate publish id' using errcode = '22023';
      end if;
      target_shift := null;
      select value, (ordinality - 1)::integer into shift, target_shift from jsonb_array_elements(shifts) with ordinality
        where value->>'id' = entry #>> '{}';
      if target_shift is null then raise exception 'Shift not found' using errcode = '22023'; end if;
      if bsv_private.local_instant(shift->>'date', shift->>'start') <= statement_timestamp() then
        raise exception 'Only future shifts can be published' using errcode = '22023';
      end if;
      shifts := jsonb_set(shifts, array[target_shift::text,'published'], 'true'::jsonb, false);
      selected_ids := array_append(selected_ids, entry #>> '{}');
    end loop;

  elsif operation = 'updateMember' then
    perform bsv_private.exact_keys(command, array['type','member']);
    member_data := command->'member';
    perform bsv_private.exact_keys(member_data, array['id','name','email','active','qualifications']);
    if not (member_data ?& array['id','name','email','active','qualifications'])
      or jsonb_typeof(member_data->'id') <> 'string' or jsonb_typeof(member_data->'name') <> 'string'
      or jsonb_typeof(member_data->'email') not in ('null','string')
      or jsonb_typeof(member_data->'active') <> 'boolean' or jsonb_typeof(member_data->'qualifications') <> 'array'
      or jsonb_array_length(member_data->'qualifications') > 64 then
      raise exception 'Invalid member' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(member_data->'qualifications') as entry(value)
      where jsonb_typeof(value) <> 'string' or length(btrim(value #>> '{}')) not between 1 and 80) then
      raise exception 'Invalid qualification' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct value order by value), '{}'::text[]) into member_qualifications
      from jsonb_array_elements_text(member_data->'qualifications') as entry(value);
    target_member := (member_data->>'id')::uuid;
    if target_member = actor.id and not (member_data->>'active')::boolean then
      raise exception 'Cannot deactivate acting administrator' using errcode = '22023';
    end if;
    insert into public.members(id, name, email, active, qualifications)
      values (target_member, btrim(member_data->>'name'), nullif(btrim(member_data->>'email'), ''), (member_data->>'active')::boolean, member_qualifications)
      on conflict (id) do update set name = excluded.name, email = excluded.email, active = excluded.active, qualifications = excluded.qualifications;

  elsif operation = 'settings' then
    perform bsv_private.exact_keys(command, array['type','email']);
    if jsonb_typeof(command->'email') is distinct from 'string' then raise exception 'Email required' using errcode = '22023'; end if;
    insert into public.admin_settings(id, email) values (1, btrim(command->>'email'))
      on conflict (id) do update set email = excluded.email;
  else
    raise exception 'Unknown command type' using errcode = '22023';
  end if;

  perform bsv_private.validate_state(shifts);
  update public.schedule_state set data = shifts, version = state.version + 1 where id = 1;
  return bsv_private.snapshot(actor);
end;
$$;

create function public.claim_notifications(batch_size integer default 20)
returns table(id uuid, event_key text, recipient text, payload jsonb, lease_token uuid)
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if batch_size is null or batch_size not between 1 and 100 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  update public.notification_outbox as outbox set status = 'failed', lease_token = null, lease_until = null, last_error = 'lease_expired_max_attempts'
    where outbox.status = 'processing' and outbox.lease_until <= statement_timestamp() and outbox.attempts >= 5;
  return query
    with ready as (
      select outbox.id from public.notification_outbox as outbox
      where outbox.attempts < 5 and (
        (outbox.status = 'pending' and outbox.next_attempt_at <= statement_timestamp())
        or (outbox.status = 'processing' and outbox.lease_until <= statement_timestamp())
      ) order by outbox.next_attempt_at, outbox.created_at
      for update skip locked limit batch_size
    )
    update public.notification_outbox as outbox set status = 'processing', attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(), lease_until = statement_timestamp() + interval '5 minutes'
    from ready where outbox.id = ready.id
    returning outbox.id, outbox.event_key, outbox.recipient, outbox.payload, outbox.lease_token;
end;
$$;

create function public.finish_notification(notification_id uuid, claim_token uuid, delivered boolean,
  message_id text default null, error_code text default null, permanent_failure boolean default false)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare attempt_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if delivered is null or permanent_failure is null then raise exception 'Result flags required' using errcode = '22023'; end if;
  select attempts into attempt_count from public.notification_outbox
    where id = notification_id and status = 'processing' and lease_token = claim_token
      and lease_until > statement_timestamp() for update;
  if not found then return false; end if;
  update public.notification_outbox set
    status = case when delivered then 'sent' when permanent_failure or attempt_count >= 5 then 'failed' else 'pending' end,
    provider_message_id = case when delivered then left(message_id, 200) else null end,
    last_error = case when delivered then null when error_code ~ '^[a-z0-9_]{1,64}$' then error_code else 'delivery_failed' end,
    sent_at = case when delivered then statement_timestamp() else null end,
    next_attempt_at = statement_timestamp() + (60 * power(2, attempt_count - 1)) * interval '1 second',
    lease_token = null, lease_until = null
    where id = notification_id;
  return true;
end;
$$;

revoke all on all functions in schema bsv_private from public, anon, authenticated, service_role;
revoke all on function public.load_schedule(), public.mutate_schedule(bigint,jsonb), public.claim_notifications(integer),
  public.finish_notification(uuid,uuid,boolean,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.load_schedule(), public.mutate_schedule(bigint,jsonb) to authenticated;
grant execute on function public.claim_notifications(integer), public.finish_notification(uuid,uuid,boolean,text,text,boolean) to service_role;

commit;
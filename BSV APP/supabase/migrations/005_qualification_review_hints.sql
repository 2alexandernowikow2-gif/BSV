begin;

create or replace function bsv_private.validate_state(shifts jsonb) returns void
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
        if starts_at > statement_timestamp() and not assigned.active then
          raise exception 'Assigned account is disabled' using errcode = '22023';
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

create or replace function public.mutate_schedule(expected_version bigint, command jsonb) returns jsonb
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

create or replace function public.update_member_seasons(expected_version bigint, member_data jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; target_member uuid;
  member_name text; member_email text; member_qualifications text[];
  winter_enabled boolean; summer_enabled boolean;
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if actor.role <> 'admin' then raise exception 'Administrator required' using errcode = '42501'; end if;
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  perform bsv_private.exact_keys(member_data, array['id','name','email','winterActive','summerActive','qualifications']);
  if not (member_data ?& array['id','name','email','winterActive','summerActive','qualifications'])
    or jsonb_typeof(member_data->'id') <> 'string'
    or jsonb_typeof(member_data->'name') <> 'string'
    or jsonb_typeof(member_data->'email') not in ('null','string')
    or jsonb_typeof(member_data->'winterActive') <> 'boolean'
    or jsonb_typeof(member_data->'summerActive') <> 'boolean'
    or jsonb_typeof(member_data->'qualifications') <> 'array'
    or jsonb_array_length(member_data->'qualifications') > 64 then
    raise exception 'Invalid member' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(member_data->'qualifications') as entry(value)
    where jsonb_typeof(value) <> 'string' or length(btrim(value #>> '{}')) not between 1 and 80) then
    raise exception 'Invalid qualification' using errcode = '22023';
  end if;
  member_email := nullif(btrim(member_data->>'email'), '');
  if member_email is not null and (length(member_email) > 254 or member_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  target_member := (member_data->>'id')::uuid;
  member_name := btrim(member_data->>'name');
  winter_enabled := (member_data->>'winterActive')::boolean;
  summer_enabled := (member_data->>'summerActive')::boolean;
  if length(member_name) not between 1 and 120 then raise exception 'Invalid name' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into member_qualifications
    from jsonb_array_elements_text(member_data->'qualifications') as entry(value);
  insert into public.members(id, name, email, status, active, winter_active, summer_active, qualifications)
    values (target_member, member_name, member_email,
      case when winter_enabled and summer_enabled then 'both' when winter_enabled then 'winter' when summer_enabled then 'summer' else 'inactive' end,
      true, winter_enabled, summer_enabled, member_qualifications)
    on conflict (id) do update set name = excluded.name, email = excluded.email, status = excluded.status,
      active = true, winter_active = excluded.winter_active, summer_active = excluded.summer_active,
      qualifications = excluded.qualifications;
  update public.schedule_state set version = state.version + 1 where id = 1;
  return bsv_private.snapshot(actor);
end;
$$;

revoke all on function public.mutate_schedule(bigint,jsonb), public.update_member_seasons(bigint,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mutate_schedule(bigint,jsonb), public.update_member_seasons(bigint,jsonb) to authenticated;

commit;

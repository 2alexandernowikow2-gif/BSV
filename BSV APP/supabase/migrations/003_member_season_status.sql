begin;

alter table public.members add column status text not null default 'winter'
  check (status in ('winter', 'summer', 'inactive'));
update public.members set status = case when active then 'winter' else 'inactive' end;
update public.members set active = true;

create function bsv_private.sync_member_activity() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.active is distinct from old.active and not new.active then
    new.status := 'inactive';
  end if;
  new.active := true;
  return new;
end;
$$;
create trigger members_sync_activity
before insert or update on public.members
for each row execute function bsv_private.sync_member_activity();

create or replace function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'version', state.version,
    'shifts', case when actor.role = 'admin' then state.data else
      coalesce((select jsonb_agg(shift order by position) from jsonb_array_elements(state.data) with ordinality as entry(shift, position)
        where (shift->>'published')::boolean), '[]'::jsonb) end,
    'members', coalesce((select jsonb_agg(case when actor.role = 'admin' then to_jsonb(member)
      else jsonb_build_object('id', member.id, 'name', member.name, 'active', member.active, 'status', member.status, 'qualifications', member.qualifications) end order by member.name, member.id)
      from public.members as member where actor.role = 'admin' or member.active or exists (
        select 1 from bsv_private.task_windows(state.data) as task_window
        where (task_window.shift->>'published')::boolean and task_window.task->>'memberId' = member.id::text
      )), '[]'::jsonb),
    'planningPeriods', coalesce((select jsonb_object_agg(to_char(month, 'YYYY-MM'), status) from public.planning_periods), '{}'::jsonb)
  )
  from public.schedule_state as state where state.id = 1;
$$;

create function public.update_member(expected_version bigint, member_data jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; target_member uuid; member_status text;
  member_name text; member_email text; member_qualifications text[];
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if actor.role <> 'admin' then raise exception 'Administrator required' using errcode = '42501'; end if;
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  perform bsv_private.exact_keys(member_data, array['id','name','email','status','qualifications']);
  if not (member_data ?& array['id','name','email','status','qualifications'])
    or jsonb_typeof(member_data->'id') <> 'string'
    or jsonb_typeof(member_data->'name') <> 'string'
    or jsonb_typeof(member_data->'email') not in ('null','string')
    or jsonb_typeof(member_data->'status') <> 'string'
    or member_data->>'status' not in ('winter','summer','inactive')
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
  member_status := member_data->>'status';
  member_name := btrim(member_data->>'name');
  if length(member_name) not between 1 and 120 then raise exception 'Invalid name' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into member_qualifications
    from jsonb_array_elements_text(member_data->'qualifications') as entry(value);
  if exists (
    select 1 from bsv_private.task_windows(state.data) as task_window
    where task_window.task->>'memberId' = target_member::text
      and task_window.ends_at > statement_timestamp()
      and task_window.task->'qualification' <> 'null'::jsonb
      and not (task_window.task->>'qualification' = any(member_qualifications))
  ) then
    raise exception 'Reassign existing duties before removing a required qualification' using errcode = '22023';
  end if;
  update public.members set name = member_name, email = member_email, status = member_status,
    active = true, qualifications = member_qualifications
  where id = target_member;
  if not found then raise exception 'Member not found' using errcode = '22023'; end if;
  update public.schedule_state set version = state.version + 1 where id = 1;
  return bsv_private.snapshot(actor);
end;
$$;

revoke all on function public.update_member(bigint,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_member(bigint,jsonb) to authenticated;
revoke all on function bsv_private.sync_member_activity() from public, anon, authenticated, service_role;

commit;

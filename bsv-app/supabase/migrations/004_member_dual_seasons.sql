begin;

alter table public.members add column winter_active boolean not null default true;
alter table public.members add column summer_active boolean not null default false;
update public.members set
  winter_active = status in ('winter', 'both'),
  summer_active = status in ('summer', 'both');
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('winter', 'summer', 'both', 'inactive'));

create function bsv_private.sync_member_seasons() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.active is distinct from old.active and not new.active then
    new.winter_active := false;
    new.summer_active := false;
  end if;
  new.status := case
    when new.winter_active and new.summer_active then 'both'
    when new.winter_active then 'winter'
    when new.summer_active then 'summer'
    else 'inactive' end;
  new.active := true;
  return new;
end;
$$;
create trigger members_sync_seasons
before insert or update on public.members
for each row execute function bsv_private.sync_member_seasons();

create or replace function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'version', state.version,
    'shifts', case when actor.role = 'admin' then state.data else
      coalesce((select jsonb_agg(shift order by position) from jsonb_array_elements(state.data) with ordinality as entry(shift, position)
        where (shift->>'published')::boolean), '[]'::jsonb) end,
    'members', coalesce((select jsonb_agg(case when actor.role = 'admin' then to_jsonb(member) || jsonb_build_object(
      'winterActive', member.winter_active, 'summerActive', member.summer_active)
      else jsonb_build_object('id', member.id, 'name', member.name, 'email', member.email, 'active', member.active,
        'status', member.status, 'winterActive', member.winter_active, 'summerActive', member.summer_active,
        'qualifications', member.qualifications) end order by member.name, member.id)
      from public.members as member where actor.role = 'admin' or member.active or exists (
        select 1 from bsv_private.task_windows(state.data) as task_window
        where (task_window.shift->>'published')::boolean and task_window.task->>'memberId' = member.id::text
      )), '[]'::jsonb),
    'planningPeriods', coalesce((select jsonb_object_agg(to_char(month, 'YYYY-MM'), status) from public.planning_periods), '{}'::jsonb)
  )
  from public.schedule_state as state where state.id = 1;
$$;

create function public.update_member_seasons(expected_version bigint, member_data jsonb)
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
  if exists (
    select 1 from bsv_private.task_windows(state.data) as task_window
    where task_window.task->>'memberId' = target_member::text
      and task_window.ends_at > statement_timestamp()
      and task_window.task->'qualification' <> 'null'::jsonb
      and not (task_window.task->>'qualification' = any(member_qualifications))
  ) then
    raise exception 'Reassign existing duties before removing a required qualification' using errcode = '22023';
  end if;
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

revoke all on function public.update_member_seasons(bigint,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_member_seasons(bigint,jsonb) to authenticated;
revoke all on function bsv_private.sync_member_seasons() from public, anon, authenticated, service_role;

commit;

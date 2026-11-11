begin;

create table public.availability_exceptions (
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id,date)
);
create index availability_exceptions_date on public.availability_exceptions(date);
alter table public.availability_exceptions enable row level security;
revoke all on public.availability_exceptions from public,anon,authenticated;
grant select,insert,delete on public.availability_exceptions to authenticated;
create policy availability_read on public.availability_exceptions for select to authenticated
  using (public.current_member() is not null);
create policy availability_insert on public.availability_exceptions for insert to authenticated
  with check (public.is_admin() or member_id = (public.current_member()->>'id')::uuid);
create policy availability_delete on public.availability_exceptions for delete to authenticated
  using (public.is_admin() or member_id = (public.current_member()->>'id')::uuid);

create function bsv_private.availability_day_exists(service_date date) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select service_date >= (statement_timestamp() at time zone 'Europe/Berlin')::date
    and exists(select 1 from public.schedule_state state
      cross join lateral jsonb_array_elements(state.data) entry(shift)
      where (shift->>'date')::date = service_date
        and not exists(select 1 from public.shift_cancellations cancellation
          where cancellation.shift_id = shift->>'id'
            and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at)));
$$;
create function bsv_private.guard_availability() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare service_date date;
begin
  service_date := case when tg_op = 'DELETE' then old.date else new.date end;
  if not bsv_private.availability_day_exists(service_date) then
    raise exception 'Nur heutige und kommende Diensttage sind aenderbar.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger availability_guard before insert or delete on public.availability_exceptions
  for each row execute function bsv_private.guard_availability();

create function public.set_availability(target_member_id uuid, service_dates date[], available boolean) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; service_date date;
begin
  actor := bsv_private.actor();
  if target_member_id is null or (actor.role <> 'admin' and actor.id <> target_member_id) then
    raise exception 'Nur eigene Meldungen sind aenderbar.' using errcode = '42501';
  end if;
  if available is null or coalesce(cardinality(service_dates),0) not between 1 and 1000 then
    raise exception 'Diensttage erforderlich.' using errcode = '22023';
  end if;
  perform 1 from public.schedule_state where id = 1 for update;
  if not exists(select 1 from public.members where id = target_member_id and account_status = 'aktiv' and archived_at is null) then
    raise exception 'Aktiviertes Mitglied erforderlich.' using errcode = '22023';
  end if;
  foreach service_date in array service_dates loop
    if service_date is null or not bsv_private.availability_day_exists(service_date) then
      raise exception 'Nur heutige und kommende Diensttage sind aenderbar.' using errcode = '22023';
    end if;
    if available then
      delete from public.availability_exceptions where member_id = target_member_id and date = service_date;
    else
      insert into public.availability_exceptions(member_id,date) values(target_member_id,service_date) on conflict do nothing;
    end if;
  end loop;
end;
$$;

create function public.load_availability() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members;
begin
  actor := bsv_private.actor();
  return jsonb_build_object('memberId',actor.id,'admin',actor.role = 'admin',
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'winterActive',winter_active,'summerActive',summer_active) order by name)
      from public.members where account_status = 'aktiv' and archived_at is null),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(jsonb_build_object('memberId',member_id,'date',date)) from public.availability_exceptions),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(day order by day->>'date') from (
      select jsonb_build_object('date',entry.service_date,'count',count(*),
        'published',bool_and((shift->>'published')::boolean),
        'mixed',bool_or((shift->>'published')::boolean) <> bool_and((shift->>'published')::boolean),
        'assigned',bool_or(exists(select 1 from jsonb_array_elements(shift->'tasks') task where task->>'memberId' = actor.id::text)),
        'assignedMemberIds',case when actor.role = 'admin' then (
          select coalesce(jsonb_agg(distinct task->>'memberId'),'[]'::jsonb)
          from public.schedule_state source cross join lateral jsonb_array_elements(source.data) services(service)
          cross join lateral jsonb_array_elements(service->'tasks') tasks(task)
          where service->>'date' = entry.service_date and task->>'memberId' is not null
            and not exists(select 1 from public.shift_cancellations cancellation where cancellation.shift_id = service->>'id'
              and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at))
        ) else jsonb_build_array(actor.id) end) as day
      from public.schedule_state state cross join lateral
        (select value as shift,value->>'date' as service_date from jsonb_array_elements(state.data)) entry
      where (shift->>'date')::date >= (statement_timestamp() at time zone 'Europe/Berlin')::date
        and not exists(select 1 from public.shift_cancellations cancellation where cancellation.shift_id = shift->>'id'
          and (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at))
      group by entry.service_date
    ) days),'[]'::jsonb));
end;
$$;

alter function bsv_private.snapshot(public.members) rename to snapshot_before_availability;
create function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select bsv_private.snapshot_before_availability(actor) || jsonb_build_object(
    'availabilityExceptions',coalesce((select jsonb_agg(jsonb_build_object('memberId',member_id,'date',date)) from public.availability_exceptions),'[]'::jsonb),
    'activatedMemberIds',coalesce((select jsonb_agg(id) from public.members where account_status = 'aktiv' and archived_at is null),'[]'::jsonb));
$$;
revoke all on function public.load_availability(),public.set_availability(uuid,date[],boolean) from public,anon;
grant execute on function public.load_availability(),public.set_availability(uuid,date[],boolean) to authenticated;
revoke all on function bsv_private.availability_day_exists(date),bsv_private.guard_availability(),bsv_private.snapshot(public.members) from public,anon,authenticated;

alter function public.mutate_schedule(bigint,jsonb) rename to mutate_schedule_before_availability;
revoke all on function public.mutate_schedule_before_availability(bigint,jsonb) from public,anon,authenticated;
create function public.mutate_schedule(expected_version bigint, command jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; service_date date;
begin
  perform 1 from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if command->>'type' = 'assign' and command->>'memberId' is not null then
    select (shift->>'date')::date into service_date from public.schedule_state state
      cross join lateral jsonb_array_elements(state.data) entry(shift)
      where exists(select 1 from jsonb_array_elements(shift->'tasks') task where task->>'id' = command->>'taskId');
    if exists(select 1 from public.availability_exceptions where member_id = (command->>'memberId')::uuid and date = service_date)
      and command->'availabilityConfirmed' is distinct from 'true'::jsonb then
      raise exception 'Mitglied ist nicht verfuegbar. Bitte neu laden und die Zuweisung ausdruecklich bestaetigen.' using errcode = '22023';
    end if;
  end if;
  return public.mutate_schedule_before_availability(expected_version,command - 'availabilityConfirmed');
end;
$$;
revoke all on function public.mutate_schedule(bigint,jsonb) from public,anon;
grant execute on function public.mutate_schedule(bigint,jsonb) to authenticated;

create function public.restore_availability(target_member_id uuid,service_dates date[],unavailable_dates date[]) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare service_date date;
begin
  if coalesce(cardinality(service_dates),0) not between 1 and 1000 or unavailable_dates is null
    or not unavailable_dates <@ service_dates then raise exception 'Diensttage ungueltig.' using errcode = '22023'; end if;
  foreach service_date in array service_dates loop
    perform public.set_availability(target_member_id,array[service_date],not (service_date = any(unavailable_dates)));
  end loop;
end;
$$;
revoke all on function public.restore_availability(uuid,date[],date[]) from public,anon;
grant execute on function public.restore_availability(uuid,date[],date[]) to authenticated;

commit;
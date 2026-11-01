begin;

alter table public.members add column vorname text not null default '';
alter table public.members add column nachname text not null default '';
alter table public.members add column account_status text not null default 'eingeladen'
  check (account_status in ('eingeladen','aktiv','deaktiviert'));
alter table public.members add column created_at timestamptz not null default now();
alter table public.members add column updated_at timestamptz not null default now();
alter table public.members add column archived_at timestamptz;
alter table public.members add column tokens_revoked_at timestamptz;
alter table public.members add column invite_requested_at timestamptz;
alter table public.members add column last_mail_at timestamptz;
alter table public.members drop constraint members_role_check;
update public.members set role = 'mitarbeiter' where role = 'member';
alter table public.members alter column role set default 'mitarbeiter';
alter table public.members add constraint members_role_check check (role in ('admin','mitarbeiter'));
update public.members set vorname = name;
update public.members set email = lower(email);
update public.members as member set email = lower(account.email),
  account_status = case when account.banned_until > now() then 'deaktiviert'
    when account.email_confirmed_at is not null and coalesce(account.encrypted_password,'') <> '' then 'aktiv'
    else 'eingeladen' end
from auth.users as account where account.id = member.user_id;

do $$ begin
  if exists (select 1 from public.members where email is not null group by lower(email) having count(*) > 1) then
    raise exception 'Doppelte Mitarbeiter-E-Mails vor Migration 008 bereinigen; es wurden keine Daten geloescht.';
  end if;
end $$;
create unique index members_account_email on public.members(lower(email)) where archived_at is null and email is not null;
alter table public.members add constraint members_linked_email check (user_id is null or email is not null);

create or replace function bsv_private.actor() returns public.members
language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor public.members;
begin
  select * into actor from public.members where user_id = auth.uid()
    and account_status = 'aktiv' and archived_at is null
    and (tokens_revoked_at is null or to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) > tokens_revoked_at);
  if not found then raise exception 'Aktiver Mitarbeiterzugang erforderlich.' using errcode = '42501'; end if;
  return actor;
end;
$$;

create function public.current_member() returns jsonb
language sql stable security definer set search_path = pg_catalog as $$ select to_jsonb(bsv_private.actor()); $$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin'
    and account_status = 'aktiv' and archived_at is null
    and (tokens_revoked_at is null or to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) > tokens_revoked_at));
$$;
create function public.own_profile_access() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from public.members where user_id = auth.uid() and archived_at is null
    and account_status in ('aktiv','eingeladen')
    and (tokens_revoked_at is null or to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) > tokens_revoked_at));
$$;

grant select on public.members to authenticated;
grant update(vorname,nachname) on public.members to authenticated;
grant select,insert,update on public.members to service_role;
create policy members_read on public.members for select to authenticated
  using (public.is_admin() or (user_id = auth.uid() and public.own_profile_access()));
create policy members_own_name on public.members for update to authenticated
  using (user_id = auth.uid() and public.own_profile_access())
  with check (user_id = auth.uid() and public.own_profile_access());

create function bsv_private.guard_member_account() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(845213,2);
  if tg_op = 'UPDATE' and old.role = 'admin' and old.account_status = 'aktiv' and old.archived_at is null
    and (new.role <> 'admin' or new.account_status <> 'aktiv' or new.archived_at is not null or new.user_id is null) then
    if not exists (select 1 from public.members where id <> old.id and role = 'admin'
      and account_status = 'aktiv' and archived_at is null and user_id is not null) then
      raise exception 'Der letzte aktive Admin muss erhalten bleiben.' using errcode = '23514';
    end if;
  end if;
  if length(btrim(new.vorname || ' ' || new.nachname)) not between 1 and 120 then
    raise exception 'Name ist zu lang.' using errcode = '22023';
  end if;
  if btrim(new.vorname || ' ' || new.nachname) <> '' then new.name := btrim(new.vorname || ' ' || new.nachname); end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger members_guard_account before insert or update on public.members
  for each row execute function bsv_private.guard_member_account();

create function bsv_private.sync_auth_member() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare existing_id uuid; display_name text;
begin
  if new.email is null then raise exception 'E-Mail-Adresse erforderlich.'; end if;
  perform pg_advisory_xact_lock(845213,2);
  select id into existing_id from public.members where user_id = new.id
    or (user_id is null and archived_at is null and lower(email) = lower(new.email))
    order by (user_id = new.id) desc nulls last limit 1 for update;
  if existing_id is null then
    if new.invited_at is null then
      raise exception 'Zugang nur mit Einladung der Vereinsverwaltung.' using errcode = '42501';
    end if;
    display_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),new.email),60);
    insert into public.members(user_id,name,email,vorname,role,account_status)
      values(new.id,display_name,lower(new.email),display_name,'mitarbeiter','eingeladen');
  else
    update public.members set user_id = new.id, email = lower(new.email) where id = existing_id;
  end if;
  return new;
end;
$$;
create trigger auth_user_member_insert after insert on auth.users for each row execute function bsv_private.sync_auth_member();
create trigger auth_user_member_email after update of email on auth.users for each row execute function bsv_private.sync_auth_member();

insert into public.members(user_id,name,email,vorname,account_status)
select account.id, left(account.email,60),lower(account.email),left(account.email,60),
  case when account.banned_until > now() then 'deaktiviert'
    when account.email_confirmed_at is not null and coalesce(account.encrypted_password,'') <> '' then 'aktiv' else 'eingeladen' end
from auth.users as account where account.email is not null
  and not exists (select 1 from public.members where user_id = account.id or lower(email) = lower(account.email));
update public.members as member set user_id = account.id,
  account_status = case when account.banned_until > now() then 'deaktiviert'
    when account.email_confirmed_at is not null and coalesce(account.encrypted_password,'') <> '' then 'aktiv' else 'eingeladen' end
from auth.users as account where member.user_id is null and lower(member.email) = lower(account.email);

create function public.activate_own_account() returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
    and coalesce(encrypted_password,'') <> '' and (banned_until is null or banned_until <= now())) then
    raise exception 'Zuerst Einladung bestaetigen und ein Passwort setzen.' using errcode = '42501';
  end if;
  update public.members set account_status = 'aktiv' where user_id = auth.uid()
    and account_status = 'eingeladen' and archived_at is null;
  if not found and not exists (select 1 from public.members where user_id = auth.uid()
    and account_status = 'aktiv' and archived_at is null) then
    raise exception 'Dieser Zugang ist deaktiviert.' using errcode = '42501';
  end if;
end;
$$;

create function public.admin_edit_member(actor_id uuid, target_id uuid, changes jsonb) returns public.members
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; target public.members; result public.members;
begin
  perform pg_advisory_xact_lock(845213,2);
  select * into actor from public.members where user_id = actor_id and role = 'admin' and account_status = 'aktiv' and archived_at is null;
  if not found then raise exception 'Nur aktive Administratoren.' using errcode = '42501'; end if;
  select * into target from public.members where id = target_id and archived_at is null for update;
  if not found then raise exception 'Mitarbeiter nicht gefunden.' using errcode = '22023'; end if;
  perform bsv_private.exact_keys(changes,array['vorname','nachname','role','account_status','winter_active','summer_active','qualifications']);
  if target.user_id = actor_id and changes->>'account_status' = 'deaktiviert' then
    raise exception 'Du kannst deinen eigenen Zugang nicht deaktivieren.' using errcode = '42501';
  end if;
  if changes ? 'account_status' and changes->>'account_status' = 'aktiv' and not exists (
    select 1 from auth.users where id = target.user_id and email_confirmed_at is not null and coalesce(encrypted_password,'') <> '') then
    changes := jsonb_set(changes,'{account_status}','"eingeladen"'::jsonb);
  end if;
  if changes->>'account_status' = 'deaktiviert' then
    delete from auth.sessions where user_id = target.user_id;
  end if;
  update public.members set
    vorname = coalesce(changes->>'vorname',vorname), nachname = coalesce(changes->>'nachname',nachname),
    role = coalesce(changes->>'role',role), account_status = coalesce(changes->>'account_status',account_status),
    tokens_revoked_at = case when changes->>'account_status' = 'deaktiviert' then statement_timestamp() else tokens_revoked_at end,
    winter_active = coalesce((changes->>'winter_active')::boolean,winter_active),
    summer_active = coalesce((changes->>'summer_active')::boolean,summer_active),
    qualifications = case when changes ? 'qualifications' then array(select jsonb_array_elements_text(changes->'qualifications')) else qualifications end
  where id = target_id returning * into result;
  update public.schedule_state set version = version + 1 where id = 1;
  return result;
end;
$$;

create function bsv_private.archive_member_data(member_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(845213,2);
  update public.members set account_status = 'deaktiviert', archived_at = statement_timestamp(),
    tokens_revoked_at = statement_timestamp(), email = null, user_id = null, role = 'mitarbeiter',
    winter_active = false, summer_active = false where id = member_id;
  update public.schedule_state as state set version = version + 1,
    data = coalesce((select jsonb_agg(jsonb_set(shift,'{tasks}',
      (select jsonb_agg(case when task->>'memberId' = member_id::text
        and bsv_private.local_instant(shift->>'date',shift->>'start') + (task->>'offsetMinutes')::int * interval '1 minute' > statement_timestamp()
        then jsonb_set(task,'{memberId}','null'::jsonb) else task end order by task_position)
      from jsonb_array_elements(shift->'tasks') with ordinality as tasks(task,task_position))) order by shift_position)
      from jsonb_array_elements(state.data) with ordinality as shifts(shift,shift_position)), '[]'::jsonb)
    where id = 1;
end;
$$;
create function bsv_private.archive_auth_member() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare member_id uuid;
begin
  perform pg_advisory_xact_lock(845213,2);
  select id into member_id from public.members where user_id = old.id for update;
  if member_id is not null then perform bsv_private.archive_member_data(member_id); end if;
  return old;
end;
$$;
create trigger auth_user_member_delete before delete on auth.users for each row execute function bsv_private.archive_auth_member();

create function public.archive_unlinked_member(actor_id uuid,member_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(845213,2);
  if not exists(select 1 from public.members where user_id = actor_id and role = 'admin' and account_status = 'aktiv' and archived_at is null) then
    raise exception 'Nur aktive Administratoren.' using errcode = '42501';
  end if;
  if not exists(select 1 from public.members where id = member_id and user_id is null and archived_at is null) then
    raise exception 'Unverknuepfter Mitarbeiter nicht gefunden.' using errcode = '22023';
  end if;
  perform bsv_private.archive_member_data(member_id);
end;
$$;
create table bsv_private.mail_clock(id boolean primary key default true check(id),last_mail_at timestamptz not null);
insert into bsv_private.mail_clock(last_mail_at) values('2000-01-01');
create function public.reserve_account_mail(member_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform 1 from bsv_private.mail_clock where id for update;
  if exists(select 1 from bsv_private.mail_clock where last_mail_at > clock_timestamp() - interval '1 second') then return false; end if;
  update public.members set last_mail_at = clock_timestamp() where id = member_id
    and (last_mail_at is null or last_mail_at < clock_timestamp() - interval '60 seconds');
  if not found then return false; end if;
  update bsv_private.mail_clock set last_mail_at = clock_timestamp() where id;
  return true;
end;
$$;
create function public.claim_employee_invite(actor_id uuid,member_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(845213,2);
  if not exists(select 1 from public.members where user_id = actor_id and role = 'admin' and account_status = 'aktiv' and archived_at is null) then
    raise exception 'Nur aktive Administratoren.' using errcode = '42501';
  end if;
  update public.members set invite_requested_at = now() where id = member_id and user_id is null
    and archived_at is null and invite_requested_at is null;
  return found;
end;
$$;

create function bsv_private.guard_new_assignments() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists(select 1 from bsv_private.task_windows(new.data) as next_task
    join public.members as member on member.id::text = next_task.task->>'memberId'
    where (member.account_status = 'deaktiviert' or member.archived_at is not null)
      and not exists(select 1 from bsv_private.task_windows(old.data) as previous_task
        where previous_task.task->>'id' = next_task.task->>'id' and previous_task.task->>'memberId' = next_task.task->>'memberId')) then
    raise exception 'Deaktivierten Mitarbeitern koennen keine neuen Dienste zugewiesen werden.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger schedule_guard_accounts before update of data on public.schedule_state
  for each row execute function bsv_private.guard_new_assignments();

create or replace function bsv_private.snapshot(actor public.members) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object('version',state.version,
    'shifts',case when actor.role = 'admin' then state.data else coalesce((select jsonb_agg(shift order by position)
      from jsonb_array_elements(state.data) with ordinality as entry(shift,position) where (shift->>'published')::boolean),'[]'::jsonb) end,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',member.id,'name',member.name,
      'active',member.account_status <> 'deaktiviert' and member.archived_at is null,'qualifications',member.qualifications,
      'status',member.status,'winterActive',member.winter_active,'summerActive',member.summer_active)
      || case when actor.role = 'admin' then jsonb_build_object('email',member.email,'role',member.role) else '{}'::jsonb end order by member.name,member.id)
      from public.members as member where member.archived_at is null or exists(select 1 from bsv_private.task_windows(state.data) as task_window
        where task_window.task->>'memberId' = member.id::text)),'[]'::jsonb),
    'planningPeriods',coalesce((select jsonb_object_agg(to_char(month,'YYYY-MM'),status) from public.planning_periods),'{}'::jsonb))
  from public.schedule_state as state where state.id = 1;
$$;

create table bsv_private.bootstrap_requests (
  email text primary key, status text not null check (status in ('claimed','sent','failed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function public.claim_admin_bootstrap(admin_email text, repair_existing boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare existing_user uuid; existing_member uuid;
begin
  perform pg_advisory_xact_lock(845213,2);
  if exists(select 1 from bsv_private.bootstrap_requests where email = lower(admin_email)) then
    return jsonb_build_object('claimed',false,'reason','Einrichtung bereits angefordert.');
  end if;
  if exists(select 1 from public.members where role = 'admin' and account_status = 'aktiv' and archived_at is null
    and (not repair_existing or lower(email) <> lower(admin_email))) then
    return jsonb_build_object('claimed',false,'reason','Aktiver Admin bereits vorhanden.');
  end if;
  if exists(select 1 from public.members where role = 'admin' and archived_at is null and lower(email) <> lower(admin_email)) then
    return jsonb_build_object('claimed',false,'reason','Anderer Admin bereits eingeladen.');
  end if;
  select id into existing_user from auth.users where lower(email) = lower(admin_email);
  select id into existing_member from public.members where lower(email) = lower(admin_email) and archived_at is null;
  if existing_user is not null then
    update public.members set role = 'admin' where user_id = existing_user and archived_at is null and account_status <> 'deaktiviert';
    if not found then raise exception 'Vorhandener Zugang ist gesperrt oder nicht zugeordnet.'; end if;
  elsif existing_member is not null then
    update public.members set role = 'admin' where id = existing_member;
  else
    insert into public.members(name,vorname,email,role) values(left(admin_email,60),left(admin_email,60),lower(admin_email),'admin');
  end if;
  insert into bsv_private.bootstrap_requests(email,status) values(lower(admin_email),'claimed');
  return jsonb_build_object('claimed',true,'userId',existing_user,'reason','');
end;
$$;
create function public.finish_admin_bootstrap(admin_email text, result_status text) returns void
language sql security definer set search_path = pg_catalog as $$
  update bsv_private.bootstrap_requests set status = result_status, updated_at = now()
    where email = lower(admin_email) and status = 'claimed' and result_status in ('sent','failed');
$$;
create function public.find_account_by_email(account_email text) returns uuid
language sql stable security definer set search_path = pg_catalog as $$
  select id from auth.users where lower(email) = lower(account_email) limit 1;
$$;

revoke all on function public.bootstrap_first_admin(uuid,text), public.update_member_seasons(bigint,jsonb),public.update_member(bigint,jsonb) from authenticated,anon,public,service_role;
revoke all on function public.current_member(),public.is_admin(),public.own_profile_access(),public.activate_own_account(),
  public.admin_edit_member(uuid,uuid,jsonb),public.claim_admin_bootstrap(text,boolean),public.finish_admin_bootstrap(text,text),public.find_account_by_email(text)
  from public,anon,authenticated,service_role;
grant execute on function public.current_member(),public.is_admin(),public.own_profile_access(),public.activate_own_account() to authenticated;
grant execute on function public.admin_edit_member(uuid,uuid,jsonb),public.claim_admin_bootstrap(text,boolean),
  public.finish_admin_bootstrap(text,text),public.find_account_by_email(text) to service_role;
revoke all on function public.archive_unlinked_member(uuid,uuid),public.claim_employee_invite(uuid,uuid),public.reserve_account_mail(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_unlinked_member(uuid,uuid),public.claim_employee_invite(uuid,uuid),public.reserve_account_mail(uuid) to service_role;
revoke all on all functions in schema bsv_private from public,anon,authenticated,service_role;

commit;
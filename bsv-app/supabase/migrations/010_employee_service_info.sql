begin;

alter table public.members add column service_info text not null default ''
  check (length(service_info) <= 500);

create or replace function public.admin_edit_member(actor_id uuid, target_id uuid, changes jsonb) returns public.members
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; target public.members; result public.members;
begin
  perform pg_advisory_xact_lock(845213,2);
  select * into actor from public.members where user_id = actor_id and role = 'admin' and account_status = 'aktiv' and archived_at is null;
  if not found then raise exception 'Nur aktive Administratoren.' using errcode = '42501'; end if;
  select * into target from public.members where id = target_id and archived_at is null for update;
  if not found then raise exception 'Mitarbeiter nicht gefunden.' using errcode = '22023'; end if;
  perform bsv_private.exact_keys(changes,array['vorname','nachname','role','account_status','winter_active','summer_active','qualifications','service_info']);
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
    qualifications = case when changes ? 'qualifications' then array(select jsonb_array_elements_text(changes->'qualifications')) else qualifications end,
    service_info = coalesce(changes->>'service_info',service_info)
  where id = target_id returning * into result;
  update public.schedule_state set version = version + 1 where id = 1;
  return result;
end;
$$;

commit;

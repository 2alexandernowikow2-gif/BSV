begin;

create function public.bootstrap_first_admin(account_id uuid, member_name text)
returns uuid
language plpgsql security definer set search_path = pg_catalog as $$
declare account_email text; matching_count integer; member_id uuid; linked_user uuid;
begin
  perform pg_advisory_xact_lock(845213, 1);

  if member_name is null or length(btrim(member_name)) not between 1 and 120 then
    raise exception 'Invalid admin name' using errcode = '22023';
  end if;

  select lower(email) into account_email
  from auth.users
  where id = account_id and email_confirmed_at is not null;
  if account_email is distinct from '2alexander.nowikow2@gmail.com' then
    raise exception 'Confirmed allowlisted account required' using errcode = '42501';
  end if;

  if exists (select 1 from public.members where role = 'admin' and active and user_id is not null) then
    raise exception 'Initial administrator already configured' using errcode = '23505';
  end if;

  select id into member_id from public.members where user_id = account_id;
  if found then
    update public.members set name = btrim(member_name), email = account_email, role = 'admin', active = true
    where id = member_id;
    return member_id;
  end if;

  select count(*) into matching_count from public.members where lower(email) = account_email;
  if matching_count > 1 then
    raise exception 'Multiple member records match admin email' using errcode = '23505';
  elsif matching_count = 1 then
    select id, user_id into member_id, linked_user from public.members where lower(email) = account_email for update;
    if linked_user is not null then
      raise exception 'Member record already linked to another account' using errcode = '23505';
    end if;
    update public.members set user_id = account_id, name = btrim(member_name), role = 'admin', active = true
    where id = member_id;
    return member_id;
  end if;

  insert into public.members(user_id, name, email, role, active)
  values (account_id, btrim(member_name), account_email, 'admin', true)
  returning id into member_id;
  return member_id;
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid, text) to service_role;

commit;
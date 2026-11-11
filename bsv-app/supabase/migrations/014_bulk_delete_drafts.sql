begin;

create function public.delete_drafts(expected_version bigint, shift_ids text[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; shift jsonb; retained jsonb;
begin
  select * into state from public.schedule_state where id = 1 for update;
  actor := bsv_private.actor();
  if actor.role <> 'admin' then raise exception 'Administrator required' using errcode = '42501'; end if;
  if expected_version is null or expected_version <> state.version then
    raise exception 'Schedule version conflict' using errcode = '40001';
  end if;
  if coalesce(cardinality(shift_ids),0) not between 1 and 5000
    or exists(select 1 from unnest(shift_ids) as selected(id) where id is null or id !~ '^[A-Za-z0-9_-]{1,100}$')
    or (select count(distinct id) from unnest(shift_ids) as selected(id)) <> cardinality(shift_ids) then
    raise exception 'Invalid draft selection' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(state.data) as entry(value) where value->>'id' = any(shift_ids)) <> cardinality(shift_ids) then
    raise exception 'Shift not found' using errcode = '22023';
  end if;
  for shift in select value from jsonb_array_elements(state.data) as entry(value) where value->>'id' = any(shift_ids) loop
    if (shift->>'published')::boolean then
      raise exception 'Published shifts must be cancelled, not deleted' using errcode = '22023';
    end if;
    if bsv_private.local_instant(shift->>'date',shift->>'start') <= statement_timestamp() then
      raise exception 'Only future drafts can be deleted' using errcode = '22023';
    end if;
    if exists(select 1 from public.planning_periods where month = date_trunc('month',(shift->>'date')::date)::date and status = 'closed') then
      raise exception 'Planning period is closed' using errcode = '55000';
    end if;
  end loop;
  select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into retained
    from jsonb_array_elements(state.data) with ordinality as entry(value,position)
    where not (value->>'id' = any(shift_ids));
  delete from public.shift_cancellations where shift_id = any(shift_ids);
  update public.schedule_state set data = retained,version = state.version + 1 where id = 1;
  return bsv_private.snapshot(actor);
end;
$$;
revoke all on function public.delete_drafts(bigint,text[]) from public,anon;
grant execute on function public.delete_drafts(bigint,text[]) to authenticated;

commit;
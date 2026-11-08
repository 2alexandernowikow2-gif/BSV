begin;

create or replace function bsv_private.guard_closed_planning_period() returns trigger
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
      if new_shift is distinct from old_shift and not (
        new_shift is null
        and old_shift->>'published' = 'false'
        and bsv_private.local_instant(old_shift->>'date',old_shift->>'end') <= statement_timestamp()
      ) then
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

create or replace function public.load_schedule() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare actor public.members; state public.schedule_state; retained_shifts jsonb;
begin
  actor := bsv_private.actor();
  select * into state from public.schedule_state where id = 1 for update;
  select coalesce(jsonb_agg(entry.shift order by entry.position),'[]'::jsonb) into retained_shifts
    from jsonb_array_elements(state.data) with ordinality as entry(shift,position)
    where (entry.shift->>'published')::boolean
      or bsv_private.local_instant(entry.shift->>'date',entry.shift->>'end') > statement_timestamp();
  if retained_shifts is distinct from state.data then
    update public.schedule_state set data = retained_shifts,version = state.version + 1 where id = 1;
  end if;
  return bsv_private.snapshot(actor);
end;
$$;

commit;
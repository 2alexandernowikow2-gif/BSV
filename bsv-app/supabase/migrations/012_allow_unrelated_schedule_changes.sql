begin;

create or replace function bsv_private.guard_cancelled_shift_mutations() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if old.data is distinct from new.data and exists (
    select 1 from jsonb_array_elements(old.data) as old_entry(shift)
    join public.shift_cancellations cancellation on cancellation.shift_id = old_entry.shift->>'id'
    where (cancellation.reactivated_at is null or cancellation.reactivated_at < cancellation.cancelled_at)
      and not exists (
        select 1 from jsonb_array_elements(new.data) as new_entry(shift)
        where new_entry.shift->>'id' = old_entry.shift->>'id'
          and (
            new_entry.shift = old_entry.shift
            or (
              auth.uid() is null
              and new_entry.shift - 'tasks' = old_entry.shift - 'tasks'
              and jsonb_array_length(new_entry.shift->'tasks') = jsonb_array_length(old_entry.shift->'tasks')
              and not exists (
                select 1 from jsonb_array_elements(old_entry.shift->'tasks') with ordinality as old_task(value,position)
                left join jsonb_array_elements(new_entry.shift->'tasks') with ordinality as new_task(value,position) using (position)
                where new_task.value is null
                  or new_task.value - 'memberId' is distinct from old_task.value - 'memberId'
                  or (new_task.value->'memberId' <> 'null'::jsonb and new_task.value->'memberId' is distinct from old_task.value->'memberId')
              )
            )
          )
      )
  ) then
    raise exception 'Cancelled shifts cannot be changed before reactivation' using errcode = '55000';
  end if;
  return new;
end;
$$;

commit;
begin;

alter table public.schedule_state disable trigger schedule_state_guard_closed_period;
with normalized as (
  select state.id, coalesce(jsonb_agg(
    jsonb_set(shift, '{tasks}', task_list.tasks, false) order by shift_position
  ), '[]'::jsonb) as data
  from public.schedule_state as state
  cross join lateral jsonb_array_elements(state.data) with ordinality as shifts(shift, shift_position)
  cross join lateral (
    select coalesce(jsonb_agg(
      task || jsonb_build_object(
        'name', mapped.task_name,
        'qualification', case
          when task->'qualification' <> 'null'::jsonb then to_jsonb(case task->>'qualification'
            when 'Berghuette' then 'Bergstation'
            when 'Kasse / Buegel' then 'Kasse'
            when 'Liftaufsicht' then 'Bügel/Liftaufsicht'
            when 'Liftbetrieb' then 'Bügel/Liftaufsicht'
            else task->>'qualification' end)
          when mapped.task_name in ('Betriebswart', 'Kasse', 'Bergstation', 'Bügel/Liftaufsicht') then to_jsonb(mapped.task_name)
          else 'null'::jsonb end
      ) order by task_position
    ), '[]'::jsonb) as tasks
    from jsonb_array_elements(shift->'tasks') with ordinality as task_entries(task, task_position)
    cross join lateral (select case task->>'name'
      when 'Berghuette' then 'Bergstation'
      when 'Kasse / Buegel' then 'Kasse'
      when 'Liftaufsicht' then 'Bügel/Liftaufsicht'
      else task->>'name' end as task_name) as mapped
  ) as task_list
  where state.id = 1
  group by state.id
)
update public.schedule_state as state
set data = normalized.data, version = state.version + 1
from normalized where state.id = normalized.id;
alter table public.schedule_state enable trigger schedule_state_guard_closed_period;

update public.members as member
set qualifications = coalesce((
  select array_agg(distinct case qualification
    when 'Berghuette' then 'Bergstation'
    when 'Kasse / Buegel' then 'Kasse'
    when 'Liftaufsicht' then 'Bügel/Liftaufsicht'
    when 'Liftbetrieb' then 'Bügel/Liftaufsicht'
    else qualification end order by case qualification
    when 'Berghuette' then 'Bergstation'
    when 'Kasse / Buegel' then 'Kasse'
    when 'Liftaufsicht' then 'Bügel/Liftaufsicht'
    when 'Liftbetrieb' then 'Bügel/Liftaufsicht'
    else qualification end)
  from unnest(member.qualifications) as existing(qualification)
), '{}'::text[]);

commit;

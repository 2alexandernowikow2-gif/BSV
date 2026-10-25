begin;

create function pg_temp.assert_true(result boolean, label text) returns void
language plpgsql as $$
begin
  if result is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;

create function pg_temp.expect_error(statement text, expected_code text) returns void
language plpgsql as $$
declare actual_code text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_code = returned_sqlstate;
    if actual_code <> expected_code then
      raise exception 'Expected %, got %: %', expected_code, actual_code, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected rejection: %', statement;
end;
$$;

create function pg_temp.mutate(command jsonb) returns jsonb
language plpgsql as $$
declare snapshot jsonb;
begin
  snapshot := public.load_schedule();
  return public.mutate_schedule((snapshot->>'version')::bigint, command);
end;
$$;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.members(id, user_id, name, email, role, qualifications) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Test Admin', 'admin@example.invalid', 'admin', '{lift}'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Test Member <&>', 'member@example.invalid', 'member', '{lift}'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'Unqualified', null, 'member', '{}');

select pg_temp.expect_error('select public.load_schedule()', '42501');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select pg_temp.expect_error('select * from public.members', '42501');
select pg_temp.expect_error('update public.schedule_state set version = 999', '42501');
select pg_temp.expect_error('select public.claim_notifications(1)', '42501');
select pg_temp.expect_error('select bsv_private.actor()', '42501');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateMember","member":{"id":"20000000-0000-4000-8000-000000000002","name":"Test","email":null,"active":true,"qualifications":[],"role":"admin"}}')$test$, '22023');

select pg_temp.mutate('{"type":"create","shift":{"id":"a","date":"2090-01-03","title":"Tuesday duty","kind":"manual","start":"09:00","end":"13:00","published":false,"tasks":[{"id":"a-lift","name":"Lift","qualification":"lift","offsetMinutes":0,"durationMinutes":120,"memberId":null},{"id":"a-full","name":"Full shift","qualification":null,"offsetMinutes":0,"durationMinutes":null,"memberId":null}]}}');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true(jsonb_array_length(public.load_schedule()->'shifts') = 0, 'members cannot see drafts');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"signup","taskId":"a-lift"}')$test$, '42501');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"create","shift":{"id":"past","date":"2000-01-01","title":"Past","kind":"manual","start":"09:00","end":"13:00","published":false,"tasks":[{"id":"past-task","name":"Past","qualification":null,"offsetMinutes":0,"durationMinutes":null,"memberId":null}]}}')$test$, '22023');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"publish","ids":["a"]}')$test$, '22023');
select pg_temp.mutate('{"type":"settings","email":"recipient@example.invalid"}');
select pg_temp.mutate('{"type":"publish","ids":["a"]}');
select pg_temp.mutate('{"type":"create","shift":{"id":"b","date":"2090-01-03","title":"Adjacent duty","kind":"manual","start":"11:00","end":"13:00","published":true,"tasks":[{"id":"b-task","name":"Adjacent","qualification":null,"offsetMinutes":0,"durationMinutes":null,"memberId":null}]}}');
select pg_temp.mutate('{"type":"generate","shifts":[{"id":"a"}]}');
select pg_temp.mutate('{"type":"create","shift":{"id":"a"}}');
select pg_temp.assert_true(jsonb_array_length(public.load_schedule()->'shifts') = 2, 'generate existing ids does not overwrite');
select pg_temp.expect_error($test$select public.mutate_schedule(0, '{"type":"settings","email":"other@example.invalid"}')$test$, '40001');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateTimes","updates":[{"id":"a","start":"9:00","end":"13:00"}]}')$test$, '22023');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateTimes","updates":[{"id":"a","start":"22:00","end":"01:00"}]}')$test$, '22023');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateTimes","updates":[{"id":"a","start":"09:00","end":"10:00"}]}')$test$, '22023');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateTimes","updates":[{"id":"a","start":"09:00","end":"13:00","date":"2090-02-01"}]}')$test$, '22023');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true(not exists (select 1 from jsonb_array_elements(public.load_schedule()->'members') as entry(member)
  where member ?| array['email','user_id','role']), 'member snapshot contains no contacts or role links');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"settings","email":"attacker@example.invalid"}')$test$, '42501');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"assign","taskId":"a-lift","memberId":null}')$test$, '42501');
select pg_temp.mutate('{"type":"signup","taskId":"a-lift"}');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"signup","taskId":"a-full"}')$test$, '23P01');
select pg_temp.mutate('{"type":"signup","taskId":"b-task"}');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"withdraw","taskId":"a-full"}')$test$, '42501');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select pg_temp.mutate('{"type":"signup","taskId":"a-lift"}');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.mutate('{"type":"assign","taskId":"a-lift","memberId":null}');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"withdraw","taskId":"a-lift"}')$test$, '42501');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.mutate('{"type":"assign","taskId":"a-lift","memberId":"20000000-0000-4000-8000-000000000003"}');
select pg_temp.assert_true(public.load_schedule()->'shifts'->0->'tasks'->0->>'memberId' = '20000000-0000-4000-8000-000000000003', 'unqualified manual assignment is allowed for admin review');
select pg_temp.mutate('{"type":"assign","taskId":"a-lift","memberId":null}');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"updateTimes","updates":[{"id":"b","start":"10:00","end":"13:00"},{"id":"a","start":"09:00","end":"13:00"}]}')$test$, '23P01');
select pg_temp.assert_true(public.load_schedule()->'shifts'->1->>'start' = '11:00', 'bulk overlap rollback');
select public.update_member_seasons((public.load_schedule()->>'version')::bigint,
  '{"id":"20000000-0000-4000-8000-000000000002","name":"Test Member <&>","email":null,"winterActive":false,"summerActive":false,"qualifications":["lift"]}'::jsonb);
select pg_temp.assert_true((select status = 'inactive' and active from public.members where id = '20000000-0000-4000-8000-000000000002'), 'inactive planning status preserves account access and assignment');
select pg_temp.mutate('{"type":"assign","taskId":"b-task","memberId":null}');
reset role;
select pg_temp.assert_true((select count(*) = 0 from public.notification_outbox), 'admin unassign and failures enqueue nothing');
select pg_temp.expect_error($test$select bsv_private.local_instant('2090-02-30','09:00')$test$, '22008');
select pg_temp.expect_error($test$select bsv_private.local_instant('2026-03-29','02:30')$test$, '22023');
select pg_temp.expect_error($test$select bsv_private.local_instant('2026-10-25','02:30')$test$, '22023');
select pg_temp.assert_true(bsv_private.local_instant('2026-03-29','03:30') = '2026-03-29 01:30:00+00'::timestamptz, 'Berlin DST conversion');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select pg_temp.mutate('{"type":"withdraw","taskId":"a-lift"}');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"withdraw","taskId":"a-lift"}')$test$, '42501');
select pg_temp.mutate('{"type":"signup","taskId":"a-lift"}');
select pg_temp.mutate('{"type":"withdraw","taskId":"a-lift"}');
reset role;
select pg_temp.assert_true((select count(*) = 2 from public.notification_outbox), 'one event per successful withdrawal including re-signup');
select pg_temp.assert_true((select bool_and(recipient = 'recipient@example.invalid' and not (payload ?| array['email','user_id','memberId'])) from public.notification_outbox), 'recipient fixed and no contact leakage');

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
create temporary table claims as select * from public.claim_notifications(1);
select pg_temp.assert_true((select count(*) = 1 from claims), 'claim one notification');
select pg_temp.assert_true((select count(*) = 1 from public.claim_notifications(20)), 'second claimant excludes existing lease');
select pg_temp.assert_true((select count(*) = 0 from public.claim_notifications(20)), 'all active leases excluded');
select pg_temp.assert_true(not public.finish_notification((select id from claims), gen_random_uuid(), true), 'wrong token cannot finish');
select pg_temp.assert_true(public.finish_notification((select id from claims), (select lease_token from claims), false, null, 'provider_http_429'), 'retry scheduled');
select pg_temp.assert_true(not public.finish_notification((select id from claims), (select lease_token from claims), true), 'old lease cannot finish twice');
reset role;
select pg_temp.assert_true((select attempts = 1 and status = 'pending' and next_attempt_at > statement_timestamp() from public.notification_outbox where id = (select id from claims)), 'backoff after failure');
update public.notification_outbox set next_attempt_at = statement_timestamp() - interval '1 second' where id = (select id from claims);
set local role service_role;
delete from claims;
insert into claims select * from public.claim_notifications(1);
select pg_temp.assert_true(public.finish_notification((select id from claims), (select lease_token from claims), true, 'test-message-id'), 'successful retry completes');
reset role;
select pg_temp.assert_true((select status = 'sent' and attempts = 2 and sent_at is not null and provider_message_id = 'test-message-id' from public.notification_outbox where id = (select id from claims)), 'successful completion stores receipt');
update public.notification_outbox set status = 'processing', attempts = 5, lease_until = statement_timestamp() - interval '1 second';
set local role service_role;
select pg_temp.assert_true((select count(*) = 0 from public.claim_notifications(20)), 'max five attempts');
reset role;
select pg_temp.assert_true((select bool_and(status = 'failed') from public.notification_outbox), 'exhausted leases terminal');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.update_member((public.load_schedule()->>'version')::bigint,
  '{"id":"20000000-0000-4000-8000-000000000003","name":"Unqualified","email":null,"status":"summer","qualifications":[]}'::jsonb);
select pg_temp.assert_true((select status = 'summer' and active from public.members where id = '20000000-0000-4000-8000-000000000003'), 'summer status remains account active');
select public.update_member((public.load_schedule()->>'version')::bigint,
  '{"id":"20000000-0000-4000-8000-000000000003","name":"Unqualified","email":null,"status":"inactive","qualifications":[]}'::jsonb);
select pg_temp.assert_true((select status = 'inactive' and active from public.members where id = '20000000-0000-4000-8000-000000000003'), 'inactive status does not disable account');
select public.update_member_seasons((public.load_schedule()->>'version')::bigint,
  '{"id":"20000000-0000-4000-8000-000000000003","name":"Unqualified","email":null,"winterActive":true,"summerActive":true,"qualifications":[]}'::jsonb);
select pg_temp.assert_true((select status = 'both' and winter_active and summer_active and active from public.members where id = '20000000-0000-4000-8000-000000000003'), 'both season flags are stored and derive combined status');
select public.update_member_seasons((public.load_schedule()->>'version')::bigint,
  '{"id":"20000000-0000-4000-8000-000000000003","name":"Unqualified","email":null,"winterActive":false,"summerActive":false,"qualifications":[]}'::jsonb);
select pg_temp.assert_true((select status = 'inactive' and not winter_active and not summer_active and active from public.members where id = '20000000-0000-4000-8000-000000000003'), 'both unchecked derives inactive without disabling account');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_true(public.load_schedule() is not null, 'inactive member retains schedule access');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.mutate('{"type":"create","shift":{"id":"monthly-close","date":"2091-01-03","title":"Monthly close duty","kind":"manual","start":"09:00","end":"13:00","published":false,"tasks":[{"id":"monthly-close-task","name":"Monthly close task","qualification":null,"offsetMinutes":0,"durationMinutes":null,"memberId":null}]}}');
select pg_temp.mutate('{"type":"settings","email":"recipient@example.invalid"}');
select pg_temp.mutate('{"type":"publish","ids":["monthly-close"]}');
select pg_temp.mutate('{"type":"assign","taskId":"monthly-close-task","memberId":"20000000-0000-4000-8000-000000000002"}');
select public.set_month_phase((public.load_schedule()->>'version')::bigint, '2091-01', 'closed');
select pg_temp.assert_true(public.load_schedule()->'planningPeriods'->>'2091-01' = 'closed', 'month closure persisted in snapshot');
select pg_temp.expect_error($test$select pg_temp.mutate('{"type":"assign","taskId":"monthly-close-task","memberId":null}')$test$, '55000');
select public.set_month_phase((public.load_schedule()->>'version')::bigint, '2091-01', 'open');
select pg_temp.assert_true(public.load_schedule()->'planningPeriods'->>'2091-01' = 'open', 'closed month can be explicitly reopened');
reset role;

select 'PASS: database authorization, validation, rollback, withdrawal and lease regression tests' as result;
rollback;
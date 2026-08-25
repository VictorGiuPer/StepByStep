-- Run against the linked development project after both partner accounts exist.
-- Every test mutation is rolled back.
begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then raise exception 'ASSERTION FAILED: %', message; end if;
end;
$$;

create temp table test_context as
select min(id) as user_one, max(id) as user_two from public.profiles;

select pg_temp.assert_true((select count(*) = 2 from public.profiles), 'exactly two profiles are required');

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

create temp table test_habit as
select (public.save_habit(
  null, 'Test daily habit', 'CheckCircle2',
  '10000000-0000-4000-8000-000000000001', 'build', 'personal', 'daily', null, 'small', false
)).*;

reset role;
update public.habits set created_at = now() - interval '10 days' where id = (select id from test_habit);
update public.habit_schedule_versions set effective_from = private.household_today() - 5 where habit_id = (select id from test_habit);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

select * from public.log_habit_completion((select id from test_habit), private.household_today() - 2, null);
select * from public.log_habit_completion((select id from test_habit), private.household_today(), null);
select * from public.log_habit_completion((select id from test_habit), private.household_today() - 1, 'backfill');

select pg_temp.assert_true(
  (select sum(points) = 6 from public.points_ledger where user_id = (select user_one from test_context)),
  'three base points plus reconciled streak bonuses should total six'
);

do $$
begin
  perform * from public.log_habit_completion((select id from test_habit), private.household_today(), null);
  raise exception 'duplicate completion unexpectedly succeeded';
exception when unique_violation then null;
end;
$$;

do $$
begin
  update public.points_ledger set points = 999 where user_id = (select user_one from test_context);
  raise exception 'ledger update unexpectedly succeeded';
exception when insufficient_privilege or sqlstate '55000' then null;
end;
$$;

reset role;
insert into public.rewards (name, point_cost, icon, created_by)
values ('Test reward', 4, 'Gift', (select user_one from test_context));
create temp table test_reward as select id from public.rewards where name = 'Test reward';
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);
create temp table test_redemption as select (public.request_redemption((select id from test_reward))).*;

do $$
begin
  perform public.decide_redemption((select id from test_redemption), 'confirmed', null);
  raise exception 'self-confirmation unexpectedly succeeded';
exception when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
select public.decide_redemption((select id from test_redemption), 'confirmed', null);

select pg_temp.assert_true(
  (select balance = 2 from public.point_balances where user_id = (select user_one from test_context)),
  'confirmation should deduct the snapshotted reward cost exactly once'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.points_ledger where redemption_id = (select id from test_redemption)),
  'confirmation must produce one redemption ledger row'
);

rollback;

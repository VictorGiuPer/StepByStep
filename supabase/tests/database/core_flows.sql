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
select (array_agg(id order by id::text))[1] as user_one,
       (array_agg(id order by id::text))[2] as user_two
from public.profiles;
grant select on test_context to authenticated;

select pg_temp.assert_true((select count(*) = 2 from public.profiles), 'exactly two profiles are required');

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

create temp table test_category as select id from public.categories order by sort_order, name limit 1;
select pg_temp.assert_true((select count(*) = 1 from test_category), 'the connected couple needs at least one category');

create temp table test_habit as
select saved.* from public.save_habit(
  null, 'Test daily habit', 'CheckCircle2',
  (select id from test_category), 'build', 'personal', 'daily', null, 'small', false
) saved;

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

create temp table test_shared_todo as
select saved.* from public.save_todo(null, 'Test shared to-do', 'ListTodo', (select id from test_category), 'shared', 'small') saved;
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = 7 from public.point_balances where user_id = (select user_one from test_context)),
  'a shared to-do should award the completing partner immediately'
);

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = 1 from public.point_balances where user_id = (select user_two from test_context)),
  'shared to-do completion should be independent per partner'
);

select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);
select public.toggle_todo_completion((select id from test_shared_todo));
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = 7 from public.point_balances where user_id = (select user_one from test_context)),
  'same-day undo and restore should net back to the original to-do award'
);

create temp table test_personal_todo as
select saved.* from public.save_todo(null, 'Test personal to-do', 'ListTodo', (select id from test_category), 'personal', 'small') saved;
select public.toggle_todo_completion((select id from test_personal_todo));

reset role;
update public.todo_completions set completion_date = private.household_today() - 1
where todo_id = (select id from test_personal_todo) and user_id = (select user_one from test_context);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);
do $$
begin
  perform public.toggle_todo_completion((select id from test_personal_todo));
  raise exception 'old completion undo unexpectedly succeeded';
exception when sqlstate '55000' then null;
end;
$$;

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
do $$
begin
  perform public.delete_todo((select id from test_personal_todo));
  raise exception 'partner deleted a personal to-do';
exception when insufficient_privilege then null;
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
grant select on test_reward to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);
create temp table test_redemption as select requested.* from public.request_redemption((select id from test_reward)) requested;

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
  (select balance = 4 from public.point_balances where user_id = (select user_one from test_context)),
  'confirmation should deduct the snapshotted reward cost exactly once'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.points_ledger where redemption_id = (select id from test_redemption)),
  'confirmation must produce one redemption ledger row'
);

rollback;

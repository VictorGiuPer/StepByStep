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
with selected_users as (
  select (array_agg(id order by id::text))[1] as user_one,
         (array_agg(id order by id::text))[2] as user_two
  from public.profiles
)
select user_one,user_two,
  (select coalesce(sum(points),0) from public.points_ledger where user_id=user_one) as user_one_starting_points,
  (select coalesce(sum(points),0) from public.points_ledger where user_id=user_two) as user_two_starting_points
from selected_users;
grant select on test_context to authenticated;

select pg_temp.assert_true((select count(*) = 2 from public.profiles), 'exactly two profiles are required');

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

create temp table test_category as select id from public.categories order by sort_order, name limit 1;
select pg_temp.assert_true((select count(*) = 1 from test_category), 'the connected couple needs at least one category');

create temp table test_private_category as
with inserted as (
  insert into public.categories(name,icon,color,sort_order,created_by)
  values ('Private test area','Shapes','#758BFD',99,(select user_one from test_context))
  returning id,scope,owner_user_id
)
select id from inserted;
select pg_temp.assert_true(
  (select c.scope='personal' and c.owner_user_id=(select user_one from test_context)
   from public.categories c join test_private_category t on t.id=c.id),
  'new categories should default to private and belong to their creator'
);
insert into public.categories(name,icon,color,sort_order,created_by)
values ('Same name private label','Shapes','#FF8600',98,(select user_one from test_context));

create temp table test_habit as
select saved.* from public.save_habit(
  null, 'Test daily habit', 'CheckCircle2',
  (select id from test_private_category), 'build', 'personal', 'daily', null, 'small', false
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
  (select coalesce(sum(points),0) = max(user_one_starting_points) + 6 from public.points_ledger, test_context where user_id = test_context.user_one),
  'three base points plus reconciled streak bonuses should total six'
);

create temp table test_shared_habit_category as
with inserted as (
  insert into public.categories(name,icon,color,sort_order,created_by)
  values ('Shared habit area','Shapes','#758BFD',100,(select user_one from test_context))
  returning id
)
select id from inserted;
create temp table test_shared_habit as
select saved.* from public.save_habit(
  null,'Test shared habit','CheckCircle2',(select id from test_shared_habit_category),
  'build','shared','daily',null,'small',false
) saved;
select pg_temp.assert_true((select scope='shared' from public.categories where id=(select id from test_shared_habit_category)), 'saving a shared habit should promote its category');

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
select pg_temp.assert_true((select count(*)=0 from public.categories where id=(select id from test_private_category)), 'a partner must not read another user’s personal category');
select pg_temp.assert_true((select count(*)=0 from public.habits where id=(select id from test_habit)), 'a partner must not read another user’s personal habit');
select pg_temp.assert_true((select count(*)=0 from public.habit_completions where habit_id=(select id from test_habit)), 'a partner must not read completion history for a personal habit');
select pg_temp.assert_true((select count(*)=0 from public.ledger_history where habit_id=(select id from test_habit)), 'personal habit point details must stay private');
select pg_temp.assert_true((select count(*)=1 from public.categories where id=(select id from test_shared_habit_category)), 'a shared habit’s promoted category should be partner-visible');
select pg_temp.assert_true((select count(*)=1 from public.habits where id=(select id from test_shared_habit)), 'a shared habit should be partner-visible');
create temp table test_duplicate_private_category as
with inserted as (
  insert into public.categories(name,icon,color,sort_order,created_by)
  values ('Same name private label','Shapes','#FF8600',98,(select user_two from test_context))
  returning id
)
select id from inserted;
reset role;
select pg_temp.assert_true((select count(*)=2 from public.categories where name='Same name private label' and scope='personal'), 'partners may have private categories with the same name');
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

do $$
begin
  perform * from public.log_habit_completion((select id from test_habit), private.household_today(), null);
  raise exception 'duplicate completion unexpectedly succeeded';
exception when unique_violation then null;
end;
$$;

create temp table test_shared_todo as
select saved.* from public.save_todo(null, 'Test shared to-do', 'ListTodo', (select id from test_private_category), 'shared', 'small') saved;
select pg_temp.assert_true((select scope='shared' and owner_user_id is null from public.categories where id=(select id from test_private_category)), 'saving a shared task should promote and retain its category as shared');
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = user_one_starting_points + 7 from public.point_balances, test_context where user_id = test_context.user_one),
  'a shared to-do should award the completing partner immediately'
);

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
select pg_temp.assert_true((select count(*)=1 from public.categories where id=(select id from test_private_category)), 'a promoted shared category should be visible to both partners');
select pg_temp.assert_true((select count(*)=0 from public.habits where id=(select id from test_habit)), 'sharing a category must not share a personal habit that uses it');
select pg_temp.assert_true((select count(*)=0 from public.habit_completions where habit_id=(select id from test_habit)), 'sharing a category must not share personal habit history');
select pg_temp.assert_true((select count(*)=0 from public.ledger_history where habit_id=(select id from test_habit)), 'sharing a category must not share its personal habit point history');
select pg_temp.assert_true((select count(*)=1 from public.todos where id=(select id from test_shared_todo)), 'a shared task should be visible to the partner');
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = user_two_starting_points + 1 from public.point_balances, test_context where user_id = test_context.user_two),
  'shared to-do completion should be independent per partner'
);

select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);
select public.toggle_todo_completion((select id from test_shared_todo));
select public.toggle_todo_completion((select id from test_shared_todo));
select pg_temp.assert_true(
  (select balance = user_one_starting_points + 7 from public.point_balances, test_context where user_id = test_context.user_one),
  'same-day undo and restore should net back to the original to-do award'
);

create temp table test_personal_todo as
select saved.* from public.save_todo(null, 'Test personal to-do', 'ListTodo', (select id from test_category), 'personal', 'small') saved;
select public.toggle_todo_completion((select id from test_personal_todo));

select set_config('request.jwt.claim.sub', (select user_two::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_two from test_context), 'role', 'authenticated')::text, true);
select pg_temp.assert_true((select count(*)=0 from public.todos where id=(select id from test_personal_todo)), 'a partner must not read another user’s personal to-do');
select pg_temp.assert_true((select count(*)=0 from public.todo_completions where todo_id=(select id from test_personal_todo)), 'a partner must not read completion details for a personal to-do');
select set_config('request.jwt.claim.sub', (select user_one::text from test_context), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_one from test_context), 'role', 'authenticated')::text, true);

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
  (select balance = user_one_starting_points + 4 from public.point_balances, test_context where user_id = test_context.user_one),
  'confirmation should deduct the snapshotted reward cost exactly once'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.points_ledger where redemption_id = (select id from test_redemption)),
  'confirmation must produce one redemption ledger row'
);

rollback;

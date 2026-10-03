begin;

-- Intentional one-time reset. Authentication accounts, profiles, the couple
-- connection, household settings, and categories are preserved.
drop trigger if exists points_ledger_append_only on public.points_ledger;

delete from public.points_ledger;
delete from public.redemptions;
delete from public.rewards;
delete from public.todo_completions;
delete from public.todos;
delete from public.habit_weekly_progress_events;
delete from public.habit_weekly_progress;
delete from public.habit_completions;
delete from public.habit_schedule_versions;
delete from public.habits;

create trigger points_ledger_append_only before update or delete on public.points_ledger
for each row execute function private.reject_ledger_mutation();

commit;

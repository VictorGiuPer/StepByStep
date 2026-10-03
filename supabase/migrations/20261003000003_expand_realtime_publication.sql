begin;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'habits', 'categories', 'todos', 'todo_completions',
    'habit_weekly_progress', 'points_ledger', 'rewards'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;

begin;

alter table public.habits add column if not exists deleted_at timestamptz;
alter table public.todos add column if not exists deleted_at timestamptz;
alter table public.todos add column if not exists planned_date date;

create or replace function public.delete_habit(p_habit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); habit_row public.habits%rowtype;
begin
  select * into habit_row from public.habits
  where id = p_habit_id and couple_id = private.current_couple_id(actor) for update;
  if not found then raise exception 'Habit not found' using errcode = 'P0002'; end if;
  if habit_row.scope = 'personal' and habit_row.owner_user_id <> actor then
    raise exception 'Only the owner can delete this personal habit' using errcode = '42501';
  end if;
  update public.habits set deleted_at = coalesce(deleted_at, now()), archived = true where id = p_habit_id;
end; $$;

create or replace function public.delete_todo(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.todos%rowtype;
begin
  select * into existing from public.todos
  where id = p_todo_id and couple_id = private.current_couple_id(actor) for update;
  if not found then raise exception 'To-do not found' using errcode = 'P0002'; end if;
  if existing.scope = 'personal' and existing.owner_user_id <> actor then
    raise exception 'Only the owner can delete this personal to-do' using errcode = '42501';
  end if;
  update public.todos set deleted_at = coalesce(deleted_at, now()), archived = true where id = p_todo_id;
end; $$;

drop function if exists public.save_todo(uuid,text,text,uuid,text,text);

create or replace function public.save_todo(
  p_todo_id uuid, p_name text, p_icon text, p_category_id uuid, p_scope text, p_size text, p_planned_date date default null
)
returns public.todos language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); category_row public.categories%rowtype; existing public.todos%rowtype;
  result public.todos%rowtype; couple uuid := private.current_couple_id(actor);
begin
  if couple is null then raise exception 'Connect with your partner before creating to-dos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'To-do name is required' using errcode = '22023'; end if;
  select * into category_row from public.categories where id = p_category_id and couple_id = couple;
  if not found then raise exception 'Choose a category' using errcode = '22023'; end if;
  if p_scope not in ('personal','shared') or p_size not in ('small','medium','large') then raise exception 'Invalid to-do' using errcode = '22023'; end if;

  if p_todo_id is null then
    insert into public.todos(couple_id,name,icon,category_id,scope,owner_user_id,size,base_points,planned_date)
    values (couple,trim(p_name),coalesce(nullif(trim(p_icon),''),'ListTodo'),p_category_id,p_scope,
      case when p_scope = 'personal' then actor else null end,p_size,
      case p_size when 'small' then 1 when 'medium' then 2 else 3 end,p_planned_date)
    returning * into result;
  else
    select * into existing from public.todos where id = p_todo_id and couple_id = couple and deleted_at is null for update;
    if not found then raise exception 'To-do not found' using errcode = 'P0002'; end if;
    if existing.scope = 'personal' and existing.owner_user_id <> actor then raise exception 'Only the owner can edit this personal to-do' using errcode = '42501'; end if;
    update public.todos set name = trim(p_name), icon = coalesce(nullif(trim(p_icon),''),'ListTodo'), category_id = p_category_id,
      scope = p_scope, owner_user_id = case when p_scope = 'personal' then actor else null end,
      size = p_size, base_points = case p_size when 'small' then 1 when 'medium' then 2 else 3 end,
      planned_date = p_planned_date
    where id = p_todo_id returning * into result;
  end if;
  return result;
end; $$;

-- Let repeated schedule edits replace a pending next-day change.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.save_habit(uuid,text,text,uuid,text,text,text,jsonb,text,boolean)'::regprocedure);
  definition := replace(definition,
    '    if exists (select 1 from public.habit_schedule_versions where habit_id = p_habit_id and effective_from > today_local) then' || chr(10) ||
    '      raise exception ''A schedule change is already waiting to start'' using errcode = ''55000'';' || chr(10) ||
    '    end if;',
    '    delete from public.habit_schedule_versions where habit_id = p_habit_id and effective_from > today_local;');
  if definition like '%A schedule change is already waiting to start%' then raise exception 'Could not update habit schedule editing'; end if;
  execute definition;
end;
$$;

-- Replace the incremental streak award with one point at 7 days, 30 days,
-- and each further 30 days in the same uninterrupted streak.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.log_habit_completion(uuid,date,text)'::regprocedure);
  definition := replace(definition, '  previous_interval date;', '  previous_interval date;' || chr(10) || '  streak_start_date date;' || chr(10) || '  previous_completion_date date;' || chr(10) || '  elapsed_days integer;' || chr(10) || '  previous_elapsed_days integer;');
  definition := replace(definition, '      streak_value := 1;', '      streak_value := 1;' || chr(10) || '      streak_start_date := completion_row.date;');
  definition := replace(definition, '    expected_bonus := least(streak_value - 1, 5);',
    '    if completion_row.id = new_completion_id then' || chr(10) ||
    '      elapsed_days := completion_row.date - streak_start_date;' || chr(10) ||
    '      previous_elapsed_days := coalesce(previous_completion_date - streak_start_date, -1);' || chr(10) ||
    '      expected_bonus := case when elapsed_days >= 6 and previous_elapsed_days < 6 then 1 else 0 end +' || chr(10) ||
    '        (case when elapsed_days >= 29 then 1 + ((elapsed_days - 29) / 30) else 0 end) -' || chr(10) ||
    '        (case when previous_elapsed_days >= 29 then 1 + ((previous_elapsed_days - 29) / 30) else 0 end);' || chr(10) ||
    '    else expected_bonus := 0;' || chr(10) ||
    '    end if;');
  definition := replace(definition, '    previous_interval := completion_row.interval_start;', '    previous_interval := completion_row.interval_start;' || chr(10) || '    previous_completion_date := completion_row.date;');
  if definition not like '%elapsed_days := completion_row.date - streak_start_date%' then
    raise exception 'Could not update streak award logic';
  end if;
  execute definition;
end;
$$;

create or replace function public.toggle_todo_completion(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); today_local date := private.household_today();
  todo_row public.todos%rowtype; completion_row public.todo_completions%rowtype;
begin
  select * into todo_row from public.todos
  where id = p_todo_id and couple_id = private.current_couple_id(actor) and not archived and deleted_at is null for update;
  if not found or (todo_row.scope = 'personal' and todo_row.owner_user_id <> actor) then raise exception 'To-do not found' using errcode = 'P0002'; end if;
  if todo_row.planned_date is not null and todo_row.planned_date > today_local then raise exception 'This to-do is planned for a future date' using errcode = '55000'; end if;
  select * into completion_row from public.todo_completions where todo_id = todo_row.id and user_id = actor for update;
  if found and completion_row.voided_at is null then
    if completion_row.completion_date <> today_local then raise exception 'Completed to-dos can only be undone on their completion day' using errcode = '55000'; end if;
    update public.todo_completions set voided_at = now(), voided_by = actor where todo_id = todo_row.id and user_id = actor;
    insert into public.points_ledger(user_id,date,points,source,todo_id) values(actor,today_local,-todo_row.base_points,'todo_completion_reversal',todo_row.id);
  elsif found then
    update public.todo_completions set completion_date = today_local, completed_at = now(), voided_at = null, voided_by = null where todo_id = todo_row.id and user_id = actor;
    insert into public.points_ledger(user_id,date,points,source,todo_id) values(actor,today_local,todo_row.base_points,'todo_completion_restore',todo_row.id);
  else
    insert into public.todo_completions(todo_id,user_id,completion_date) values(todo_row.id,actor,today_local);
    insert into public.points_ledger(user_id,date,points,source,todo_id) values(actor,today_local,todo_row.base_points,'todo_completion',todo_row.id);
  end if;
end; $$;

grant execute on function public.delete_habit(uuid), public.delete_todo(uuid), public.save_todo(uuid,text,text,uuid,text,text,date) to authenticated;
commit;

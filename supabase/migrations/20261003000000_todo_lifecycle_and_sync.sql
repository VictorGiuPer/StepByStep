begin;

alter table public.todo_completions
  add column if not exists completion_date date,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete restrict;

update public.todo_completions
set completion_date = (completed_at at time zone (select timezone from public.app_settings where id = 1))::date
where completion_date is null;

alter table public.todo_completions
  alter column completion_date set default private.household_today(),
  alter column completion_date set not null;

alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in (
  'habit_completion','streak_bonus','habit_completion_reversal','habit_completion_restore',
  'reward_redemption','todo_completion','todo_completion_reversal','todo_completion_restore',
  'weekly_habit_progress','weekly_habit_progress_reversal'
));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion','streak_bonus','habit_completion_restore') and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and todo_id is null and weekly_progress_event_id is null and points < 0)
  or (source in ('todo_completion','todo_completion_restore') and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and points > 0)
  or (source = 'todo_completion_reversal' and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'weekly_habit_progress' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and points > 0)
  or (source = 'weekly_habit_progress_reversal' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and points < 0)
);

create or replace function public.save_todo(p_todo_id uuid, p_name text, p_icon text, p_category_id uuid, p_scope text, p_size text)
returns public.todos language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  category_row public.categories%rowtype;
  existing public.todos%rowtype;
  result public.todos%rowtype;
  couple uuid := private.current_couple_id(actor);
begin
  if couple is null then raise exception 'Connect with your partner before creating to-dos' using errcode = '42501'; end if;
  select * into category_row from public.categories where id = p_category_id and couple_id = couple;
  if not found then raise exception 'Choose a category' using errcode = '22023'; end if;
  if p_scope not in ('personal','shared') or p_size not in ('small','medium','large') then raise exception 'Invalid to-do' using errcode = '22023'; end if;

  if p_todo_id is null then
    insert into public.todos(couple_id,name,icon,category_id,scope,owner_user_id,size,base_points)
    values (couple,trim(p_name),coalesce(nullif(trim(p_icon),''),'ListTodo'),p_category_id,p_scope,
      case when p_scope = 'personal' then actor else null end,p_size,
      case p_size when 'small' then 1 when 'medium' then 2 else 3 end)
    returning * into result;
  else
    select * into existing from public.todos where id = p_todo_id and couple_id = couple for update;
    if not found then raise exception 'To-do not found' using errcode = 'P0002'; end if;
    if existing.scope = 'personal' and existing.owner_user_id <> actor then
      raise exception 'Only the owner can edit this personal to-do' using errcode = '42501';
    end if;
    update public.todos set
      name = trim(p_name), icon = coalesce(nullif(trim(p_icon),''),'ListTodo'), category_id = p_category_id,
      scope = p_scope, owner_user_id = case when p_scope = 'personal' then actor else null end,
      size = p_size, base_points = case p_size when 'small' then 1 when 'medium' then 2 else 3 end
    where id = p_todo_id returning * into result;
  end if;
  return result;
end; $$;

create or replace function public.delete_todo(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.todos%rowtype;
begin
  select * into existing from public.todos where id = p_todo_id and couple_id = private.current_couple_id(actor) for update;
  if not found then raise exception 'To-do not found' using errcode = 'P0002'; end if;
  if existing.scope = 'personal' and existing.owner_user_id <> actor then
    raise exception 'Only the owner can delete this personal to-do' using errcode = '42501';
  end if;
  delete from public.todos where id = p_todo_id;
end; $$;

create or replace function public.toggle_todo_completion(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  today_local date := private.household_today();
  todo_row public.todos%rowtype;
  completion_row public.todo_completions%rowtype;
begin
  select * into todo_row from public.todos
  where id = p_todo_id and couple_id = private.current_couple_id(actor) and not archived for update;
  if not found or (todo_row.scope = 'personal' and todo_row.owner_user_id <> actor) then
    raise exception 'To-do not found' using errcode = 'P0002';
  end if;

  select * into completion_row from public.todo_completions
  where todo_id = todo_row.id and user_id = actor for update;

  if found and completion_row.voided_at is null then
    if completion_row.completion_date <> today_local then
      raise exception 'Completed to-dos can only be undone on their completion day' using errcode = '55000';
    end if;
    update public.todo_completions set voided_at = now(), voided_by = actor
    where todo_id = todo_row.id and user_id = actor;
    insert into public.points_ledger(user_id,date,points,source,todo_id)
    values(actor,today_local,-todo_row.base_points,'todo_completion_reversal',todo_row.id);
  elsif found then
    update public.todo_completions set completion_date = today_local, completed_at = now(), voided_at = null, voided_by = null
    where todo_id = todo_row.id and user_id = actor;
    insert into public.points_ledger(user_id,date,points,source,todo_id)
    values(actor,today_local,todo_row.base_points,'todo_completion_restore',todo_row.id);
  else
    insert into public.todo_completions(todo_id,user_id,completion_date) values(todo_row.id,actor,today_local);
    insert into public.points_ledger(user_id,date,points,source,todo_id)
    values(actor,today_local,todo_row.base_points,'todo_completion',todo_row.id);
  end if;
end; $$;

grant execute on function public.save_todo(uuid,text,text,uuid,text,text), public.delete_todo(uuid), public.toggle_todo_completion(uuid) to authenticated;

commit;

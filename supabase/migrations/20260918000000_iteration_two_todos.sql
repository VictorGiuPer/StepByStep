begin;

-- Iteration two starts clean. Existing application records are intentionally
-- discarded; Auth accounts can be recreated and linked through the app.
drop trigger if exists points_ledger_append_only on public.points_ledger;
delete from public.points_ledger;
delete from public.redemptions;
delete from public.habit_completions;
delete from public.habit_schedule_versions;
delete from public.habits;
delete from public.rewards;
delete from public.categories;
delete from public.couple_link_requests;
delete from public.couple_members;
delete from public.couples;
create trigger points_ledger_append_only before update or delete on public.points_ledger
for each row execute function private.reject_ledger_mutation();

alter table public.categories add column if not exists scope text not null default 'shared' check (scope in ('personal','shared'));
alter table public.categories add column if not exists owner_user_id uuid references public.profiles(id) on delete cascade;
alter table public.categories add constraint category_scope_owner_check check ((scope = 'shared' and owner_user_id is null) or (scope = 'personal' and owner_user_id is not null));

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  icon text not null default 'ListTodo',
  category_id uuid not null references public.categories(id) on delete restrict,
  scope text not null check (scope in ('personal','shared')),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  size text not null check (size in ('small','medium','large')),
  base_points integer not null check (base_points between 1 and 3),
  archived boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint todo_scope_owner_check check ((scope = 'personal' and owner_user_id is not null) or (scope = 'shared' and owner_user_id is null))
);
create table public.todo_completions (
  todo_id uuid not null references public.todos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (todo_id, user_id)
);
alter table public.todos enable row level security;
alter table public.todo_completions enable row level security;
create policy todos_couple_read on public.todos for select to authenticated using (private.is_couple_member(couple_id));
create policy todo_completions_couple_read on public.todo_completions for select to authenticated using (exists (select 1 from public.todos t where t.id = todo_id and private.is_couple_member(t.couple_id)));
grant select on public.todos, public.todo_completions to authenticated;

-- Couple setup creates private areas for each person plus exactly one shared area.
create or replace function private.create_couple_categories(p_couple_id uuid, p_first uuid, p_second uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.categories (couple_id,name,icon,color,sort_order,scope,owner_user_id) values
    (p_couple_id,'Shared','HeartHandshake','#758BFD',0,'shared',null),
    (p_couple_id,'Health & Body','HeartPulse','#FF8600',1,'personal',p_first),
    (p_couple_id,'Health & Body','HeartPulse','#FF8600',1,'personal',p_second);
end; $$;

-- A single toggle is idempotent from the UI perspective: a voided completion
-- becomes active again instead of colliding with the historical unique index.
create or replace function public.toggle_habit_completion(p_habit_id uuid, p_completion_date date default private.household_today())
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); h public.habits%rowtype; schedule_id uuid; interval_value date; existing public.habit_completions%rowtype;
begin
  select * into h from public.habits where id = p_habit_id and couple_id = private.current_couple_id(actor) and not archived for update;
  if not found then raise exception 'Habit not found' using errcode = 'P0002'; end if;
  if h.scope = 'personal' and h.owner_user_id <> actor then raise exception 'Only the owner can complete this habit' using errcode = '42501'; end if;
  select id into schedule_id from public.habit_schedule_versions where habit_id = h.id and effective_from <= p_completion_date and (effective_to is null or effective_to >= p_completion_date) order by effective_from desc limit 1;
  interval_value := case when h.frequency = 'weekly' then p_completion_date - (extract(isodow from p_completion_date)::integer - 1) else p_completion_date end;
  select * into existing from public.habit_completions where habit_id=h.id and user_id=actor and schedule_version_id=schedule_id and interval_start=interval_value for update;
  if found and existing.voided_at is null then
    update public.habit_completions set voided_at=now(), voided_by=actor where id=existing.id;
    insert into public.points_ledger (user_id,date,points,source,habit_completion_id) select actor,p_completion_date,-sum(points),'habit_completion_reversal',existing.id from public.points_ledger where habit_completion_id=existing.id and points>0;
  elsif found then
    update public.habit_completions set voided_at=null, voided_by=null where id=existing.id;
    insert into public.points_ledger (user_id,date,points,source,habit_completion_id) values (actor,p_completion_date,h.base_points,'habit_completion_restore',existing.id);
  else
    insert into public.habit_completions (habit_id,schedule_version_id,user_id,date,interval_start,base_points_snapshot) values (h.id,schedule_id,actor,p_completion_date,interval_value,h.base_points) returning * into existing;
    insert into public.points_ledger (user_id,date,points,source,habit_completion_id) values (actor,p_completion_date,h.base_points,'habit_completion',existing.id);
  end if;
end; $$;

create or replace function public.toggle_todo_completion(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); t public.todos%rowtype; c public.todo_completions%rowtype;
begin
  select * into t from public.todos where id=p_todo_id and couple_id=private.current_couple_id(actor) and not archived for update;
  if not found or (t.scope='personal' and t.owner_user_id<>actor) then raise exception 'To-do not found' using errcode='P0002'; end if;
  select * into c from public.todo_completions where todo_id=t.id and user_id=actor for update;
  if found then delete from public.todo_completions where todo_id=t.id and user_id=actor; else insert into public.todo_completions(todo_id,user_id) values(t.id,actor); end if;
end; $$;

grant execute on function public.toggle_habit_completion(uuid,date), public.toggle_todo_completion(uuid) to authenticated;
commit;

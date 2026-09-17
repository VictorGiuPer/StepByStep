begin;

create table public.habit_weekly_progress_events (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  delta integer not null check (delta in (-1, 1)),
  created_at timestamptz not null default now()
);
alter table public.habit_weekly_progress_events enable row level security;
create policy weekly_progress_events_read_couple on public.habit_weekly_progress_events for select to authenticated using (
  exists (select 1 from public.habits h where h.id = habit_id and private.is_couple_member(h.couple_id))
);

alter table public.points_ledger add column weekly_progress_event_id uuid references public.habit_weekly_progress_events(id) on delete cascade;
alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in ('habit_completion','streak_bonus','habit_completion_reversal','habit_completion_restore','reward_redemption','todo_completion','todo_completion_reversal','weekly_habit_progress','weekly_habit_progress_reversal'));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion','streak_bonus','habit_completion_restore') and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and todo_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'todo_completion' and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and points > 0)
  or (source = 'todo_completion_reversal' and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'weekly_habit_progress' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and points > 0)
  or (source = 'weekly_habit_progress_reversal' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and points < 0)
);

create or replace function public.set_habit_weekly_target(p_habit_id uuid, p_target integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if p_target is not null and p_target not between 1 and 7 then raise exception 'Weekly target must be between 1 and 7' using errcode = '22023'; end if;
  update public.habits set weekly_target = p_target where id = p_habit_id and couple_id = private.current_couple_id(actor) and (scope = 'shared' or owner_user_id = actor);
  if not found then raise exception 'Habit not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function public.adjust_weekly_habit_progress(p_habit_id uuid, p_delta integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); h public.habits%rowtype; current_week date := private.household_today() - (extract(isodow from private.household_today())::integer - 1); next_count integer; event_id uuid;
begin
  if p_delta not in (-1, 1) then raise exception 'Counter adjustment must be plus or minus one' using errcode = '22023'; end if;
  select * into h from public.habits where id = p_habit_id and couple_id = private.current_couple_id(actor) and weekly_target is not null and not archived for update;
  if not found or (h.scope = 'personal' and h.owner_user_id <> actor) then raise exception 'Flexible weekly habit not found' using errcode = 'P0002'; end if;
  insert into public.habit_weekly_progress(habit_id,user_id,week_start,count) values(h.id,actor,current_week,0) on conflict do nothing;
  select count into next_count from public.habit_weekly_progress where habit_id=h.id and user_id=actor and week_start=current_week for update;
  if p_delta = -1 and next_count = 0 then return 0; end if;
  update public.habit_weekly_progress set count = count + p_delta where habit_id=h.id and user_id=actor and week_start=current_week returning count into next_count;
  insert into public.habit_weekly_progress_events(habit_id,user_id,week_start,delta) values(h.id,actor,current_week,p_delta) returning id into event_id;
  insert into public.points_ledger(user_id,date,points,source,weekly_progress_event_id) values(actor,private.household_today(),h.base_points * p_delta,case when p_delta = 1 then 'weekly_habit_progress' else 'weekly_habit_progress_reversal' end,event_id);
  return next_count;
end; $$;

create or replace view public.ledger_history with (security_invoker = true) as
select l.id,l.user_id,l.date,l.points,l.source,l.created_at,l.habit_completion_id,l.redemption_id,
       coalesce(h.id,wh.id) as habit_id,coalesce(h.name,wh.name,t.name) as habit_name,coalesce(h.category_id,wh.category_id,t.category_id) as category_id,
       cat.name as category_name,r.reward_name_snapshot as reward_name
from public.points_ledger l
left join public.habit_completions c on c.id=l.habit_completion_id
left join public.habits h on h.id=c.habit_id
left join public.habit_weekly_progress_events we on we.id=l.weekly_progress_event_id
left join public.habits wh on wh.id=we.habit_id
left join public.todos t on t.id=l.todo_id
left join public.categories cat on cat.id=coalesce(h.category_id,wh.category_id,t.category_id)
left join public.redemptions r on r.id=l.redemption_id;

grant select on public.habit_weekly_progress_events to authenticated;
grant execute on function public.set_habit_weekly_target(uuid,integer), public.adjust_weekly_habit_progress(uuid,integer) to authenticated;
grant select on public.ledger_history to authenticated;
commit;

begin;

-- Start penalties from rollout day so installing this feature never charges
-- users retroactively for habits they missed before the rule existed.
alter table public.habits
  add column if not exists penalty_effective_from date not null default private.household_today();

create table public.habit_miss_events (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  schedule_version_id uuid references public.habit_schedule_versions(id) on delete restrict,
  scheduled_date date not null,
  kind text not null check (kind in ('scheduled', 'flexible_weekly')),
  points_lost integer not null check (points_lost > 0),
  created_at timestamptz not null default now(),
  constraint habit_miss_event_schedule_shape check (
    (kind = 'scheduled' and schedule_version_id is not null)
    or (kind = 'flexible_weekly' and schedule_version_id is null)
  )
);
create unique index habit_miss_scheduled_unique
  on public.habit_miss_events (habit_id, user_id, schedule_version_id, scheduled_date)
  where kind = 'scheduled';
create unique index habit_miss_flexible_unique
  on public.habit_miss_events (habit_id, user_id, scheduled_date)
  where kind = 'flexible_weekly';
create index habit_miss_user_date_idx on public.habit_miss_events (user_id, scheduled_date);

alter table public.habit_miss_events enable row level security;
create policy habit_miss_events_visible_read on public.habit_miss_events
  for select to authenticated using (private.can_read_habit(habit_id));
grant select on public.habit_miss_events to authenticated;

alter table public.points_ledger
  add column if not exists habit_miss_event_id uuid references public.habit_miss_events(id) on delete restrict;
alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in (
  'habit_completion','streak_bonus','habit_completion_reversal','habit_completion_restore',
  'habit_miss_penalty','reward_redemption','todo_completion','todo_completion_reversal',
  'todo_completion_restore','weekly_habit_progress','weekly_habit_progress_reversal'
));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion','streak_bonus','habit_completion_restore') and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and habit_miss_event_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and habit_miss_event_id is null and points < 0)
  or (source = 'habit_miss_penalty' and habit_miss_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and weekly_progress_event_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and todo_id is null and weekly_progress_event_id is null and habit_miss_event_id is null and points < 0)
  or (source in ('todo_completion','todo_completion_restore') and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and habit_miss_event_id is null and points > 0)
  or (source = 'todo_completion_reversal' and todo_id is not null and habit_completion_id is null and redemption_id is null and weekly_progress_event_id is null and habit_miss_event_id is null and points < 0)
  or (source = 'weekly_habit_progress' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and habit_miss_event_id is null and points > 0)
  or (source = 'weekly_habit_progress_reversal' and weekly_progress_event_id is not null and habit_completion_id is null and redemption_id is null and todo_id is null and habit_miss_event_id is null and points < 0)
);

drop policy if exists ledger_visible_item_read on public.points_ledger;
create policy ledger_visible_item_read on public.points_ledger for select to authenticated
using (private.current_couple_id(user_id)=private.current_couple_id(auth.uid())
  and (habit_completion_id is null or exists(select 1 from public.habit_completions hc where hc.id=habit_completion_id and private.can_read_habit(hc.habit_id)))
  and (todo_id is null or private.can_read_todo(todo_id))
  and (weekly_progress_event_id is null or exists(select 1 from public.habit_weekly_progress_events we where we.id=weekly_progress_event_id and private.can_read_habit(we.habit_id)))
  and (habit_miss_event_id is null or exists(select 1 from public.habit_miss_events me where me.id=habit_miss_event_id and private.can_read_habit(me.habit_id))));

create or replace view public.ledger_history with (security_invoker = true) as
select l.id,l.user_id,l.date,l.points,l.source,l.created_at,l.habit_completion_id,l.redemption_id,
       coalesce(h.id,wh.id,miss_h.id) as habit_id,
       coalesce(h.name,wh.name,miss_h.name,t.name) as habit_name,
       coalesce(h.category_id,wh.category_id,miss_h.category_id,t.category_id) as category_id,
       cat.name as category_name,r.reward_name_snapshot as reward_name
from public.points_ledger l
left join public.habit_completions c on c.id=l.habit_completion_id
left join public.habits h on h.id=c.habit_id
left join public.habit_weekly_progress_events we on we.id=l.weekly_progress_event_id
left join public.habits wh on wh.id=we.habit_id
left join public.habit_miss_events me on me.id=l.habit_miss_event_id
left join public.habits miss_h on miss_h.id=me.habit_id
left join public.todos t on t.id=l.todo_id
left join public.categories cat on cat.id=coalesce(h.category_id,wh.category_id,miss_h.category_id,t.category_id)
left join public.redemptions r on r.id=l.redemption_id;
grant select on public.ledger_history to authenticated;

-- Flexible weekly progress must stop at its target; otherwise extra taps can
-- award unlimited points before the weekly shortfall is calculated.
create or replace function public.adjust_weekly_habit_progress(p_habit_id uuid, p_delta integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); h public.habits%rowtype; current_week date := private.household_today() - (extract(isodow from private.household_today())::integer - 1); next_count integer; event_id uuid;
begin
  if p_delta not in (-1, 1) then raise exception 'Counter adjustment must be plus or minus one' using errcode = '22023'; end if;
  select * into h from public.habits where id = p_habit_id and couple_id = private.current_couple_id(actor) and weekly_target is not null and not archived and deleted_at is null for update;
  if not found or (h.scope = 'personal' and h.owner_user_id <> actor) then raise exception 'Flexible weekly habit not found' using errcode = 'P0002'; end if;
  insert into public.habit_weekly_progress(habit_id,user_id,week_start,count) values(h.id,actor,current_week,0) on conflict do nothing;
  select count into next_count from public.habit_weekly_progress where habit_id=h.id and user_id=actor and week_start=current_week for update;
  if p_delta = -1 and next_count = 0 then return 0; end if;
  if p_delta = 1 and next_count >= h.weekly_target then return next_count; end if;
  update public.habit_weekly_progress set count = count + p_delta where habit_id=h.id and user_id=actor and week_start=current_week returning count into next_count;
  insert into public.habit_weekly_progress_events(habit_id,user_id,week_start,delta) values(h.id,actor,current_week,p_delta) returning id into event_id;
  insert into public.points_ledger(user_id,date,points,source,weekly_progress_event_id) values(actor,private.household_today(),h.base_points * p_delta,case when p_delta = 1 then 'weekly_habit_progress' else 'weekly_habit_progress_reversal' end,event_id);
  return next_count;
end; $$;

create or replace function public.apply_habit_miss_penalties()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  today_local date := private.household_today();
  current_week date := private.household_today() - (extract(isodow from private.household_today())::integer - 1);
  timezone_name text := coalesce((select timezone from public.app_settings where id = 1), 'Europe/Brussels');
  occurrence record;
  event_id uuid;
  target_user uuid;
  applied_count integer := 0;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;

  -- Reconcile both members of the current couple in one pass, so a shared
  -- habit's two personal completion records do not depend on who opens first.
  for target_user in
    select p.id from public.profiles p
    where p.id = actor
      or (private.current_couple_id(actor) is not null and private.current_couple_id(p.id) = private.current_couple_id(actor))
  loop
  -- Daily and selected-day schedules incur one missed entry per due date.
  for occurrence in
    select h.id as habit_id, h.base_points, s.id as schedule_version_id, due.due_date::date as scheduled_date
    from public.habits h
    join public.habit_schedule_versions s on s.habit_id = h.id
    cross join lateral generate_series(
      greatest(s.effective_from, h.penalty_effective_from, (h.created_at at time zone timezone_name)::date),
      least(coalesce(s.effective_to, today_local - 1), today_local - 1), interval '1 day'
    ) due(due_date)
    where h.weekly_target is null and not h.archived and h.deleted_at is null
      and (h.scope = 'shared' or h.owner_user_id = target_user)
      and s.frequency in ('daily','custom_days')
      and (s.frequency = 'daily' or exists (
        select 1 from jsonb_array_elements_text(s.custom_days) day_value(value)
        where day_value.value::integer = extract(isodow from due.due_date)::integer
      ))
      and not exists (
        select 1 from public.habit_completions c
        where c.habit_id=h.id and c.user_id=target_user and c.schedule_version_id=s.id
          and c.interval_start=due.due_date::date and c.voided_at is null
      )
    order by due.due_date
  loop
    event_id := null;
    insert into public.habit_miss_events(habit_id,user_id,schedule_version_id,scheduled_date,kind,points_lost)
    values(occurrence.habit_id,target_user,occurrence.schedule_version_id,occurrence.scheduled_date,'scheduled',occurrence.base_points)
    on conflict do nothing returning id into event_id;
    if event_id is not null then
      insert into public.points_ledger(user_id,date,points,source,habit_miss_event_id)
      values(target_user,occurrence.scheduled_date,-occurrence.base_points,'habit_miss_penalty',event_id);
      applied_count := applied_count + 1;
    end if;
  end loop;

  -- Legacy once-a-week schedules are due after the week closes.
  for occurrence in
    select h.id as habit_id, h.base_points, s.id as schedule_version_id, w.week_start::date as scheduled_date
    from public.habits h
    join public.habit_schedule_versions s on s.habit_id=h.id
    cross join lateral generate_series(
      date_trunc('week', greatest(s.effective_from,h.penalty_effective_from,(h.created_at at time zone timezone_name)::date))::date,
      date_trunc('week', least(coalesce(s.effective_to,today_local-1),today_local-1))::date, interval '1 week'
    ) w(week_start)
    where h.weekly_target is null and not h.archived and h.deleted_at is null
      and (h.scope='shared' or h.owner_user_id=target_user) and s.frequency='weekly'
      and w.week_start + 6 < today_local
      and w.week_start + 6 >= greatest(s.effective_from,h.penalty_effective_from,(h.created_at at time zone timezone_name)::date)
      and w.week_start <= coalesce(s.effective_to,today_local-1)
      and not exists (
        select 1 from public.habit_completions c
        where c.habit_id=h.id and c.user_id=target_user and c.schedule_version_id=s.id
          and c.interval_start=w.week_start::date and c.voided_at is null
      )
    order by w.week_start
  loop
    event_id := null;
    insert into public.habit_miss_events(habit_id,user_id,schedule_version_id,scheduled_date,kind,points_lost)
    values(occurrence.habit_id,target_user,occurrence.schedule_version_id,occurrence.scheduled_date,'scheduled',occurrence.base_points)
    on conflict do nothing returning id into event_id;
    if event_id is not null then
      insert into public.points_ledger(user_id,date,points,source,habit_miss_event_id)
      values(target_user,occurrence.scheduled_date + 6,-occurrence.base_points,'habit_miss_penalty',event_id);
      applied_count := applied_count + 1;
    end if;
  end loop;

  -- Flexible targets are evaluated once the week has ended; each missing
  -- repetition costs the same as completing one repetition earns.
  for occurrence in
    select h.id as habit_id, h.base_points * greatest(0,h.weekly_target-coalesce(p.count,0)) as points_lost,
      w.week_start::date as week_start
    from public.habits h
    join lateral generate_series(
      (date_trunc('week', greatest(h.penalty_effective_from,(h.created_at at time zone timezone_name)::date))::date
        + case when date_trunc('week', greatest(h.penalty_effective_from,(h.created_at at time zone timezone_name)::date))::date < greatest(h.penalty_effective_from,(h.created_at at time zone timezone_name)::date) then 7 else 0 end),
      current_week - 7, interval '1 week'
    ) w(week_start) on true
    left join public.habit_weekly_progress p on p.habit_id=h.id and p.user_id=target_user and p.week_start=w.week_start::date
    where h.weekly_target is not null and not h.archived and h.deleted_at is null
      and (h.scope='shared' or h.owner_user_id=target_user)
      and not exists (select 1 from public.habit_miss_events me where me.habit_id=h.id and me.user_id=target_user and me.scheduled_date=w.week_start::date and me.kind='flexible_weekly')
      and h.weekly_target > coalesce(p.count,0)
    order by w.week_start
  loop
    event_id := null;
    insert into public.habit_miss_events(habit_id,user_id,schedule_version_id,scheduled_date,kind,points_lost)
    values(occurrence.habit_id,target_user,null,occurrence.week_start,'flexible_weekly',occurrence.points_lost)
    on conflict do nothing returning id into event_id;
    if event_id is not null then
      insert into public.points_ledger(user_id,date,points,source,habit_miss_event_id)
      values(target_user,occurrence.week_start + 6,-occurrence.points_lost,'habit_miss_penalty',event_id);
      applied_count := applied_count + 1;
    end if;
  end loop;
  end loop;
  return applied_count;
end; $$;

revoke all on function public.apply_habit_miss_penalties() from public, anon;
grant execute on function public.apply_habit_miss_penalties() to authenticated;
commit;

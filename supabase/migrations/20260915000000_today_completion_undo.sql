begin;

-- A same-day undo keeps the audit trail intact: the completion is marked void and
-- its earned points are offset by a new, append-only ledger row.
alter table public.habit_completions add column if not exists voided_at timestamptz;
alter table public.habit_completions add column if not exists voided_by uuid references public.profiles(id) on delete restrict;

alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in ('habit_completion', 'streak_bonus', 'habit_completion_reversal', 'reward_redemption'));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion', 'streak_bonus') and habit_completion_id is not null and redemption_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and points < 0)
);
create unique index if not exists ledger_completion_reversal_unique on public.points_ledger (habit_completion_id) where source = 'habit_completion_reversal';

create or replace function private.streak_for(p_habit_id uuid, p_user_id uuid, p_as_of date)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare schedule_row public.habit_schedule_versions%rowtype; completion_row record; previous_interval date; last_interval date; streak_count integer := 0; expected_next date; current_week date;
begin
  select * into schedule_row from public.habit_schedule_versions where habit_id = p_habit_id and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of) order by effective_from desc limit 1;
  if not found then return 0; end if;
  for completion_row in select interval_start from public.habit_completions where habit_id = p_habit_id and user_id = p_user_id and schedule_version_id = schedule_row.id and date <= p_as_of and voided_at is null order by interval_start loop
    if previous_interval is null then streak_count := 1;
    elsif schedule_row.frequency = 'daily' and completion_row.interval_start = previous_interval + 1 then streak_count := streak_count + 1;
    elsif schedule_row.frequency = 'weekly' and completion_row.interval_start = previous_interval + 7 then streak_count := streak_count + 1;
    elsif schedule_row.frequency = 'custom_days' and completion_row.interval_start = private.next_custom_day(previous_interval, schedule_row.custom_days) then streak_count := streak_count + 1;
    else streak_count := 1; end if;
    previous_interval := completion_row.interval_start; last_interval := completion_row.interval_start;
  end loop;
  if last_interval is null then return 0; end if;
  if schedule_row.frequency = 'daily' and last_interval < p_as_of - 1 then return 0; end if;
  if schedule_row.frequency = 'weekly' then current_week := p_as_of - (extract(isodow from p_as_of)::integer - 1); if last_interval < current_week - 7 then return 0; end if; end if;
  if schedule_row.frequency = 'custom_days' then expected_next := private.next_custom_day(last_interval, schedule_row.custom_days); if expected_next < p_as_of then return 0; end if; end if;
  return streak_count;
end;
$$;

create or replace function private.undo_today_habit_completion(p_habit_id uuid)
returns table (balance integer, current_streak integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); today_local date := private.household_today(); completion_row public.habit_completions%rowtype; reversal_points integer;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select c.* into completion_row from public.habit_completions c join public.habits h on h.id = c.habit_id where c.habit_id = p_habit_id and c.user_id = actor and c.date = today_local and c.voided_at is null and (h.scope = 'shared' or h.owner_user_id = actor) order by c.created_at desc limit 1 for update;
  if not found then raise exception 'Only a completion from today can be undone' using errcode = 'P0002'; end if;
  select coalesce(sum(points), 0)::integer into reversal_points from public.points_ledger where habit_completion_id = completion_row.id and source in ('habit_completion', 'streak_bonus');
  insert into public.points_ledger (user_id, date, points, source, habit_completion_id) values (actor, today_local, -reversal_points, 'habit_completion_reversal', completion_row.id);
  update public.habit_completions set voided_at = now(), voided_by = actor where id = completion_row.id;
  balance := private.balance_for(actor); current_streak := private.streak_for(p_habit_id, actor, today_local); return next;
end;
$$;

create or replace function public.undo_today_habit_completion(p_habit_id uuid)
returns table (balance integer, current_streak integer)
language sql security invoker set search_path = '' as $$ select * from private.undo_today_habit_completion($1); $$;


create or replace view public.completion_feed with (security_invoker = true) as
select c.id, c.user_id, p.display_name, c.habit_id, h.name as habit_name, h.icon as habit_icon, h.category_id, cat.name as category_name, c.date, c.note, c.created_at
from public.habit_completions c join public.profiles p on p.id = c.user_id join public.habits h on h.id = c.habit_id join public.categories cat on cat.id = h.category_id
where c.voided_at is null;

revoke execute on function private.undo_today_habit_completion(uuid) from public, anon, authenticated;
revoke execute on function public.undo_today_habit_completion(uuid) from public, anon;
grant execute on function private.undo_today_habit_completion(uuid), public.undo_today_habit_completion(uuid) to authenticated;

commit;

begin;

create or replace function private.validate_custom_days(p_frequency text, p_custom_days jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized jsonb;
begin
  if p_frequency <> 'custom_days' then
    return null;
  end if;
  if p_custom_days is null or jsonb_typeof(p_custom_days) <> 'array' or jsonb_array_length(p_custom_days) = 0 then
    raise exception 'Choose at least one custom weekday' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_custom_days) d(value) where d.value !~ '^[1-7]$') then
    raise exception 'Custom weekdays must use ISO values 1 through 7' using errcode = '22023';
  end if;
  select jsonb_agg(day_number order by day_number) into normalized
  from (select distinct value::integer as day_number from jsonb_array_elements_text(p_custom_days)) days;
  return normalized;
end;
$$;

create or replace function private.save_habit(
  p_habit_id uuid,
  p_name text,
  p_icon text,
  p_category_id uuid,
  p_type text,
  p_scope text,
  p_frequency text,
  p_custom_days jsonb,
  p_size text,
  p_archived boolean
)
returns public.habits
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  today_local date := private.household_today();
  normalized_days jsonb;
  points_value integer;
  result_habit public.habits%rowtype;
  old_habit public.habits%rowtype;
  active_schedule public.habit_schedule_versions%rowtype;
  new_start date;
  current_interval date;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Habit name is required' using errcode = '22023'; end if;
  if p_type not in ('build', 'avoid') or p_scope not in ('personal', 'shared') or p_frequency not in ('daily', 'weekly', 'custom_days') or p_size not in ('small', 'medium', 'large') then
    raise exception 'Invalid habit configuration' using errcode = '22023';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then raise exception 'Category not found' using errcode = '23503'; end if;

  normalized_days := private.validate_custom_days(p_frequency, p_custom_days);
  points_value := case p_size when 'small' then 1 when 'medium' then 2 else 3 end;

  if p_habit_id is null then
    insert into public.habits (name, icon, category_id, type, scope, owner_user_id, frequency, custom_days, size, base_points, archived)
    values (trim(p_name), coalesce(nullif(trim(p_icon), ''), 'Circle'), p_category_id, p_type, p_scope,
            case when p_scope = 'personal' then actor else null end,
            p_frequency, normalized_days, p_size, points_value, coalesce(p_archived, false))
    returning * into result_habit;

    insert into public.habit_schedule_versions (habit_id, frequency, custom_days, effective_from)
    values (result_habit.id, p_frequency, normalized_days, today_local);
    return result_habit;
  end if;

  select * into old_habit from public.habits where id = p_habit_id for update;
  if not found then raise exception 'Habit not found' using errcode = 'P0002'; end if;
  if old_habit.scope = 'personal' and old_habit.owner_user_id <> actor then raise exception 'Only the owner can edit this personal habit' using errcode = '42501'; end if;

  if old_habit.frequency is distinct from p_frequency or old_habit.custom_days is distinct from normalized_days then
    if exists (select 1 from public.habit_schedule_versions where habit_id = p_habit_id and effective_from > today_local) then
      raise exception 'A schedule change is already waiting to start' using errcode = '55000';
    end if;

    select * into active_schedule
    from public.habit_schedule_versions
    where habit_id = p_habit_id and effective_from <= today_local and (effective_to is null or effective_to >= today_local)
    order by effective_from desc limit 1 for update;

    current_interval := case when active_schedule.frequency = 'weekly'
      then today_local - (extract(isodow from today_local)::integer - 1)
      else today_local end;

    if exists (
      select 1 from public.habit_completions
      where habit_id = p_habit_id and schedule_version_id = active_schedule.id and interval_start = current_interval
    ) then
      new_start := case when active_schedule.frequency = 'weekly'
        then current_interval + 7 else today_local + 1 end;
    else
      new_start := today_local;
    end if;

    update public.habit_schedule_versions set effective_to = new_start - 1 where id = active_schedule.id;
    insert into public.habit_schedule_versions (habit_id, frequency, custom_days, effective_from)
    values (p_habit_id, p_frequency, normalized_days, new_start);
  end if;

  update public.habits set
    name = trim(p_name), icon = coalesce(nullif(trim(p_icon), ''), 'Circle'), category_id = p_category_id,
    type = p_type, scope = p_scope, owner_user_id = case when p_scope = 'personal' then actor else null end,
    frequency = p_frequency, custom_days = normalized_days, size = p_size,
    base_points = points_value, archived = coalesce(p_archived, false)
  where id = p_habit_id returning * into result_habit;
  return result_habit;
end;
$$;

create or replace function private.streak_for(p_habit_id uuid, p_user_id uuid, p_as_of date)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  schedule_row public.habit_schedule_versions%rowtype;
  completion_row record;
  previous_interval date;
  last_interval date;
  streak_count integer := 0;
  expected_next date;
  current_week date;
begin
  select * into schedule_row from public.habit_schedule_versions
  where habit_id = p_habit_id and effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
  order by effective_from desc limit 1;
  if not found then return 0; end if;

  for completion_row in
    select interval_start from public.habit_completions
    where habit_id = p_habit_id and user_id = p_user_id and schedule_version_id = schedule_row.id and date <= p_as_of
    order by interval_start
  loop
    if previous_interval is null then
      streak_count := 1;
    elsif schedule_row.frequency = 'daily' and completion_row.interval_start = previous_interval + 1 then
      streak_count := streak_count + 1;
    elsif schedule_row.frequency = 'weekly' and completion_row.interval_start = previous_interval + 7 then
      streak_count := streak_count + 1;
    elsif schedule_row.frequency = 'custom_days' and completion_row.interval_start = private.next_custom_day(previous_interval, schedule_row.custom_days) then
      streak_count := streak_count + 1;
    else
      streak_count := 1;
    end if;
    previous_interval := completion_row.interval_start;
    last_interval := completion_row.interval_start;
  end loop;

  if last_interval is null then return 0; end if;
  if schedule_row.frequency = 'daily' and last_interval < p_as_of - 1 then return 0; end if;
  if schedule_row.frequency = 'weekly' then
    current_week := p_as_of - (extract(isodow from p_as_of)::integer - 1);
    if last_interval < current_week - 7 then return 0; end if;
  end if;
  if schedule_row.frequency = 'custom_days' then
    expected_next := private.next_custom_day(last_interval, schedule_row.custom_days);
    if expected_next < p_as_of then return 0; end if;
  end if;
  return streak_count;
end;
$$;

create or replace function private.log_habit_completion(p_habit_id uuid, p_completion_date date, p_note text)
returns table (completion_id uuid, base_points_awarded integer, streak_bonus_awarded integer, current_streak integer, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  today_local date := private.household_today();
  timezone_name text := coalesce((select timezone from public.app_settings where id = 1), 'Europe/Brussels');
  habit_row public.habits%rowtype;
  schedule_row public.habit_schedule_versions%rowtype;
  completion_row record;
  new_completion_id uuid;
  interval_value date;
  previous_interval date;
  streak_value integer := 0;
  expected_bonus integer;
  existing_bonus integer;
  bonus_delta integer;
  total_bonus integer := 0;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_completion_date is null then raise exception 'Completion date is required' using errcode = '22023'; end if;
  if p_completion_date > today_local then raise exception 'Future completions are not allowed' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_habit_id::text || actor::text, 0));
  select * into habit_row from public.habits where id = p_habit_id for update;
  if not found then raise exception 'Habit not found' using errcode = 'P0002'; end if;
  if habit_row.archived then raise exception 'Archived habits cannot be completed' using errcode = '55000'; end if;
  if habit_row.scope = 'personal' and habit_row.owner_user_id <> actor then raise exception 'Only the owner can complete this habit' using errcode = '42501'; end if;
  if p_completion_date < (habit_row.created_at at time zone timezone_name)::date then raise exception 'Cannot log a completion before the habit was created' using errcode = '22023'; end if;

  select * into schedule_row from public.habit_schedule_versions
  where habit_id = p_habit_id and effective_from <= p_completion_date and (effective_to is null or effective_to >= p_completion_date)
  order by effective_from desc limit 1;
  if not found then raise exception 'No schedule applies to this date' using errcode = '22023'; end if;

  if schedule_row.frequency = 'custom_days' and not exists (
    select 1 from jsonb_array_elements_text(schedule_row.custom_days) d(value)
    where d.value::integer = extract(isodow from p_completion_date)::integer
  ) then raise exception 'This habit is not scheduled for that weekday' using errcode = '22023'; end if;

  interval_value := case when schedule_row.frequency = 'weekly'
    then p_completion_date - (extract(isodow from p_completion_date)::integer - 1)
    else p_completion_date end;

  begin
    insert into public.habit_completions (habit_id, schedule_version_id, user_id, date, interval_start, note, base_points_snapshot)
    values (p_habit_id, schedule_row.id, actor, p_completion_date, interval_value, nullif(trim(p_note), ''), habit_row.base_points)
    returning id into new_completion_id;
  exception when unique_violation then
    raise exception 'This habit is already completed for that interval' using errcode = '23505';
  end;

  insert into public.points_ledger (user_id, date, points, source, habit_completion_id)
  values (actor, p_completion_date, habit_row.base_points, 'habit_completion', new_completion_id);

  for completion_row in
    select id, interval_start, date from public.habit_completions
    where habit_id = p_habit_id and user_id = actor and schedule_version_id = schedule_row.id
    order by interval_start
  loop
    if previous_interval is null then
      streak_value := 1;
    elsif schedule_row.frequency = 'daily' and completion_row.interval_start = previous_interval + 1 then
      streak_value := streak_value + 1;
    elsif schedule_row.frequency = 'weekly' and completion_row.interval_start = previous_interval + 7 then
      streak_value := streak_value + 1;
    elsif schedule_row.frequency = 'custom_days' and completion_row.interval_start = private.next_custom_day(previous_interval, schedule_row.custom_days) then
      streak_value := streak_value + 1;
    else
      streak_value := 1;
    end if;

    expected_bonus := least(streak_value - 1, 5);
    select coalesce(sum(points), 0)::integer into existing_bonus from public.points_ledger
    where habit_completion_id = completion_row.id and source = 'streak_bonus';
    bonus_delta := expected_bonus - existing_bonus;
    if bonus_delta > 0 then
      insert into public.points_ledger (user_id, date, points, source, habit_completion_id)
      values (actor, completion_row.date, bonus_delta, 'streak_bonus', completion_row.id);
      total_bonus := total_bonus + bonus_delta;
    end if;
    previous_interval := completion_row.interval_start;
  end loop;

  completion_id := new_completion_id;
  base_points_awarded := habit_row.base_points;
  streak_bonus_awarded := total_bonus;
  current_streak := private.streak_for(p_habit_id, actor, today_local);
  balance := private.balance_for(actor);
  return next;
end;
$$;

create or replace function private.update_completion_note(p_completion_id uuid, p_note text)
returns public.habit_completions
language plpgsql
security definer
set search_path = ''
as $$
declare result_row public.habit_completions%rowtype;
begin
  update public.habit_completions set note = nullif(trim(p_note), '')
  where id = p_completion_id and user_id = auth.uid() returning * into result_row;
  if not found then raise exception 'Completion not found' using errcode = 'P0002'; end if;
  return result_row;
end;
$$;

create or replace function private.request_redemption(p_reward_id uuid)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  reward_row public.rewards%rowtype;
  result_row public.redemptions%rowtype;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('redemption:' || actor::text, 0));
  select * into reward_row from public.rewards where id = p_reward_id for update;
  if not found or reward_row.archived then raise exception 'Reward is unavailable' using errcode = 'P0002'; end if;
  if private.balance_for(actor) < reward_row.point_cost then raise exception 'Not enough points for this reward' using errcode = '22003'; end if;
  if exists (select 1 from public.redemptions where reward_id = p_reward_id and redeemed_by = actor and status = 'pending_confirmation') then
    raise exception 'You already have a pending request for this reward' using errcode = '23505';
  end if;
  insert into public.redemptions (reward_id, reward_name_snapshot, point_cost_snapshot, redeemed_by, date_requested)
  values (reward_row.id, reward_row.name, reward_row.point_cost, actor, private.household_today())
  returning * into result_row;
  return result_row;
end;
$$;

create or replace function private.decide_redemption(p_redemption_id uuid, p_decision text, p_reason text)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  redemption_row public.redemptions%rowtype;
begin
  if not private.is_app_member(actor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_decision not in ('confirmed', 'declined') then raise exception 'Decision must be confirmed or declined' using errcode = '22023'; end if;
  select * into redemption_row from public.redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Redemption not found' using errcode = 'P0002'; end if;
  if redemption_row.status <> 'pending_confirmation' then raise exception 'This request has already been decided' using errcode = '55000'; end if;
  if redemption_row.redeemed_by = actor then raise exception 'The other partner must decide this request' using errcode = '42501'; end if;

  if p_decision = 'confirmed' then
    perform pg_advisory_xact_lock(hashtextextended('redemption:' || redemption_row.redeemed_by::text, 0));
    if private.balance_for(redemption_row.redeemed_by) < redemption_row.point_cost_snapshot then
      raise exception 'The requester no longer has enough points' using errcode = '22003';
    end if;
    insert into public.points_ledger (user_id, date, points, source, redemption_id)
    values (redemption_row.redeemed_by, private.household_today(), -redemption_row.point_cost_snapshot, 'reward_redemption', redemption_row.id);
  end if;

  update public.redemptions set
    status = p_decision,
    decided_by = actor,
    date_decided = private.household_today(),
    date_confirmed = case when p_decision = 'confirmed' then private.household_today() else null end,
    decision_note = case when p_decision = 'declined' then nullif(trim(p_reason), '') else null end
  where id = p_redemption_id returning * into redemption_row;
  return redemption_row;
end;
$$;

create or replace function public.save_habit(
  p_habit_id uuid, p_name text, p_icon text, p_category_id uuid, p_type text, p_scope text,
  p_frequency text, p_custom_days jsonb, p_size text, p_archived boolean
)
returns public.habits language sql security invoker set search_path = '' as $$
  select private.save_habit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$$;

create or replace function public.log_habit_completion(p_habit_id uuid, p_completion_date date, p_note text default null)
returns table (completion_id uuid, base_points_awarded integer, streak_bonus_awarded integer, current_streak integer, balance integer)
language sql security invoker set search_path = '' as $$
  select * from private.log_habit_completion($1,$2,$3);
$$;

create or replace function public.update_completion_note(p_completion_id uuid, p_note text)
returns public.habit_completions language sql security invoker set search_path = '' as $$
  select private.update_completion_note($1,$2);
$$;

create or replace function public.request_redemption(p_reward_id uuid)
returns public.redemptions language sql security invoker set search_path = '' as $$
  select private.request_redemption($1);
$$;

create or replace function public.decide_redemption(p_redemption_id uuid, p_decision text, p_reason text default null)
returns public.redemptions language sql security invoker set search_path = '' as $$
  select private.decide_redemption($1,$2,$3);
$$;

create or replace function public.get_habit_streaks(p_user_id uuid default auth.uid())
returns table (habit_id uuid, user_id uuid, current_streak integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_app_member(auth.uid()) or not private.is_app_member(p_user_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query
    select h.id, p_user_id, private.streak_for(h.id, p_user_id, private.household_today())
    from public.habits h
    where not h.archived and (h.scope = 'shared' or h.owner_user_id = p_user_id)
    order by h.created_at;
end;
$$;

create or replace function public.healthcheck()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'date', current_date);
$$;

grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.save_habit(uuid,text,text,uuid,text,text,text,jsonb,text,boolean) to authenticated;
grant execute on function private.log_habit_completion(uuid,date,text) to authenticated;
grant execute on function private.update_completion_note(uuid,text) to authenticated;
grant execute on function private.request_redemption(uuid) to authenticated;
grant execute on function private.decide_redemption(uuid,text,text) to authenticated;
grant execute on function private.is_app_member(uuid), private.household_today(), private.streak_for(uuid,uuid,date) to authenticated;

revoke execute on function public.save_habit(uuid,text,text,uuid,text,text,text,jsonb,text,boolean) from public, anon;
revoke execute on function public.log_habit_completion(uuid,date,text) from public, anon;
revoke execute on function public.update_completion_note(uuid,text) from public, anon;
revoke execute on function public.request_redemption(uuid) from public, anon;
revoke execute on function public.decide_redemption(uuid,text,text) from public, anon;
revoke execute on function public.get_habit_streaks(uuid) from public, anon;
grant execute on function public.save_habit(uuid,text,text,uuid,text,text,text,jsonb,text,boolean) to authenticated;
grant execute on function public.log_habit_completion(uuid,date,text) to authenticated;
grant execute on function public.update_completion_note(uuid,text) to authenticated;
grant execute on function public.request_redemption(uuid) to authenticated;
grant execute on function public.decide_redemption(uuid,text,text) to authenticated;
grant execute on function public.get_habit_streaks(uuid) to authenticated;
grant execute on function public.healthcheck() to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'habit_completions') then
    alter publication supabase_realtime add table public.habit_completions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'redemptions') then
    alter publication supabase_realtime add table public.redemptions;
  end if;
end;
$$;

commit;

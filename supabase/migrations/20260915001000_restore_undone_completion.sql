begin;

alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in ('habit_completion', 'streak_bonus', 'habit_completion_reversal', 'habit_completion_restore', 'reward_redemption'));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion', 'streak_bonus', 'habit_completion_restore') and habit_completion_id is not null and redemption_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and points < 0)
);

create or replace function private.log_or_restore_habit_completion(p_habit_id uuid, p_completion_date date, p_note text)
returns table (completion_id uuid, base_points_awarded integer, streak_bonus_awarded integer, current_streak integer, balance integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); today_local date := private.household_today(); completion_row public.habit_completions%rowtype; restored_points integer;
begin
  if p_completion_date = today_local then
    select c.* into completion_row from public.habit_completions c join public.habits h on h.id = c.habit_id where c.habit_id = p_habit_id and c.user_id = actor and c.date = today_local and c.voided_at is not null and (h.scope = 'shared' or h.owner_user_id = actor) order by c.voided_at desc limit 1 for update;
    if found then
      select coalesce(-sum(points), 0)::integer into restored_points from public.points_ledger where habit_completion_id = completion_row.id and source = 'habit_completion_reversal';
      insert into public.points_ledger (user_id, date, points, source, habit_completion_id) values (actor, today_local, restored_points, 'habit_completion_restore', completion_row.id);
      update public.habit_completions set voided_at = null, voided_by = null where id = completion_row.id;
      completion_id := completion_row.id; base_points_awarded := completion_row.base_points_snapshot; streak_bonus_awarded := greatest(restored_points - completion_row.base_points_snapshot, 0); current_streak := private.streak_for(p_habit_id, actor, today_local); balance := private.balance_for(actor); return next;
    end if;
  end if;
  return query select * from private.log_habit_completion(p_habit_id, p_completion_date, p_note);
end;
$$;

create or replace function public.log_or_restore_habit_completion(p_habit_id uuid, p_completion_date date, p_note text default null)
returns table (completion_id uuid, base_points_awarded integer, streak_bonus_awarded integer, current_streak integer, balance integer)
language sql security invoker set search_path = '' as $$ select * from private.log_or_restore_habit_completion($1, $2, $3); $$;

revoke execute on function private.log_or_restore_habit_completion(uuid,date,text) from public, anon, authenticated;
revoke execute on function public.log_or_restore_habit_completion(uuid,date,text) from public, anon;
grant execute on function private.log_or_restore_habit_completion(uuid,date,text), public.log_or_restore_habit_completion(uuid,date,text) to authenticated;

commit;

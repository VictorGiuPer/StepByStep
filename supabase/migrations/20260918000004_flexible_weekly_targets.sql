begin;

alter table public.habits add column if not exists weekly_target integer check (weekly_target between 1 and 7);

create table public.habit_weekly_progress (
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  count integer not null default 0 check (count >= 0),
  primary key (habit_id, user_id, week_start)
);
alter table public.habit_weekly_progress enable row level security;
create policy weekly_progress_read_couple on public.habit_weekly_progress for select to authenticated using (exists (select 1 from public.habits h where h.id=habit_id and private.is_couple_member(h.couple_id)));
grant select on public.habit_weekly_progress to authenticated;

create or replace function public.adjust_weekly_habit_progress(p_habit_id uuid, p_delta integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h public.habits%rowtype; current_week date:=private.household_today()-(extract(isodow from private.household_today())::integer-1); next_count integer;
begin
  select * into h from public.habits where id=p_habit_id and couple_id=private.current_couple_id(actor) and weekly_target is not null and not archived;
  if not found or (h.scope='personal' and h.owner_user_id<>actor) then raise exception 'Flexible weekly habit not found' using errcode='P0002'; end if;
  insert into public.habit_weekly_progress(habit_id,user_id,week_start,count) values(h.id,actor,current_week,0) on conflict do nothing;
  update public.habit_weekly_progress set count=greatest(0,count+p_delta) where habit_id=h.id and user_id=actor and week_start=current_week returning count into next_count;
  return next_count;
end; $$;
grant execute on function public.adjust_weekly_habit_progress(uuid,integer) to authenticated;
commit;

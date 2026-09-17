begin;

alter table public.points_ledger add column if not exists todo_id uuid references public.todos(id) on delete cascade;
alter table public.points_ledger drop constraint if exists points_ledger_source_check;
alter table public.points_ledger drop constraint if exists ledger_source_reference_check;
alter table public.points_ledger add constraint points_ledger_source_check check (source in ('habit_completion','streak_bonus','habit_completion_reversal','habit_completion_restore','reward_redemption','todo_completion','todo_completion_reversal'));
alter table public.points_ledger add constraint ledger_source_reference_check check (
  (source in ('habit_completion','streak_bonus','habit_completion_restore') and habit_completion_id is not null and redemption_id is null and todo_id is null and points > 0)
  or (source = 'habit_completion_reversal' and habit_completion_id is not null and redemption_id is null and todo_id is null and points < 0)
  or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and todo_id is null and points < 0)
  or (source = 'todo_completion' and todo_id is not null and habit_completion_id is null and redemption_id is null and points > 0)
  or (source = 'todo_completion_reversal' and todo_id is not null and habit_completion_id is null and redemption_id is null and points < 0)
);
create unique index ledger_todo_completion_unique on public.points_ledger(todo_id,user_id) where source='todo_completion';

create or replace function public.toggle_todo_completion(p_todo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); t public.todos%rowtype; was_complete boolean; participant uuid;
begin
  select * into t from public.todos where id=p_todo_id and couple_id=private.current_couple_id(actor) and not archived for update;
  if not found or (t.scope='personal' and t.owner_user_id<>actor) then raise exception 'To-do not found' using errcode='P0002'; end if;
  select exists(select 1 from public.todo_completions where todo_id=t.id and user_id=actor) into was_complete;
  if was_complete then
    if t.scope='personal' or (select count(*) from public.todo_completions where todo_id=t.id)=2 then
      for participant in select user_id from public.todo_completions where todo_id=t.id loop
        insert into public.points_ledger(user_id,date,points,source,todo_id) values(participant,private.household_today(),-t.base_points,'todo_completion_reversal',t.id);
      end loop;
    end if;
    delete from public.todo_completions where todo_id=t.id and user_id=actor;
  else
    insert into public.todo_completions(todo_id,user_id) values(t.id,actor);
    if t.scope='personal' or (select count(*) from public.todo_completions where todo_id=t.id)=2 then
      for participant in select user_id from public.todo_completions where todo_id=t.id loop
        insert into public.points_ledger(user_id,date,points,source,todo_id) values(participant,private.household_today(),t.base_points,'todo_completion',t.id) on conflict do nothing;
      end loop;
    end if;
  end if;
end; $$;

create or replace view public.ledger_history with (security_invoker = true) as
select l.id,l.user_id,l.date,l.points,l.source,l.created_at,l.habit_completion_id,l.redemption_id,
       h.id as habit_id,coalesce(h.name,t.name) as habit_name,coalesce(h.category_id,t.category_id) as category_id,
       cat.name as category_name,r.reward_name_snapshot as reward_name
from public.points_ledger l
left join public.habit_completions c on c.id=l.habit_completion_id
left join public.habits h on h.id=c.habit_id
left join public.todos t on t.id=l.todo_id
left join public.categories cat on cat.id=coalesce(h.category_id,t.category_id)
left join public.redemptions r on r.id=l.redemption_id;
grant select on public.ledger_history to authenticated;

commit;

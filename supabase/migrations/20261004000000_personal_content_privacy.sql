begin;
drop index if exists public.categories_name_unique;
drop index if exists public.categories_couple_name_unique;

-- The legacy trigger compares every category row with auth.uid()'s couple.
-- Migrations run without an end-user identity, so pause it only while this
-- migration safely normalizes existing category rows and their references.
alter table public.categories disable trigger categories_couple_boundary;

-- Existing authored categories become personal unless a shared item still uses them.
update public.categories c
set scope = case when exists (select 1 from public.habits h where h.category_id=c.id and h.scope='shared')
                    or exists (select 1 from public.todos t where t.category_id=c.id and t.scope='shared')
                 then 'shared' else 'personal' end,
    owner_user_id = case when exists (select 1 from public.habits h where h.category_id=c.id and h.scope='shared')
                            or exists (select 1 from public.todos t where t.category_id=c.id and t.scope='shared')
                         then null else c.created_by end
where c.created_by is not null;

-- Older personal items could point at a partner-authored label because all
-- categories were previously couple-visible. Preserve those items by giving
-- their owner a private copy of that label and remapping only their records.
do $$
declare source_category public.categories%rowtype; member_row record; private_category_id uuid;
begin
  for source_category in select * from public.categories
    where scope='personal' and owner_user_id=created_by
  loop
    for member_row in
      select cm.user_id from public.couple_members cm
      where cm.couple_id=source_category.couple_id and cm.user_id<>source_category.owner_user_id
        and (exists(select 1 from public.habits h where h.category_id=source_category.id
                    and h.scope='personal' and h.owner_user_id=cm.user_id)
          or exists(select 1 from public.todos t where t.category_id=source_category.id
                    and t.scope='personal' and t.owner_user_id=cm.user_id))
    loop
      select id into private_category_id from public.categories
        where couple_id=source_category.couple_id and lower(name)=lower(source_category.name)
          and scope='personal' and owner_user_id=member_row.user_id limit 1;
      if private_category_id is null then
        insert into public.categories(couple_id,name,icon,color,sort_order,created_by,scope,owner_user_id)
        values(source_category.couple_id,source_category.name,source_category.icon,source_category.color,
          source_category.sort_order,member_row.user_id,'personal',member_row.user_id)
        returning id into private_category_id;
      end if;
      update public.habits set category_id=private_category_id
        where category_id=source_category.id and scope='personal' and owner_user_id=member_row.user_id;
      update public.todos set category_id=private_category_id
        where category_id=source_category.id and scope='personal' and owner_user_id=member_row.user_id;
    end loop;
  end loop;
end;
$$;

-- Older system categories without a creator receive one private copy per member.
do $$
declare old_category public.categories%rowtype; member_row record; private_category_id uuid; keep_shared boolean;
begin
  for old_category in select * from public.categories
    where created_by is null and lower(name)<>'shared' and scope='shared'
  loop
    for member_row in select user_id from public.couple_members where couple_id=old_category.couple_id loop
      select id into private_category_id from public.categories
        where couple_id=old_category.couple_id and lower(name)=lower(old_category.name)
          and scope='personal' and owner_user_id=member_row.user_id limit 1;
      if private_category_id is null then
        insert into public.categories(couple_id,name,icon,color,sort_order,created_by,scope,owner_user_id)
        values(old_category.couple_id,old_category.name,old_category.icon,old_category.color,
          old_category.sort_order,member_row.user_id,'personal',member_row.user_id)
        returning id into private_category_id;
      end if;
      update public.habits set category_id=private_category_id
        where category_id=old_category.id and scope='personal' and owner_user_id=member_row.user_id;
      update public.todos set category_id=private_category_id
        where category_id=old_category.id and scope='personal' and owner_user_id=member_row.user_id;
    end loop;
    select exists(select 1 from public.habits where category_id=old_category.id and scope='shared')
        or exists(select 1 from public.todos where category_id=old_category.id and scope='shared') into keep_shared;
    if not keep_shared then delete from public.categories where id=old_category.id; end if;
  end loop;
end;
$$;

update public.categories set scope='shared',owner_user_id=null
where created_by is null and lower(name)='shared';

alter table public.categories enable trigger categories_couple_boundary;

create or replace function private.prevent_shared_category_demotion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.scope='shared' and new.scope<>'shared' then
    raise exception 'A shared category stays shared so it can be reused' using errcode='55000';
  end if;
  return new;
end;
$$;
drop trigger if exists shared_category_cannot_become_private on public.categories;
create trigger shared_category_cannot_become_private before update of scope on public.categories
for each row execute function private.prevent_shared_category_demotion();
alter table public.categories alter column scope set default 'personal';
alter table public.categories alter column owner_user_id set default auth.uid();
create unique index categories_shared_name_unique on public.categories(couple_id,lower(name)) where scope='shared';
create unique index categories_personal_owner_name_unique on public.categories(couple_id,owner_user_id,lower(name)) where scope='personal';

create or replace function private.can_read_habit(p_habit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.habits h where h.id=p_habit_id
    and private.is_couple_member(h.couple_id) and (h.scope='shared' or h.owner_user_id=auth.uid()));
$$;
create or replace function private.can_read_todo(p_todo_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.todos t where t.id=p_todo_id
    and private.is_couple_member(t.couple_id) and (t.scope='shared' or t.owner_user_id=auth.uid()));
$$;

create or replace function private.promote_item_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare category_row public.categories%rowtype; shared_category_id uuid; actor uuid := auth.uid();
begin
  select * into category_row from public.categories
  where id=new.category_id and couple_id=new.couple_id for update;
  if not found then raise exception 'Choose a category in your couple account' using errcode='22023'; end if;
  if category_row.scope='personal' and category_row.owner_user_id<>actor then
    raise exception 'You can only use your own personal categories' using errcode='42501';
  end if;
  if new.scope='shared' and category_row.scope='personal' then
    select id into shared_category_id from public.categories
      where couple_id=new.couple_id and scope='shared' and lower(name)=lower(category_row.name)
      limit 1;
    if shared_category_id is not null then
      new.category_id := shared_category_id;
    else
      update public.categories set scope='shared',owner_user_id=null where id=category_row.id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists promote_habit_category on public.habits;
create trigger promote_habit_category before insert or update of category_id,scope on public.habits
for each row execute function private.promote_item_category();
drop trigger if exists promote_todo_category on public.todos;
create trigger promote_todo_category before insert or update of category_id,scope on public.todos
for each row execute function private.promote_item_category();

drop policy if exists categories_couple_access on public.categories;
create policy categories_private_shared_read on public.categories for select to authenticated
using(private.is_couple_member(couple_id) and (scope='shared' or owner_user_id=auth.uid()));
create policy categories_owner_insert on public.categories for insert to authenticated
with check(private.is_couple_member(couple_id) and created_by=auth.uid()
  and ((scope='personal' and owner_user_id=auth.uid()) or (scope='shared' and owner_user_id is null)));
create policy categories_owner_or_shared_update on public.categories for update to authenticated
using(private.is_couple_member(couple_id) and (scope='shared' or owner_user_id=auth.uid()))
with check(private.is_couple_member(couple_id)
  and ((scope='shared' and owner_user_id is null) or (scope='personal' and owner_user_id=auth.uid())));
create policy categories_owner_or_shared_delete on public.categories for delete to authenticated
using(private.is_couple_member(couple_id) and (scope='shared' or owner_user_id=auth.uid()));

drop policy if exists habits_couple_read on public.habits;
create policy habits_owner_or_shared_read on public.habits for select to authenticated
using(private.is_couple_member(couple_id) and (scope='shared' or owner_user_id=auth.uid()));
drop policy if exists schedules_couple_read on public.habit_schedule_versions;
create policy schedules_visible_habit_read on public.habit_schedule_versions for select to authenticated
using(private.can_read_habit(habit_id));
drop policy if exists completions_couple_read on public.habit_completions;
create policy completions_visible_habit_read on public.habit_completions for select to authenticated
using(private.can_read_habit(habit_id));
drop policy if exists todos_couple_read on public.todos;
create policy todos_owner_or_shared_read on public.todos for select to authenticated
using(private.is_couple_member(couple_id) and (scope='shared' or owner_user_id=auth.uid()));
drop policy if exists todo_completions_couple_read on public.todo_completions;
create policy todo_completions_visible_todo_read on public.todo_completions for select to authenticated
using(private.can_read_todo(todo_id));
drop policy if exists weekly_progress_read_couple on public.habit_weekly_progress;
create policy weekly_progress_visible_habit_read on public.habit_weekly_progress for select to authenticated
using(private.can_read_habit(habit_id));
drop policy if exists weekly_progress_events_read_couple on public.habit_weekly_progress_events;
create policy weekly_progress_events_visible_habit_read on public.habit_weekly_progress_events for select to authenticated
using(private.can_read_habit(habit_id));

-- Keep balance summaries couple-readable but restrict ledger details for private items.
drop policy if exists ledger_couple_read on public.points_ledger;
create policy ledger_visible_item_read on public.points_ledger for select to authenticated
using(private.current_couple_id(user_id)=private.current_couple_id(auth.uid())
  and (habit_completion_id is null or exists(select 1 from public.habit_completions hc
    where hc.id=habit_completion_id and private.can_read_habit(hc.habit_id)))
  and (todo_id is null or private.can_read_todo(todo_id))
  and (weekly_progress_event_id is null or exists(select 1 from public.habit_weekly_progress_events we
    where we.id=weekly_progress_event_id and private.can_read_habit(we.habit_id))));
create or replace view public.point_balances with (security_invoker = false) as
select p.id as user_id,coalesce(sum(l.points),0)::integer as balance
from public.profiles p left join public.points_ledger l on l.user_id=p.id
where private.current_couple_id(p.id)=private.current_couple_id(auth.uid())
group by p.id;

grant execute on function private.can_read_habit(uuid),private.can_read_todo(uuid) to authenticated;
revoke execute on function private.promote_item_category(),private.prevent_shared_category_demotion() from public,anon,authenticated;
commit;

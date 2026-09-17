begin;

-- A profile is an individual account.  A couple is created only once both
-- people have explicitly accepted the connection.
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid primary key references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (couple_id, user_id)
);
create unique index couple_members_two_people on public.couple_members (couple_id, user_id);

create table public.couple_link_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  requested_to uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint link_request_distinct_people check (requested_by <> requested_to)
);
create unique index one_pending_link_per_pair on public.couple_link_requests
  (least(requested_by, requested_to), greatest(requested_by, requested_to)) where status = 'pending';

alter table public.categories add column couple_id uuid references public.couples(id) on delete cascade;
alter table public.habits add column couple_id uuid references public.couples(id) on delete cascade;
alter table public.rewards add column couple_id uuid references public.couples(id) on delete cascade;
alter table public.redemptions add column couple_id uuid references public.couples(id) on delete cascade;

-- Preserve the pre-linking app as one couple when this migration is applied.
do $$
declare legacy_couple uuid;
begin
  if exists (select 1 from public.profiles) and not exists (select 1 from public.couple_members) then
    insert into public.couples default values returning id into legacy_couple;
    insert into public.couple_members (couple_id, user_id) select legacy_couple, id from public.profiles;
    update public.categories set couple_id = legacy_couple where couple_id is null;
    update public.habits set couple_id = legacy_couple where couple_id is null;
    update public.rewards set couple_id = legacy_couple where couple_id is null;
    update public.redemptions set couple_id = legacy_couple where couple_id is null;
  end if;
end $$;

-- Seed categories exist before either account is linked on a fresh project.
-- They are templates only; linked couples receive their own copies.
alter table public.habits alter column couple_id set not null;
alter table public.rewards alter column couple_id set not null;
alter table public.redemptions alter column couple_id set not null;
drop index if exists public.categories_name_unique;
create unique index categories_couple_name_unique on public.categories (couple_id, lower(name));
create index habits_couple_idx on public.habits (couple_id, created_at);
create index rewards_couple_idx on public.rewards (couple_id, created_at desc);
create index redemptions_couple_idx on public.redemptions (couple_id, created_at desc);

create or replace function private.current_couple_id(p_user_id uuid default auth.uid())
returns uuid language sql stable security definer set search_path = '' as $$
  select cm.couple_id from public.couple_members cm where cm.user_id = p_user_id;
$$;

create or replace function private.is_couple_member(p_couple_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_couple_id is not null and exists (select 1 from public.couple_members cm where cm.couple_id = p_couple_id and cm.user_id = p_user_id);
$$;

create or replace function private.is_app_member(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_couple_id(p_user_id) is not null;
$$;

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_link_requests enable row level security;

create policy couples_read_members on public.couples for select to authenticated using (private.is_couple_member(id));
create policy members_read_own_couple on public.couple_members for select to authenticated using (private.is_couple_member(couple_id));
create policy link_requests_read_participants on public.couple_link_requests for select to authenticated using (requested_by = auth.uid() or requested_to = auth.uid());

-- Profiles are deliberately not searchable. The linking RPC resolves email on the
-- server, while this policy exposes only yourself and an accepted partner.
drop policy if exists profiles_read_members on public.profiles;
create policy profiles_read_self_or_partner on public.profiles for select to authenticated using (
  id = auth.uid() or (private.current_couple_id(auth.uid()) is not null and private.current_couple_id(id) = private.current_couple_id(auth.uid()))
);
drop policy if exists settings_read_members on public.app_settings;
create policy settings_read_authenticated on public.app_settings for select to authenticated using (auth.uid() is not null);
drop policy if exists settings_update_members on public.app_settings;
create policy settings_update_authenticated on public.app_settings for update to authenticated using (auth.uid() is not null) with check (id = 1);

drop policy if exists categories_read_members on public.categories;
drop policy if exists categories_insert_members on public.categories;
drop policy if exists categories_update_members on public.categories;
drop policy if exists categories_delete_members on public.categories;
create policy categories_couple_access on public.categories for all to authenticated using (private.is_couple_member(couple_id)) with check (private.is_couple_member(couple_id));
drop policy if exists habits_read_members on public.habits;
drop policy if exists habits_insert_valid_owner on public.habits;
drop policy if exists habits_update_owner_or_shared on public.habits;
create policy habits_couple_read on public.habits for select to authenticated using (private.is_couple_member(couple_id));
drop policy if exists schedule_read_members on public.habit_schedule_versions;
create policy schedules_couple_read on public.habit_schedule_versions for select to authenticated using (exists (select 1 from public.habits h where h.id = habit_id and private.is_couple_member(h.couple_id)));
drop policy if exists completions_read_members on public.habit_completions;
create policy completions_couple_read on public.habit_completions for select to authenticated using (exists (select 1 from public.habits h where h.id = habit_id and private.is_couple_member(h.couple_id)));
drop policy if exists rewards_read_members on public.rewards;
drop policy if exists rewards_insert_members on public.rewards;
drop policy if exists rewards_update_members on public.rewards;
create policy rewards_couple_access on public.rewards for all to authenticated using (private.is_couple_member(couple_id)) with check (private.is_couple_member(couple_id));
drop policy if exists redemptions_read_members on public.redemptions;
create policy redemptions_couple_read on public.redemptions for select to authenticated using (private.is_couple_member(couple_id));
drop policy if exists ledger_read_members on public.points_ledger;
create policy ledger_couple_read on public.points_ledger for select to authenticated using (private.current_couple_id(user_id) = private.current_couple_id(auth.uid()));

-- No arbitrary user id is ever returned to the client while linking.
create or replace function public.request_couple_link(p_email text)
returns public.couple_link_requests language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); target uuid; result public.couple_link_requests%rowtype;
begin
  if actor is null then raise exception 'Sign in to connect with your partner' using errcode = '42501'; end if;
  if private.current_couple_id(actor) is not null then raise exception 'Your account is already connected' using errcode = '55000'; end if;
  select u.id into target from auth.users u where lower(u.email) = lower(trim(p_email));
  if target is null then raise exception 'No account exists for that email yet' using errcode = 'P0002'; end if;
  if target = actor then raise exception 'Choose your partner’s email address' using errcode = '22023'; end if;
  if private.current_couple_id(target) is not null then raise exception 'That account is already connected' using errcode = '55000'; end if;
  update public.couple_link_requests set status = 'cancelled', decided_at = now()
    where requested_by = actor and status = 'pending';
  insert into public.couple_link_requests (requested_by, requested_to) values (actor, target) returning * into result;
  return result;
exception when unique_violation then
  raise exception 'A connection request between these accounts is already pending' using errcode = '23505';
end;
$$;

create or replace function public.decide_couple_link(p_request_id uuid, p_accept boolean)
returns public.couple_link_requests language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); request_row public.couple_link_requests%rowtype; new_couple uuid;
begin
  select * into request_row from public.couple_link_requests where id = p_request_id for update;
  if not found or request_row.requested_to <> actor then raise exception 'Connection request not found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'This connection request has already been decided' using errcode = '55000'; end if;
  if private.current_couple_id(actor) is not null or private.current_couple_id(request_row.requested_by) is not null then raise exception 'One of these accounts is already connected' using errcode = '55000'; end if;
  if p_accept then
    insert into public.couples default values returning id into new_couple;
    insert into public.couple_members (couple_id, user_id) values (new_couple, actor), (new_couple, request_row.requested_by);
    -- Each new couple starts with the familiar category set.
    insert into public.categories (name, icon, color, sort_order, created_by, couple_id) values
      ('Health & Body','HeartPulse','#FF8600',1,null,new_couple), ('Mind & Reflection','Brain','#758BFD',2,null,new_couple),
      ('Learning & Growth','BookOpen','#27187E',3,null,new_couple), ('Creativity & Play','Palette','#AEB8FE',4,null,new_couple),
      ('Relationships & Social','Users','#FF8600',5,null,new_couple), ('Home & Life Admin','House','#758BFD',6,null,new_couple),
      ('Finance','WalletCards','#27187E',7,null,new_couple), ('Career & Craft','BriefcaseBusiness','#758BFD',8,null,new_couple);
  end if;
  update public.couple_link_requests set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now() where id = p_request_id returning * into request_row;
  return request_row;
end;
$$;

create or replace function public.get_couple_link_state()
returns table (state text, request_id uuid, requested_by uuid, requested_to uuid, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select case when private.current_couple_id(auth.uid()) is not null then 'connected' else coalesce(r.status, 'unlinked') end,
         r.id, r.requested_by, r.requested_to, r.created_at
  from (select 1) x left join lateral (
    select * from public.couple_link_requests where (requested_by = auth.uid() or requested_to = auth.uid()) and status = 'pending' order by created_at desc limit 1
  ) r on true;
$$;

-- Existing authoritative functions use this membership check. Couple ids are
-- populated automatically in their insert paths by these defaults.
alter table public.categories alter column couple_id set default private.current_couple_id();
alter table public.habits alter column couple_id set default private.current_couple_id();
alter table public.rewards alter column couple_id set default private.current_couple_id();
alter table public.redemptions alter column couple_id set default private.current_couple_id();

create or replace function public.get_habit_streaks(p_user_id uuid default auth.uid())
returns table (habit_id uuid, user_id uuid, current_streak integer)
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_app_member(auth.uid()) or private.current_couple_id(p_user_id) <> private.current_couple_id(auth.uid()) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query select h.id, p_user_id, private.streak_for(h.id, p_user_id, private.household_today())
    from public.habits h where not h.archived and h.couple_id = private.current_couple_id(auth.uid()) and (h.scope = 'shared' or h.owner_user_id = p_user_id) order by h.created_at;
end;
$$;

-- Authoritative RPCs are security-definer functions. These guards keep their
-- object lookups contained to the caller's couple even if an id is guessed.
create or replace function private.enforce_couple_boundary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_couple uuid := private.current_couple_id(auth.uid()); object_couple uuid;
begin
  if tg_table_name = 'categories' or tg_table_name = 'habits' or tg_table_name = 'rewards' or tg_table_name = 'redemptions' then
    if new.couple_id is distinct from actor_couple then raise exception 'Not authorized for this couple' using errcode = '42501'; end if;
  elsif tg_table_name = 'habit_schedule_versions' then
    select couple_id into object_couple from public.habits where id = new.habit_id;
    if object_couple is distinct from actor_couple then raise exception 'Not authorized for this habit' using errcode = '42501'; end if;
  elsif tg_table_name = 'habit_completions' then
    select couple_id into object_couple from public.habits where id = new.habit_id;
    if object_couple is distinct from actor_couple or new.user_id <> auth.uid() then raise exception 'Not authorized for this habit' using errcode = '42501'; end if;
  elsif tg_table_name = 'points_ledger' then
    if private.current_couple_id(new.user_id) is distinct from actor_couple then raise exception 'Not authorized for this balance' using errcode = '42501'; end if;
  end if;
  return new;
end;
$$;
create trigger categories_couple_boundary before insert or update on public.categories for each row execute function private.enforce_couple_boundary();
create trigger habits_couple_boundary before insert or update on public.habits for each row execute function private.enforce_couple_boundary();
create trigger rewards_couple_boundary before insert or update on public.rewards for each row execute function private.enforce_couple_boundary();
create trigger redemptions_couple_boundary before insert or update on public.redemptions for each row execute function private.enforce_couple_boundary();
create trigger schedules_couple_boundary before insert or update on public.habit_schedule_versions for each row execute function private.enforce_couple_boundary();
create trigger completions_couple_boundary before insert or update on public.habit_completions for each row execute function private.enforce_couple_boundary();
create trigger ledger_couple_boundary before insert on public.points_ledger for each row execute function private.enforce_couple_boundary();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url) values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Partner'), nullif(new.raw_user_meta_data ->> 'avatar_url', ''));
  return new;
end;
$$;

grant select on public.couples, public.couple_members, public.couple_link_requests to authenticated;
grant execute on function public.request_couple_link(text), public.decide_couple_link(uuid,boolean), public.get_couple_link_state(), private.current_couple_id(uuid), private.is_couple_member(uuid,uuid) to authenticated;
revoke execute on function public.request_couple_link(text), public.decide_couple_link(uuid,boolean) from anon, public;

commit;

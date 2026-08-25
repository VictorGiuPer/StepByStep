begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'Europe/Brussels',
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  icon text not null default 'Shapes',
  color text not null default '#758BFD' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index categories_name_unique on public.categories (lower(name));
create index categories_sort_order_idx on public.categories (sort_order, name);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  icon text not null default 'Circle',
  category_id uuid not null references public.categories(id) on delete restrict,
  type text not null check (type in ('build', 'avoid')),
  scope text not null check (scope in ('personal', 'shared')),
  owner_user_id uuid references public.profiles(id) on delete restrict,
  frequency text not null check (frequency in ('daily', 'weekly', 'custom_days')),
  custom_days jsonb,
  size text not null check (size in ('small', 'medium', 'large')),
  base_points integer not null check (base_points > 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habits_scope_owner_check check (
    (scope = 'personal' and owner_user_id is not null)
    or (scope = 'shared' and owner_user_id is null)
  ),
  constraint habits_custom_days_shape_check check (
    (frequency = 'custom_days' and custom_days is not null and jsonb_typeof(custom_days) = 'array' and jsonb_array_length(custom_days) > 0)
    or (frequency <> 'custom_days' and custom_days is null)
  )
);

create index habits_category_active_idx on public.habits (category_id, archived, created_at);
create index habits_owner_active_idx on public.habits (owner_user_id, archived);

create table public.habit_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly', 'custom_days')),
  custom_days jsonb,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint schedule_date_order_check check (effective_to is null or effective_to >= effective_from),
  constraint schedule_custom_days_shape_check check (
    (frequency = 'custom_days' and custom_days is not null and jsonb_typeof(custom_days) = 'array' and jsonb_array_length(custom_days) > 0)
    or (frequency <> 'custom_days' and custom_days is null)
  )
);

create unique index schedule_version_start_unique on public.habit_schedule_versions (habit_id, effective_from);
create unique index schedule_one_open_version on public.habit_schedule_versions (habit_id) where effective_to is null;
create index schedule_version_lookup_idx on public.habit_schedule_versions (habit_id, effective_from, effective_to);

create table public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete restrict,
  schedule_version_id uuid not null references public.habit_schedule_versions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  date date not null,
  interval_start date not null,
  note text check (note is null or char_length(note) <= 500),
  base_points_snapshot integer not null check (base_points_snapshot > 0),
  created_at timestamptz not null default now(),
  unique (habit_id, user_id, date),
  unique (habit_id, user_id, schedule_version_id, interval_start)
);

create index completions_user_date_idx on public.habit_completions (user_id, date desc);
create index completions_habit_user_date_idx on public.habit_completions (habit_id, user_id, date desc);
create index completions_created_at_idx on public.habit_completions (created_at desc);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  point_cost integer not null check (point_cost > 0),
  icon text not null default 'Gift',
  created_by uuid not null references public.profiles(id) on delete restrict,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rewards_active_idx on public.rewards (archived, created_at desc);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards(id) on delete restrict,
  reward_name_snapshot text not null,
  point_cost_snapshot integer not null check (point_cost_snapshot > 0),
  redeemed_by uuid not null references public.profiles(id) on delete restrict,
  date_requested date not null,
  date_confirmed date,
  date_decided date,
  decided_by uuid references public.profiles(id) on delete restrict,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  status text not null default 'pending_confirmation' check (status in ('pending_confirmation', 'confirmed', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redemption_decision_shape_check check (
    (status = 'pending_confirmation' and decided_by is null and date_decided is null and date_confirmed is null)
    or (status = 'confirmed' and decided_by is not null and date_decided is not null and date_confirmed is not null)
    or (status = 'declined' and decided_by is not null and date_decided is not null and date_confirmed is null)
  )
);

create unique index redemptions_one_pending_reward on public.redemptions (reward_id, redeemed_by) where status = 'pending_confirmation';
create index redemptions_pending_idx on public.redemptions (status, created_at desc);
create index redemptions_requester_idx on public.redemptions (redeemed_by, created_at desc);

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  date date not null,
  points integer not null check (points <> 0),
  source text not null check (source in ('habit_completion', 'streak_bonus', 'reward_redemption')),
  habit_completion_id uuid references public.habit_completions(id) on delete restrict,
  redemption_id uuid references public.redemptions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ledger_source_reference_check check (
    (source in ('habit_completion', 'streak_bonus') and habit_completion_id is not null and redemption_id is null and points > 0)
    or (source = 'reward_redemption' and redemption_id is not null and habit_completion_id is null and points < 0)
  )
);

create unique index ledger_base_completion_unique on public.points_ledger (habit_completion_id) where source = 'habit_completion';
create unique index ledger_redemption_unique on public.points_ledger (redemption_id) where source = 'reward_redemption';
create index ledger_user_date_idx on public.points_ledger (user_id, date, created_at);
create index ledger_completion_bonus_idx on public.points_ledger (habit_completion_id) where source = 'streak_bonus';

insert into public.app_settings (id, timezone) values (1, 'Europe/Brussels') on conflict (id) do nothing;

insert into public.categories (id, name, icon, color, sort_order, created_by) values
  ('10000000-0000-4000-8000-000000000001', 'Health & Body', 'HeartPulse', '#FF8600', 1, null),
  ('10000000-0000-4000-8000-000000000002', 'Mind & Reflection', 'Brain', '#758BFD', 2, null),
  ('10000000-0000-4000-8000-000000000003', 'Learning & Growth', 'BookOpen', '#27187E', 3, null),
  ('10000000-0000-4000-8000-000000000004', 'Creativity & Play', 'Palette', '#AEB8FE', 4, null),
  ('10000000-0000-4000-8000-000000000005', 'Relationships & Social', 'Users', '#FF8600', 5, null),
  ('10000000-0000-4000-8000-000000000006', 'Home & Life Admin', 'House', '#758BFD', 6, null),
  ('10000000-0000-4000-8000-000000000007', 'Finance', 'WalletCards', '#27187E', 7, null),
  ('10000000-0000-4000-8000-000000000008', 'Career & Craft', 'BriefcaseBusiness', '#758BFD', 8, null)
on conflict (id) do nothing;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings for each row execute function private.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function private.set_updated_at();
create trigger habits_set_updated_at before update on public.habits for each row execute function private.set_updated_at();
create trigger rewards_set_updated_at before update on public.rewards for each row execute function private.set_updated_at();
create trigger redemptions_set_updated_at before update on public.redemptions for each row execute function private.set_updated_at();

create or replace function private.reject_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'points_ledger is append-only' using errcode = '55000';
end;
$$;

create trigger points_ledger_append_only before update or delete on public.points_ledger
for each row execute function private.reject_ledger_mutation();

do $$
begin
  if (select count(*) from auth.users) > 2 then
    raise exception 'StepByStep supports exactly two Auth users';
  end if;
end;
$$;

insert into public.profiles (id, display_name, avatar_url)
select id,
       coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(email, '@', 1), ''), 'Partner'),
       nullif(raw_user_meta_data ->> 'avatar_url', '')
from auth.users
on conflict (id) do nothing;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(74638821);
  if (select count(*) from public.profiles) >= 2 then
    raise exception 'StepByStep supports exactly two accounts';
  end if;
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Partner'),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.is_app_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (select 1 from public.profiles p where p.id = p_user_id);
$$;

create or replace function private.household_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.app_settings where id = 1), 'Europe/Brussels'))::date;
$$;

create or replace function private.balance_for(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer from public.points_ledger where user_id = p_user_id;
$$;

create or replace function private.next_custom_day(p_date date, p_days jsonb)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate date := p_date + 1;
begin
  for offset_days in 1..7 loop
    if exists (
      select 1 from jsonb_array_elements_text(p_days) d(value)
      where d.value::integer = extract(isodow from candidate)::integer
    ) then
      return candidate;
    end if;
    candidate := candidate + 1;
  end loop;
  raise exception 'custom_days must contain at least one weekday';
end;
$$;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.habits enable row level security;
alter table public.habit_schedule_versions enable row level security;
alter table public.habit_completions enable row level security;
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;
alter table public.points_ledger enable row level security;

create policy profiles_read_members on public.profiles for select to authenticated using ((select private.is_app_member()));
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy settings_read_members on public.app_settings for select to authenticated using ((select private.is_app_member()));
create policy settings_update_members on public.app_settings for update to authenticated using ((select private.is_app_member())) with check (id = 1 and (select private.is_app_member()));
create policy categories_read_members on public.categories for select to authenticated using ((select private.is_app_member()));
create policy categories_insert_members on public.categories for insert to authenticated with check ((select private.is_app_member()) and created_by = (select auth.uid()));
create policy categories_update_members on public.categories for update to authenticated using ((select private.is_app_member())) with check ((select private.is_app_member()));
create policy categories_delete_members on public.categories for delete to authenticated using ((select private.is_app_member()));
create policy habits_read_members on public.habits for select to authenticated using ((select private.is_app_member()));
create policy habits_insert_valid_owner on public.habits for insert to authenticated with check (
  (select private.is_app_member()) and ((scope = 'personal' and owner_user_id = (select auth.uid())) or (scope = 'shared' and owner_user_id is null))
);
create policy habits_update_owner_or_shared on public.habits for update to authenticated using (
  (select private.is_app_member()) and (scope = 'shared' or owner_user_id = (select auth.uid()))
) with check (
  (select private.is_app_member()) and ((scope = 'shared' and owner_user_id is null) or (scope = 'personal' and owner_user_id = (select auth.uid())))
);
create policy schedule_read_members on public.habit_schedule_versions for select to authenticated using ((select private.is_app_member()));
create policy completions_read_members on public.habit_completions for select to authenticated using ((select private.is_app_member()));
create policy rewards_read_members on public.rewards for select to authenticated using ((select private.is_app_member()));
create policy rewards_insert_members on public.rewards for insert to authenticated with check ((select private.is_app_member()) and created_by = (select auth.uid()));
create policy rewards_update_members on public.rewards for update to authenticated using ((select private.is_app_member())) with check ((select private.is_app_member()));
create policy redemptions_read_members on public.redemptions for select to authenticated using ((select private.is_app_member()));
create policy ledger_read_members on public.points_ledger for select to authenticated using ((select private.is_app_member()));

revoke insert, update, delete on public.habit_schedule_versions, public.habit_completions, public.redemptions, public.points_ledger from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.categories, public.rewards to authenticated;
grant update on public.profiles, public.app_settings to authenticated;

create or replace view public.point_balances with (security_invoker = true) as
select p.id as user_id, coalesce(sum(l.points), 0)::integer as balance
from public.profiles p
left join public.points_ledger l on l.user_id = p.id
group by p.id;

create or replace view public.completion_feed with (security_invoker = true) as
select c.id, c.user_id, p.display_name, c.habit_id, h.name as habit_name, h.icon as habit_icon,
       h.category_id, cat.name as category_name, c.date, c.note, c.created_at
from public.habit_completions c
join public.profiles p on p.id = c.user_id
join public.habits h on h.id = c.habit_id
join public.categories cat on cat.id = h.category_id;

create or replace view public.ledger_history with (security_invoker = true) as
select l.id, l.user_id, l.date, l.points, l.source, l.created_at,
       l.habit_completion_id, l.redemption_id,
       h.id as habit_id, h.name as habit_name, h.category_id, cat.name as category_name,
       r.reward_name_snapshot as reward_name
from public.points_ledger l
left join public.habit_completions c on c.id = l.habit_completion_id
left join public.habits h on h.id = c.habit_id
left join public.categories cat on cat.id = h.category_id
left join public.redemptions r on r.id = l.redemption_id;

grant select on public.point_balances, public.completion_feed, public.ledger_history to authenticated;

commit;

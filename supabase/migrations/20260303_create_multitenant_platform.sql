create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  handle text unique,
  region text not null default 'AU-NSW',
  timezone text not null default 'Australia/Sydney',
  avatar_url text,
  bio text,
  is_public boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_energy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Primary Setup',
  is_default boolean not null default true,
  amber_site_id text,
  amber_token_encrypted text,
  battery_mode text not null default 'modbus',
  battery_host text,
  battery_port integer,
  battery_unit_id integer,
  battery_base_addr integer,
  battery_byte_order text,
  ha_url text,
  ha_token_encrypted text,
  solcast_api_key_encrypted text,
  cloud_vendor text,
  cloud_credentials_encrypted jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_energy_configs_default_per_user
  on public.user_energy_configs (user_id)
  where is_default = true;

create table if not exists public.strategy_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  mode text not null default 'threshold',
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  latest_profit_aud numeric(12, 2),
  latest_score numeric(12, 2),
  latest_backtest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists strategy_profiles_active_per_user
  on public.strategy_profiles (user_id)
  where is_active = true;

create table if not exists public.presence_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  region text not null,
  page text not null,
  is_online boolean not null default true,
  client_id text,
  meta jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presence_sessions_online_idx
  on public.presence_sessions (is_online, region, last_seen_at desc);

create table if not exists public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  region text not null,
  bucket text not null default 'daily',
  bucket_start date not null,
  score numeric(12, 2) not null default 0,
  profit_aud numeric(12, 2) not null default 0,
  roi_pct numeric(12, 2) not null default 0,
  efficiency_score numeric(12, 2) not null default 0,
  cycles numeric(12, 2) not null default 0,
  export_kwh numeric(12, 2) not null default 0,
  import_kwh numeric(12, 2) not null default 0,
  telemetry_quality text not null default 'simulated',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaderboard_entries_unique unique (user_id, bucket, bucket_start)
);

create index if not exists leaderboard_entries_region_idx
  on public.leaderboard_entries (bucket, bucket_start desc, region, score desc);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  unlocked_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint achievements_unique unique (user_id, code)
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists user_energy_configs_set_updated_at on public.user_energy_configs;
create trigger user_energy_configs_set_updated_at
before update on public.user_energy_configs
for each row execute function public.set_updated_at();

drop trigger if exists strategy_profiles_set_updated_at on public.strategy_profiles;
create trigger strategy_profiles_set_updated_at
before update on public.strategy_profiles
for each row execute function public.set_updated_at();

drop trigger if exists presence_sessions_set_updated_at on public.presence_sessions;
create trigger presence_sessions_set_updated_at
before update on public.presence_sessions
for each row execute function public.set_updated_at();

drop trigger if exists leaderboard_entries_set_updated_at on public.leaderboard_entries;
create trigger leaderboard_entries_set_updated_at
before update on public.leaderboard_entries
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_energy_configs enable row level security;
alter table public.strategy_profiles enable row level security;
alter table public.presence_sessions enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.achievements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_select'
  ) then
    create policy profiles_self_select
      on public.profiles
      for select
      to authenticated
      using (auth.uid() = id or is_public = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_upsert'
  ) then
    create policy profiles_self_upsert
      on public.profiles
      for all
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_energy_configs' and policyname = 'user_energy_configs_owner'
  ) then
    create policy user_energy_configs_owner
      on public.user_energy_configs
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'strategy_profiles' and policyname = 'strategy_profiles_owner'
  ) then
    create policy strategy_profiles_owner
      on public.strategy_profiles
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'presence_sessions' and policyname = 'presence_sessions_owner'
  ) then
    create policy presence_sessions_owner
      on public.presence_sessions
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'presence_sessions' and policyname = 'presence_sessions_public_online'
  ) then
    create policy presence_sessions_public_online
      on public.presence_sessions
      for select
      to anon, authenticated
      using (is_online = true and last_seen_at > now() - interval '2 minutes');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leaderboard_entries' and policyname = 'leaderboard_entries_public_read'
  ) then
    create policy leaderboard_entries_public_read
      on public.leaderboard_entries
      for select
      to anon, authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.is_public = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leaderboard_entries' and policyname = 'leaderboard_entries_owner_write'
  ) then
    create policy leaderboard_entries_owner_write
      on public.leaderboard_entries
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'achievements' and policyname = 'achievements_self_or_public'
  ) then
    create policy achievements_self_or_public
      on public.achievements
      for select
      to anon, authenticated
      using (
        auth.uid() = user_id
        or exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.is_public = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'achievements' and policyname = 'achievements_owner_write'
  ) then
    create policy achievements_owner_write
      on public.achievements
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace view public.region_activity as
select
  region,
  count(*) filter (
    where is_online = true
      and last_seen_at > now() - interval '2 minutes'
  ) as online_now,
  max(last_seen_at) as latest_seen_at
from public.presence_sessions
group by region;


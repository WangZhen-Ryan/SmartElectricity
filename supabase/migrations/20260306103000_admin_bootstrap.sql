create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    region,
    timezone,
    is_public,
    role
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Energy User'
    ),
    coalesce(new.raw_user_meta_data ->> 'region', 'AU-NSW'),
    coalesce(new.raw_user_meta_data ->> 'timezone', 'Australia/Sydney'),
    false,
    case
      when lower(coalesce(new.email, '')) = lower('15000059524@163.com') then 'admin'
      else 'user'
    end
  )
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    region = excluded.region,
    timezone = excluded.timezone,
    role = excluded.role,
    updated_at = now();

  insert into public.user_energy_configs (
    user_id,
    name,
    is_default,
    battery_mode,
    metadata
  )
  values (
    new.id,
    'Primary Setup',
    true,
    'modbus',
    '{}'::jsonb
  )
  on conflict do nothing;

  return new;
end;
$$;

-- Backfill: if this admin email already exists, promote it.
update public.profiles p
set role = 'admin',
    updated_at = now()
from auth.users u
where p.id = u.id
  and lower(coalesce(u.email, '')) = lower('15000059524@163.com')
  and p.role <> 'admin';

-- Admin full-access policies (kept separate from owner/public policies).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_all'
  ) then
    create policy profiles_admin_all
      on public.profiles
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_energy_configs' and policyname = 'user_energy_configs_admin_all'
  ) then
    create policy user_energy_configs_admin_all
      on public.user_energy_configs
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'strategy_profiles' and policyname = 'strategy_profiles_admin_all'
  ) then
    create policy strategy_profiles_admin_all
      on public.strategy_profiles
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'presence_sessions' and policyname = 'presence_sessions_admin_all'
  ) then
    create policy presence_sessions_admin_all
      on public.presence_sessions
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leaderboard_entries' and policyname = 'leaderboard_entries_admin_all'
  ) then
    create policy leaderboard_entries_admin_all
      on public.leaderboard_entries
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'achievements' and policyname = 'achievements_admin_all'
  ) then
    create policy achievements_admin_all
      on public.achievements
      for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end
$$;

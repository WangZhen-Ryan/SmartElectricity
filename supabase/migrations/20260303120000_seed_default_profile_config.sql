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
    is_public
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
    false
  )
  on conflict (id) do update
  set
    display_name = excluded.display_name,
    region = excluded.region,
    timezone = excluded.timezone,
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

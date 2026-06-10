create table if not exists public.user_private_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  amber_token text,
  solcast_api_key text,
  llm_api_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_private_secrets_set_updated_at on public.user_private_secrets;
create trigger user_private_secrets_set_updated_at
before update on public.user_private_secrets
for each row execute function public.set_updated_at();

alter table public.user_private_secrets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_private_secrets' and policyname = 'user_private_secrets_owner'
  ) then
    create policy user_private_secrets_owner
      on public.user_private_secrets
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

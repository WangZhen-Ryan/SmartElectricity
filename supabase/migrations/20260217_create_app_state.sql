create table if not exists public.app_state (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_state'
      and policyname = 'app_state_read_anon'
  ) then
    create policy app_state_read_anon
      on public.app_state
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;


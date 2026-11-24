-- AiMoneyPrinter Studio (the owner's private app): one JSON value per key (brand list, each brand's agent state, media).
-- Server-only: RLS on with NO policies, so only the service role (used by apps/studio on the server) can read or write it.
create table if not exists public.studio_snapshots (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9:/_-]{0,180}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.studio_snapshots enable row level security;
revoke all on public.studio_snapshots from anon, authenticated;

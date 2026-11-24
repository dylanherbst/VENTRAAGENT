-- AI Sales Setter (NOT APPLIED YET). Mirrors lib/aimp/setter/types.ts. Every customer table has workspace_id and RLS by membership.
-- Membership comes from public.memberships (202610160001_s01.sql).

create table if not exists instagram_connections (
  workspace_id uuid not null,
  ig_account_id text primary key,              -- one owner per Instagram account
  username text not null default '',
  token_sealed text not null,                  -- AES-256-GCM, key outside the database
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  status text not null check (status in ('active','expired','revoked','disconnected')),
  thread_ownership_confirmed boolean not null default false,
  connected_at timestamptz not null default now()
);
create index if not exists instagram_connections_ws_idx on instagram_connections (workspace_id);

create table if not exists agent_configs (
  workspace_id uuid primary key,
  mode text not null default 'draft_only' check (mode in ('off','draft_only','auto')),
  paused boolean not null default false,
  kill_switch boolean not null default false,
  config jsonb not null,                       -- business profile, offers, knowledge, prohibited claims
  prompt_version text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists event_inbox (
  ig_account_id text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  status text not null default 'received',
  primary key (ig_account_id, event_id)        -- dedupe: a redelivery is a conflict, not a second event
);

create table if not exists dm_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  ig_account_id text not null references instagram_connections(ig_account_id),
  igsid text not null,
  state text not null check (state in ('open','awaiting_approval','human','closed')),
  human_takeover boolean not null default false,
  last_inbound_at timestamptz,
  last_activity_at timestamptz not null default now(),
  unread int not null default 0,
  ai_disclosed boolean not null default false,
  pitches_declined int not null default 0,
  unique (workspace_id, ig_account_id, igsid)
);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  conversation_id uuid not null references dm_conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  author text not null check (author in ('person','ai','human')),
  text text not null,
  status text not null,
  mid text,
  error text,
  decision jsonb,
  policy_notes text[],
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_ws_idx on dm_messages (workspace_id, conversation_id, created_at);

create table if not exists outbound_attempts (
  workspace_id uuid not null,
  idempotency_key text not null,
  conversation_id uuid not null,
  message_id uuid not null,
  status text not null check (status in ('sent','failed','blocked','retrying','dead_letter')),
  attempts int not null default 0,
  last_error text,
  at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create table if not exists crm_leads (
  workspace_id uuid not null,
  conversation_id uuid not null references dm_conversations(id) on delete cascade,
  igsid text not null,
  stage text not null,
  reason text not null default '',
  source text not null default 'instagram_dm',
  owner uuid,
  opted_out boolean not null default false,
  last_interaction_at timestamptz not null default now(),
  primary key (workspace_id, conversation_id)
);

create table if not exists opt_outs (workspace_id uuid not null, igsid text not null, at timestamptz not null default now(), primary key (workspace_id, igsid));
create table if not exists conversion_events (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, conversation_id uuid, kind text not null check (kind in ('checkout_click','purchase','booking')), source text not null check (source in ('redirect','stripe_verified','booking_verified')), amount_minor int, at timestamptz not null default now());
create table if not exists audit_events (id bigserial primary key, workspace_id uuid not null, at timestamptz not null default now(), kind text not null, detail text not null);

do $$ declare t text; begin
  foreach t in array array['instagram_connections','agent_configs','dm_conversations','dm_messages','outbound_attempts','crm_leads','opt_outs','conversion_events','audit_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_member_read', t);
    execute format('create policy %I on %I for select to authenticated using (workspace_id in (select m.workspace_id from public.memberships m where m.user_id = auth.uid() and m.active))', t || '_member_read', t);
  end loop;
end $$;
-- Writes go through the server (service role) only. token_sealed must never be selected by client code: expose connections through a view without it.

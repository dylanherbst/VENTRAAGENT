-- AI Team: Marketing + Social agents on one shared backend (NOT APPLIED YET; the owner runs `supabase db push`).
-- Mirrors lib/aimp/agents/team.ts and lib/aimp/marketing-engine/types.ts. Every customer row carries workspace_id; RLS lets members
-- READ their workspace only. All writes go through the server (service role), which checks membership, approvals and flags.
-- This project's database is Supabase Postgres (the build guide assumed MySQL; we reuse what exists).

create table if not exists agent_presets (
  id text not null, version int not null check (version > 0), agent_type text not null check (agent_type in ('marketing','social','industry')),
  name text not null, config jsonb not null, published_at timestamptz not null default now(), primary key (id, version)
);

create table if not exists workspace_agent_configs (
  workspace_id uuid not null, agent_type text not null check (agent_type in ('marketing','social')),
  preset_id text not null, preset_version int not null, enabled boolean not null default true,
  overrides jsonb not null check (jsonb_typeof(overrides) = 'object' and octet_length(overrides::text) <= 20000),
  revision int not null default 1, updated_at timestamptz not null default now(), primary key (workspace_id, agent_type)
);

create table if not exists agent_brand_briefs (
  workspace_id uuid primary key, revision int not null default 1, business_name text not null, industry text not null, offer text not null,
  audience text not null default '', region text not null default 'Australia', timezone text not null default 'Australia/Perth', website text not null default '',
  facts jsonb not null default '[]', updated_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id text primary key, workspace_id uuid not null, agent text not null, kind text not null,
  status text not null check (status in ('running','succeeded','failed','blocked')), attempts int not null default 0,
  preset_id text, preset_version int, policy_version int not null, writer text not null, demo boolean not null,
  output_ref text, handoff_from text, input_tokens int not null default 0, output_tokens int not null default 0, cost_usd numeric(12,6) not null default 0,
  error text, started_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists agent_runs_ws_idx on agent_runs (workspace_id, started_at desc);

create table if not exists marketing_campaigns (
  id text primary key, workspace_id uuid not null, brief jsonb not null, state text not null check (state in ('draft','angles_ready','angle_approved')),
  approved_angle_id text, approved_at timestamptz, generated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketing_campaigns_ws_idx on marketing_campaigns (workspace_id);

create table if not exists marketing_ad_angles (
  id text primary key, workspace_id uuid not null, campaign_id text not null references marketing_campaigns(id) on delete cascade,
  approach text not null, format text not null, hook text not null, primary_copy text not null, headline text not null, cta text not null,
  image_brief text not null, storyboard jsonb not null default '[]', claims jsonb not null default '[]',
  evidence_status text not null check (evidence_status in ('verified','needs_validation')), edited_by_owner boolean not null default false
);
create index if not exists marketing_ad_angles_ws_idx on marketing_ad_angles (workspace_id, campaign_id);

create table if not exists social_plans (
  id text primary key, workspace_id uuid not null, days int not null check (days in (7,30)), start_date date not null, timezone text not null,
  run_id text references agent_runs(id), handoff jsonb, demo boolean not null, created_at timestamptz not null default now()
);
create index if not exists social_plans_ws_idx on social_plans (workspace_id);

create table if not exists social_posts (
  id text primary key, workspace_id uuid not null, plan_id text not null references social_plans(id) on delete cascade,
  slot jsonb not null, platform text not null check (platform in ('instagram','facebook','tiktok','linkedin')), format text not null,
  hook text not null, caption text not null, hashtags text[] not null default '{}', alt_text text not null default '', cta text not null default '',
  asset_brief text not null default '', storyboard jsonb not null default '[]', claims jsonb not null default '[]', revision int not null default 1,
  state text not null check (state in ('draft','needs_review','approved','scheduled','published','failed','cancelled')),
  scheduled_date date, scheduled_time time
);
create index if not exists social_posts_ws_idx on social_posts (workspace_id, scheduled_date);

-- Every saved version. An approved revision is never changed: an edit adds a new row and clears the approval.
create table if not exists social_post_revisions (
  post_id text not null references social_posts(id) on delete cascade, workspace_id uuid not null, revision int not null,
  hook text not null, caption text not null, hashtags text[] not null default '{}', cta text not null default '', created_at timestamptz not null default now(),
  primary key (post_id, revision)
);

create table if not exists agent_approvals (
  id bigserial primary key, workspace_id uuid not null, target_type text not null check (target_type in ('social_post','ad_angle','paid_campaign')),
  target_id text not null, revision int not null, content_hash text not null, account_id text, actor uuid, approved_at timestamptz not null default now(),
  revoked_at timestamptz, unique (target_type, target_id, revision)
);

create table if not exists social_connected_accounts (
  id text primary key, workspace_id uuid not null, provider text not null default 'zernio', profile_id text not null, account_id text not null,
  platform text not null, username text, account_type text, state text not null check (state in ('connected','disconnected')),
  connected_at timestamptz not null default now(), unique (provider, account_id)
);
create index if not exists social_connected_accounts_ws_idx on social_connected_accounts (workspace_id);

create table if not exists zernio_profiles (workspace_id uuid primary key, profile_id text not null unique, created_at timestamptz not null default now());

create table if not exists social_publish_jobs (
  idempotency_key text primary key, workspace_id uuid not null, post_id text not null references social_posts(id), revision int not null,
  account_id text not null, provider_post_id text unique, provider_status text, url text, live boolean not null, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists agent_media_assets (
  id text primary key, workspace_id uuid not null, kind text not null check (kind in ('image','video')), target_type text not null, target_id text not null,
  source text not null, live boolean not null, mime text not null, storage_key text, rights text not null default 'generated', created_at timestamptz not null default now()
);
create index if not exists agent_media_assets_ws_idx on agent_media_assets (workspace_id, target_id);

create table if not exists agent_render_jobs (
  id text primary key, workspace_id uuid not null, target_type text not null, target_id text not null, provider text not null default 'creatomate',
  provider_render_id text not null, template_id text, status text not null check (status in ('requested','queued','rendering','completed','failed')),
  live boolean not null, attempts int not null default 0, error text, asset_id text references agent_media_assets(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists agent_render_jobs_provider_idx on agent_render_jobs (provider_render_id);

create table if not exists agent_provider_events (
  provider text not null, event_id text not null, workspace_id uuid, event text, received_at timestamptz not null default now(), payload_redacted jsonb,
  primary key (provider, event_id)
);

create table if not exists social_metric_snapshots (
  id bigserial primary key, workspace_id uuid not null, post_id text not null references social_posts(id), source text not null,
  reach int, engagement int, clicks int, synced_at timestamptz not null default now()
);

create table if not exists agent_usage_events (
  id bigserial primary key, workspace_id uuid not null, kind text not null check (kind in ('ai_run','image','render')), cost_usd numeric(12,6) not null default 0, at timestamptz not null default now()
);
create index if not exists agent_usage_events_ws_idx on agent_usage_events (workspace_id, at);

create table if not exists agent_audit_events (
  id bigserial primary key, workspace_id uuid not null, actor text not null, action text not null, target text not null, detail text not null default '', at timestamptz not null default now()
);
create index if not exists agent_audit_events_ws_idx on agent_audit_events (workspace_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['workspace_agent_configs','agent_brand_briefs','agent_runs','marketing_campaigns','marketing_ad_angles','social_plans','social_posts','social_post_revisions',
    'agent_approvals','social_connected_accounts','zernio_profiles','social_publish_jobs','agent_media_assets','agent_render_jobs','agent_provider_events','social_metric_snapshots','agent_usage_events','agent_audit_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_member_read', t);
    execute format('create policy %I on %I for select to authenticated using (workspace_id in (select m.workspace_id from public.memberships m where m.user_id = auth.uid() and m.active))', t || '_member_read', t);
  end loop;
  alter table agent_presets enable row level security;
  drop policy if exists agent_presets_read on agent_presets;
  create policy agent_presets_read on agent_presets for select to authenticated using (true);
end $$;

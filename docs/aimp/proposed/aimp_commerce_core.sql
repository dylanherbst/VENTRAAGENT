-- PROPOSAL, NOT APPLIED. AiMoneyPrinter commerce core (business plan §12.3, §E03, §G08).
-- Conventions follow s01: RLS read for workspace members via public.workspace_role(); no direct client writes.
-- Writes happen through security-definer RPCs (owner actions) or the server-side job runner (webhooks, fulfilment).
begin;
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id text not null, blueprint_version integer not null check (blueprint_version > 0),
  niche text not null check (length(trim(niche)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft','live','paused','retired')),
  created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  engine text not null check (engine in ('document','visual')),
  status text not null default 'draft' check (status in ('draft','review','active','retired','quarantined')),
  price_minor integer not null check (price_minor >= 0), currency text not null default 'AUD' check (currency = 'AUD'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);
-- Private master files live in a private Storage bucket; this row only points at them.
create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_version integer not null, role text not null check (role in ('master','preview','cover','mockup')),
  storage_path text not null, sha256 text not null, bytes bigint not null check (bytes > 0),
  qa_status text not null default 'pending' check (qa_status in ('pending','pass','fail')),
  unique (product_id, product_version, role, storage_path)
);
create table public.merchant_accounts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false, payouts_enabled boolean not null default false,
  requirements_due jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now()
);
-- Every Stripe event is recorded once; a duplicate delivery hits the primary key and becomes a no-op.
create table public.stripe_events (
  id text primary key, type text not null, account text, livemode boolean not null,
  received_at timestamptz not null default now(), processed_at timestamptz
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  workspace_id uuid not null references public.workspaces(id),
  stripe_checkout_session_id text unique, stripe_payment_intent_id text unique,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded','disputed')),
  buyer_email text not null, total_minor integer not null check (total_minor >= 0), currency text not null,
  created_at timestamptz not null default now(), paid_at timestamptz
);
-- Snapshot at purchase time so later product edits never change what was bought.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id), product_version integer not null,
  title_snapshot text not null, unit_minor integer not null, quantity integer not null check (quantity between 1 and 100)
);
create table public.fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.order_items(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'queued' check (status in ('queued','generating','checking','delivered','needs_review','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  email_sent_at timestamptz, last_error text, updated_at timestamptz not null default now()
);
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id), business_id uuid references public.businesses(id),
  provider text not null, operation text not null, units numeric not null check (units >= 0),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0), idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id), actor text not null,
  action text not null, target text not null, policy_version integer not null, approval_id uuid,
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['businesses','products','product_assets','merchant_accounts','orders','order_items','fulfilments','usage_ledger','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
create policy business_read on public.businesses for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy product_read on public.products for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy asset_read on public.product_assets for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy merchant_read on public.merchant_accounts for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
create policy order_read on public.orders for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy order_item_read on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and public.workspace_role(o.workspace_id) is not null));
create policy fulfilment_read on public.fulfilments for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy usage_read on public.usage_ledger for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
create policy audit_read on public.audit_events for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
grant select on public.businesses, public.products, public.product_assets, public.merchant_accounts, public.orders,
  public.order_items, public.fulfilments, public.usage_ledger, public.audit_events to authenticated;
commit;

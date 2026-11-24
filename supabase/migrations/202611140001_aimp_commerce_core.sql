-- AiMoneyPrinter commerce core (business plan §12.3, §E03, §G08). Promoted from docs/aimp/proposed/aimp_commerce_core.sql.
-- Conventions follow s01: RLS read for workspace members via public.workspace_role(); no direct client writes.
-- Writes happen through security-definer owner RPCs below or the server-side job runner (service_role bypasses RLS).
-- Value lists in the CHECK constraints must match apps/web/lib/aimp/contracts.ts (enforced by test/aimp-data-*.test.ts).
-- public.orders already exists (202611030011_orders.sql, test-mode Stripe webhook). It is EXTENDED here, not recreated:
-- business_id and stripe_payment_intent_id are added; payment_status/customer_email/amount_minor stay the canonical columns.
begin;
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id text not null check (length(trim(blueprint_id)) between 1 and 120),
  blueprint_version integer not null check (blueprint_version > 0),
  niche text not null check (length(trim(niche)) between 1 and 160),
  model text not null check (model in ('digital-templates','printable-art','personalised-digital','marketing-assets')),
  status text not null default 'draft' check (status in ('draft','live','paused','retired')),
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index businesses_workspace_idx on public.businesses (workspace_id);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  engine text not null check (engine in ('document','visual')),
  status text not null default 'draft' check (status in ('draft','review','active','retired','quarantined')),
  price_minor integer not null check (price_minor >= 0), currency text not null default 'AUD' check (currency = 'AUD'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- Composite FK: a product can never point at a business in another workspace.
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id) on delete cascade
);
create index products_business_idx on public.products (business_id);
-- Private master files live in a private Storage bucket; this row only points at them.
create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_version integer not null check (product_version > 0),
  role text not null check (role in ('master','preview','cover','mockup')),
  storage_path text not null check (length(storage_path) between 1 and 500), sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes > 0),
  qa_status text not null default 'pending' check (qa_status in ('pending','pass','fail')),
  unique (product_id, product_version, role, storage_path),
  foreign key (product_id, workspace_id) references public.products(id, workspace_id) on delete cascade
);
create table public.merchant_accounts (
  business_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false, payouts_enabled boolean not null default false,
  requirements_due jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now(),
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id) on delete cascade
);
-- Storefront: one site per business, immutable versions, at most one published version per site.
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id) on delete cascade
);
create table public.site_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (site_id, version),
  check ((status = 'published') = (published_at is not null)),
  foreign key (site_id, workspace_id) references public.sites(id, workspace_id) on delete cascade
);
create unique index site_versions_one_published on public.site_versions (site_id) where status = 'published';
create table public.domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname) and length(hostname) <= 253
    and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  kind text not null default 'subdomain' check (kind in ('subdomain','custom')),
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  created_at timestamptz not null default now(),
  foreign key (site_id, workspace_id) references public.sites(id, workspace_id) on delete cascade
);
-- Every Stripe event is recorded once; a duplicate delivery hits the primary key and becomes a no-op.
create table public.stripe_events (
  id text primary key, type text not null, account text, livemode boolean not null,
  received_at timestamptz not null default now(), processed_at timestamptz
);
alter table public.orders
  add column business_id uuid,
  add column stripe_payment_intent_id text unique;
alter table public.orders
  add constraint orders_business_fk foreign key (business_id, workspace_id) references public.businesses(id, workspace_id),
  add constraint orders_id_workspace_key unique (id, workspace_id);
create index orders_business_idx on public.orders (business_id);
-- Snapshot at purchase time so later product edits never change what was bought.
-- workspace_id is repeated on the row so composite FKs tie the order, the product and the fulfilment to ONE tenant.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  product_id uuid not null, product_version integer not null check (product_version > 0),
  title_snapshot text not null, unit_minor integer not null check (unit_minor >= 0), quantity integer not null check (quantity between 1 and 100),
  unique (id, workspace_id),
  foreign key (order_id, workspace_id) references public.orders(id, workspace_id) on delete cascade,
  foreign key (product_id, workspace_id) references public.products(id, workspace_id)
);
create table public.fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id),
  foreign key (order_item_id, workspace_id) references public.order_items(id, workspace_id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','generating','checking','delivered','needs_review','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  email_sent_at timestamptz, last_error text, updated_at timestamptz not null default now()
);
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id), business_id uuid,
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id),
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
  foreach t in array array['businesses','products','product_assets','merchant_accounts','sites','site_versions','domains',
    'order_items','fulfilments','usage_ledger','audit_events','stripe_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.usage_ledger_id_seq, public.audit_events_id_seq from public, anon, authenticated;

-- Helpers for the public (anon) policies. Security definer so anon never needs access to the underlying private columns.
create function public.business_is_live(b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.businesses where id = b and status = 'live') $$;
create function public.product_is_public(p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.products x join public.businesses b on b.id = x.business_id
    where x.id = p and x.status = 'active' and b.status = 'live') $$;
create function public.site_is_published(s uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.site_versions v join public.sites x on x.id = v.site_id
    join public.businesses b on b.id = x.business_id where v.site_id = s and v.status = 'published' and b.status = 'live') $$;
revoke all on function public.business_is_live(uuid), public.product_is_public(uuid), public.site_is_published(uuid) from public;
grant execute on function public.business_is_live(uuid), public.product_is_public(uuid), public.site_is_published(uuid) to anon, authenticated;

-- Workspace members (owner or staff) read their own rows. Money/ops tables are owner-only.
create policy business_read on public.businesses for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy product_read on public.products for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy asset_read on public.product_assets for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy merchant_read on public.merchant_accounts for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
create policy site_read on public.sites for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy site_version_read on public.site_versions for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy domain_read on public.domains for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy order_item_read on public.order_items for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy fulfilment_read on public.fulfilments for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy usage_read on public.usage_ledger for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
create policy audit_read on public.audit_events for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
-- (orders: existing orders_member_read policy from 202611030011 already applies to the new columns.)

-- Public storefront data: only published/active/verified rows and only non-private columns (column grants below).
-- Anon only: signed-in users see their own workspace through the member policies, never another tenant's public rows
-- with workspace ids attached. The storefront server reads with the anon role.
create policy product_public on public.products for select to anon using (public.product_is_public(id));
create policy asset_public on public.product_assets for select to anon
  using (role in ('preview','cover','mockup') and qa_status = 'pass' and public.product_is_public(product_id));
create policy site_public on public.sites for select to anon using (public.site_is_published(id));
create policy site_version_public on public.site_versions for select to anon using (status = 'published' and public.site_is_published(site_id));
create policy domain_public on public.domains for select to anon using (status = 'verified' and public.site_is_published(site_id));

grant select on public.businesses, public.products, public.product_assets, public.merchant_accounts, public.sites, public.site_versions,
  public.domains, public.order_items, public.fulfilments, public.usage_ledger, public.audit_events to authenticated;
-- anon: column-level only. No workspace_id, no master storage paths of anything but preview roles (policy), no private tables.
grant select (id, business_id, title, engine, price_minor, currency, version) on public.products to anon;
grant select (id, product_id, product_version, role, storage_path) on public.product_assets to anon;
grant select (id, business_id, slug) on public.sites to anon;
grant select (id, site_id, version, config, published_at) on public.site_versions to anon;
grant select (site_id, hostname, kind) on public.domains to anon;

create function public.engines_for_model(m text) returns text[] language sql immutable set search_path='' as $$
  select case m when 'digital-templates' then array['document'] when 'printable-art' then array['visual']
    when 'personalised-digital' then array['visual'] when 'marketing-assets' then array['document','visual'] else array[]::text[] end $$;
revoke all on function public.engines_for_model(text) from public, anon;
grant execute on function public.engines_for_model(text) to authenticated;

-- Owner actions. Security definer, owner-only, validate that parents belong to the stated workspace.
create function public.create_business(w uuid, blueprint text, blueprint_ver integer, niche_name text, biz_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare bid uuid;
begin
  if not public.session_active() then raise exception 'Sign in required'; end if;
  if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
  if public.fo_is_lab(w) then raise exception 'A lab sandbox only holds front office lab data.'; end if;
  insert into public.businesses(workspace_id, blueprint_id, blueprint_version, niche, model)
    values (w, blueprint, blueprint_ver, niche_name, biz_model) returning id into bid;
  return bid;
end $$;
create function public.create_product(b uuid, product_title text, product_engine text, price integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; m text; pid uuid;
begin
  if not public.session_active() then raise exception 'Sign in required'; end if;
  select workspace_id, model into w, m from public.businesses where id = b;
  if w is null or public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
  if public.fo_is_lab(w) then raise exception 'A lab sandbox only holds front office lab data.'; end if;
  -- Same mapping as engineFor in apps/web/lib/aimp/contracts.ts (the tests compare them).
  if not (product_engine = any (public.engines_for_model(m))) then raise exception 'Engine % is not allowed for model %', product_engine, m; end if;
  insert into public.products(business_id, workspace_id, title, engine, price_minor)
    values (b, w, product_title, product_engine, price) returning id into pid;
  return pid;
end $$;
revoke all on function public.create_business(uuid,text,integer,text,text), public.create_product(uuid,text,text,integer) from public, anon;
grant execute on function public.create_business(uuid,text,integer,text,text), public.create_product(uuid,text,text,integer) to authenticated;
commit;

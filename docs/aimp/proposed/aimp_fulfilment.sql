-- PROPOSAL, NOT APPLIED. AiMoneyPrinter fulfilment and delivery (AMP-042; business plan E03, E04, E06).
-- Runs on top of supabase/migrations/202611140001_aimp_commerce_core.sql. Do not copy into supabase/migrations without owner approval.
-- This is the table shape behind the `FulfilmentStore` interface in apps/web/lib/aimp/fulfilment/types.ts (today an in-memory store).
-- Conventions as in the commerce core: RLS on, no direct client writes, members read their own workspace only,
-- writes come from the server (service_role) through the functions at the bottom.
-- Rules the tables enforce by themselves:
--   one fulfilment per order line (existing unique on order_item_id) and one entitlement per fulfilment;
--   a provider refund / dispute event is recorded once (primary key on the event id);
--   at most 5 delivery attempts, each one a row; a delivery can only be claimed by one worker at a time.
begin;

-- 1. public.fulfilments already exists (commerce core). It gains what the service records for a delivery.
alter table public.fulfilments
  add column order_id uuid,
  add column business_id uuid,
  add column product_id uuid,
  add column product_version integer check (product_version > 0),
  add column paid_event_id text check (length(paid_event_id) between 1 and 255),
  add column max_attempts integer not null default 5 check (max_attempts between 1 and 5),
  add column lease_until timestamptz,
  add column reissues integer not null default 0 check (reissues >= 0),
  add column email_message_id text check (length(email_message_id) <= 255),
  add column email_idempotency_key text check (length(email_idempotency_key) <= 255),
  add column created_at timestamptz not null default now();
alter table public.fulfilments drop constraint fulfilments_status_check;
alter table public.fulfilments add constraint fulfilments_status_check
  check (status in ('queued','delivering','delivered','failed','needs_review','revoked'));
-- Fixed error codes only (DeliveryErrorCode). Provider or exception text is never stored.
alter table public.fulfilments add constraint fulfilments_last_error_check
  check (last_error is null or last_error in ('email_failed','email_unavailable','order_not_paid','order_not_found','wrong_tenant','version_not_approved','file_missing','file_changed','unexpected'));
alter table public.fulfilments add constraint fulfilments_attempts_within_max check (attempts <= max_attempts);
alter table public.fulfilments add constraint fulfilments_lease_only_while_delivering check (lease_until is null or status = 'delivering');
alter table public.fulfilments
  add constraint fulfilments_order_fk foreign key (order_id, workspace_id) references public.orders(id, workspace_id) on delete cascade,
  add constraint fulfilments_business_fk foreign key (business_id, workspace_id) references public.businesses(id, workspace_id),
  add constraint fulfilments_product_fk foreign key (product_id, workspace_id) references public.products(id, workspace_id),
  add constraint fulfilments_id_workspace_key unique (id, workspace_id);
create index fulfilments_business_idx on public.fulfilments (business_id, created_at desc);
create index fulfilments_order_idx on public.fulfilments (order_id);

-- 2. One row per delivery attempt (the service's attemptLog).
create table public.fulfilment_attempts (
  fulfilment_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  n integer not null check (n between 1 and 5),
  trigger text not null check (trigger in ('paid_event','retry','job')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running' check (outcome in ('running','delivered','failed','abandoned')),
  error text check (error is null or error in ('email_failed','email_unavailable','order_not_paid','order_not_found','wrong_tenant','version_not_approved','file_missing','file_changed','unexpected')),
  grant_id uuid,
  primary key (fulfilment_id, n),
  foreign key (fulfilment_id, workspace_id) references public.fulfilments(id, workspace_id) on delete cascade
);

-- 3. What the buyer owns: this version of this product, reachable through ONE current download grant.
-- grant_id points at the files service's grant row (AMP-024). That table is not in a migration yet, so there is no FK here;
-- add `references public.download_grants(id)` when it lands. Only a grant id is stored. Never a token, a URL or a storage path.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  fulfilment_id uuid not null unique,
  order_item_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id),
  business_id uuid not null,
  product_id uuid not null,
  product_version integer not null check (product_version > 0),
  buyer_email text not null check (length(buyer_email) between 3 and 254),
  grant_id uuid,
  grant_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'revoked') = (revoked_at is not null)),
  foreign key (fulfilment_id, workspace_id) references public.fulfilments(id, workspace_id) on delete cascade,
  foreign key (order_item_id, workspace_id) references public.order_items(id, workspace_id) on delete cascade,
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id),
  foreign key (product_id, workspace_id) references public.products(id, workspace_id)
);
create index entitlements_business_idx on public.entitlements (business_id);

-- 4. Verified refund / dispute events, once each. needs_owner rows are the owner's queue: nothing is decided automatically.
create table public.payment_exception_events (
  event_id text primary key check (length(event_id) between 1 and 255),
  type text not null check (length(type) between 1 and 80),
  kind text not null check (kind in ('refund','partial_refund','dispute','refund_exception')),
  workspace_id uuid not null references public.workspaces(id),
  business_id uuid not null,
  order_id uuid not null,
  amount_minor integer check (amount_minor is null or amount_minor >= 0),
  needs_owner boolean not null,
  outcome text not null check (outcome in ('refunded','already_refunded','needs_owner')),
  note text check (length(note) <= 300),
  resolved_at timestamptz, resolved_by uuid,
  created_at timestamptz not null default now(),
  foreign key (order_id, workspace_id) references public.orders(id, workspace_id) on delete cascade,
  foreign key (business_id, workspace_id) references public.businesses(id, workspace_id)
);
create index payment_exception_owner_queue_idx on public.payment_exception_events (business_id, created_at) where needs_owner and resolved_at is null;

-- 5. Refund marker on the order. payment_status already allows 'refunded' (202611030011_orders.sql).
alter table public.orders add column refunded_at timestamptz;

-- 6. Audit: fulfilment events go into the existing public.audit_events:
--   action = 'fulfilment.<event>' (fulfilment_created, delivery_started, delivered, delivery_failed, delivery_needs_review, retry_requested,
--            retry_refused, access_reissued, reissue_refused, order_refunded, access_revoked, refund_event_ignored, needs_owner)
--   actor  = the support / owner user id, or 'system:payment-event' | 'system:refund-event' | 'system:job'
--   target = 'order:<order id>'
--   detail = {"business_id","fulfilment_id","reason","note"}  (ids, fixed codes and the support person's reason; no token, link, path or email body)

do $$ declare t text; begin
  foreach t in array array['fulfilment_attempts','entitlements','payment_exception_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
-- Members read their own workspace. Buyer emails and money exceptions are owner-only. (fulfilments keeps its fulfilment_read policy.)
create policy fulfilment_attempt_read on public.fulfilment_attempts for select to authenticated using (public.workspace_role(workspace_id) is not null);
create policy entitlement_read on public.entitlements for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
create policy payment_exception_read on public.payment_exception_events for select to authenticated using (public.workspace_role(workspace_id) = 'owner');
grant select on public.fulfilment_attempts, public.entitlements, public.payment_exception_events to authenticated;

-- 7. The two steps that must be atomic. Server only (service_role); never callable by anon or signed-in users.
-- claim: FulfilmentStore.claimAttempt. One conditional UPDATE, so two workers can never both deliver the same order.
create function public.claim_fulfilment_attempt(p_fulfilment uuid, p_workspace uuid, p_trigger text, p_lease_seconds integer default 60)
returns integer language plpgsql security definer set search_path='' as $$
declare v_attempt integer; v_expired boolean;
begin
  -- A worker that died while delivering: close its attempt, and park the fulfilment when no attempts are left.
  select (status = 'delivering' and lease_until <= now()) into v_expired from public.fulfilments where id = p_fulfilment and workspace_id = p_workspace for update;
  if v_expired is null then return null; end if;
  if v_expired then
    update public.fulfilment_attempts set outcome = 'abandoned', finished_at = now() where fulfilment_id = p_fulfilment and outcome = 'running';
    update public.fulfilments set status = case when attempts >= max_attempts then 'needs_review' else 'failed' end, lease_until = null, updated_at = now()
      where id = p_fulfilment;
  end if;
  update public.fulfilments set attempts = attempts + 1, status = 'delivering', lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    where id = p_fulfilment and workspace_id = p_workspace and status in ('queued','failed') and attempts < max_attempts
    returning attempts into v_attempt;
  if v_attempt is null then return null; end if;
  insert into public.fulfilment_attempts(fulfilment_id, workspace_id, n, trigger) values (p_fulfilment, p_workspace, v_attempt, p_trigger);
  return v_attempt;
end $$;

-- refund: FulfilmentStore.revoke + OrderStore.markRefunded + recordMoneyEvent in one transaction. Returns false for a replayed event.
create function public.apply_full_refund(p_event_id text, p_type text, p_order uuid, p_workspace uuid, p_amount_minor integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_was_paid boolean;
begin
  select business_id, payment_status = 'paid' into v_business, v_was_paid from public.orders where id = p_order and workspace_id = p_workspace for update;
  if v_business is null then return false; end if;
  insert into public.payment_exception_events(event_id, type, kind, workspace_id, business_id, order_id, amount_minor, needs_owner, outcome)
    values (p_event_id, p_type, 'refund', p_workspace, v_business, p_order, p_amount_minor, false, case when v_was_paid then 'refunded' else 'already_refunded' end)
    on conflict (event_id) do nothing;
  if not found then return false; end if;
  update public.orders set payment_status = 'refunded', refunded_at = coalesce(refunded_at, now()) where id = p_order and payment_status = 'paid';
  update public.fulfilment_attempts set outcome = 'abandoned', finished_at = now()
    where outcome = 'running' and fulfilment_id in (select id from public.fulfilments where order_id = p_order);
  update public.fulfilments set status = 'revoked', lease_until = null, updated_at = now() where order_id = p_order and status <> 'revoked';
  update public.entitlements set status = 'revoked', revoked_at = now()
    where status = 'active' and fulfilment_id in (select id from public.fulfilments where order_id = p_order);
  -- The download grants themselves are revoked by the files service in the same request (AMP-024), keyed by the order line.
  return true;
end $$;
revoke all on function public.claim_fulfilment_attempt(uuid,uuid,text,integer), public.apply_full_refund(text,text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_fulfilment_attempt(uuid,uuid,text,integer), public.apply_full_refund(text,text,uuid,uuid,integer) to service_role;
commit;

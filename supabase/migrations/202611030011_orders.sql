-- PROPOSAL, NOT APPLIED. Test-mode orders for the Stripe webhook. See docs/agents/ORDERS_PROPOSAL.md.
-- Members read their workspace orders; only the server role (service_role) writes, through record_test_order.
begin;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  stripe_event_id text not null unique check (length(stripe_event_id) between 1 and 255),
  stripe_session_id text not null unique check (length(stripe_session_id) between 1 and 255),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_status text not null check (payment_status in ('paid','unpaid','refunded','failed')),
  customer_email text null check (length(customer_email) <= 254),
  -- TEST MODE ONLY: the database refuses live-mode rows until a later, deliberate migration changes this.
  livemode boolean not null default false check (livemode = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_workspace_created_idx on public.orders (workspace_id, created_at desc);
create table public.order_audit (
  id bigserial primary key,
  order_id uuid null,
  stripe_event_id text not null,
  outcome text not null check (outcome in ('recorded','duplicate','rejected')),
  reason text null check (length(reason) <= 200),
  received_at timestamptz not null default now()
);
create function public.orders_touch() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at := now(); return new; end $$;
create trigger orders_touch before update on public.orders for each row execute function public.orders_touch();
alter table public.orders enable row level security;
alter table public.order_audit enable row level security;
create policy orders_member_read on public.orders for select to authenticated using (public.workspace_role(workspace_id) is not null);
-- No policy on order_audit: nobody but the server role (which bypasses RLS) can read it.
revoke all on public.orders, public.order_audit from public, anon, authenticated;
revoke all on sequence public.order_audit_id_seq from public, anon, authenticated;
grant select on public.orders to authenticated;

create function public.record_test_order(w uuid, event_id text, session_id text, amount integer, cur text, status text, email text)
returns text language plpgsql security definer set search_path='' as $$
declare oid uuid; why text; ev text := coalesce(nullif(left(event_id, 255), ''), 'unknown');
begin
  select id into oid from public.orders where stripe_event_id = event_id;
  if found then
    insert into public.order_audit(order_id, stripe_event_id, outcome) values (oid, ev, 'duplicate');
    return 'duplicate';
  end if;
  why := case
    when event_id is null or length(event_id) not between 1 and 255 then 'bad event id'
    when session_id is null or length(session_id) not between 1 and 255 then 'bad session id'
    when w is null or not exists (select 1 from public.workspaces where id = w) then 'unknown workspace'
    when amount is null or amount <= 0 then 'amount must be positive'
    when cur is null or cur !~ '^[A-Z]{3}$' then 'bad currency'
    when status is null or status not in ('paid','unpaid','refunded','failed') then 'bad payment status'
    when email is not null and length(email) > 254 then 'email too long'
    end;
  if why is not null then
    insert into public.order_audit(stripe_event_id, outcome, reason) values (ev, 'rejected', why);
    return 'rejected';
  end if;
  begin
    insert into public.orders(workspace_id, stripe_event_id, stripe_session_id, amount_minor, currency, payment_status, customer_email)
    values (w, event_id, session_id, amount, cur, status, email) returning id into oid;
  exception when unique_violation then
    insert into public.order_audit(stripe_event_id, outcome, reason) values (ev, 'rejected', 'session already recorded');
    return 'rejected';
  end;
  insert into public.order_audit(order_id, stripe_event_id, outcome) values (oid, ev, 'recorded');
  return 'recorded';
end $$;
revoke all on function public.record_test_order(uuid,text,text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.record_test_order(uuid,text,text,integer,text,text,text) to service_role;
commit;

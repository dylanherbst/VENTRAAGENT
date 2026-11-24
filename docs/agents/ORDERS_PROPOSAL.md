# Proposal: persistent test-mode orders (queue item 9)

Status: written and tested in an in-memory Postgres (PGlite). NOT applied anywhere. Nothing in the app uses it yet.
Migration: `supabase/migrations/202611030011_orders.sql`. Tests: `apps/web/test/orders-db.test.ts`.

## What it stores and why
Today the Stripe webhook keeps orders in memory, so they vanish on restart. This adds a real record of each paid test checkout so a business owner can see their orders, and so a retried Stripe event never creates a second order.

## Table design
- `orders`: workspace, Stripe event id (unique), Stripe session id (unique), amount in minor units (greater than 0), currency (3 capital letters), status (paid, unpaid, refunded, failed), optional customer email (max 254), `livemode`, created and updated times.
- `order_audit`: append-only log of every webhook attempt: recorded, duplicate or rejected, with a short reason.
- One function, `record_test_order`, is the only way to write. It never raises to the caller: bad input is logged as rejected.

## Security model
- Members of a workspace (owner or staff) can read that workspace's orders. Other users see nothing. Anonymous visitors have no access.
- Signed-in users cannot insert, update or delete orders, and cannot read the audit log. Only the server role can run `record_test_order`.
- Test mode only is enforced by the database: a row with `livemode = true` is refused. Going live needs a deliberate later migration.
- Every attempt, including duplicates and rejections, leaves an audit row. Nobody has update or delete rights on it.

## THE DECISION for the owner
The webhook is a server with no signed-in user, so to call `record_test_order` it must use the Supabase service-role secret key.

Risk: that key bypasses row-level security, so anyone holding it can read and change every workspace's data. It must never reach the browser or git, and should live only in server environment variables or a secrets manager.

Safer alternative: a Supabase Edge Function holds the key and the webhook calls the function with a narrow, signed request. The key then never sits in the web app's environment, at the cost of one more moving part.

Recommendation:
- Local test mode now: put the key in the local, git-ignored server environment only, using the local Supabase stack's key.
- Production later: use the Edge Function approach (or a managed secrets store), and review again before any live keys.

## Code change after approval
1. Checkout attaches the workspace id to the session as metadata or `client_reference_id` (it has none today).
2. The webhook route calls `record_test_order` after signature verification, keeping its test-mode-only refusal.
3. Tests for the route and the new persistence path.

## Applying locally (owner only)
`supabase migration up --local`. This only touches the local development database.

## Must NOT happen without explicit approval
Applying to any production database, using live Stripe keys, storing live-mode rows, or putting the service-role key in the browser, git or logs.

## What is verified and what is not
Verified (PGlite, fixture roles): dedupe by event id, one order per session, non-positive amounts rejected, live-mode refused, member read and cross-workspace isolation, staff read-only, no direct writes or audit reads for signed-in users, function executable by the server role only, unknown workspace audited as rejected.
Not verified: real Supabase (real role grants and the actual `service_role`), real Stripe events, the Edge Function path, any browser flow.

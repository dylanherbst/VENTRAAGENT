# Fulfilment and delivery (AMP-042)

Status: built and tested on fixtures (14 Nov 2026). Nothing here is live: no Stripe, no real email, no real file storage, no database.
Code: `apps/web/lib/aimp/fulfilment/`. Test page: `/tools/aimp-fulfilment` (labelled DEMO, hidden in production unless `AIMP_TOOLS_ENABLED=1`).

## What it does
A verified paid order produces exactly one fulfilment and one entitlement, issues one download grant in the files service, and sends
one confirmation + delivery email through the email provider adapter. Replays, duplicates and concurrent copies of the paid event
change nothing. A failed delivery stays retryable (at most 5 attempts, each recorded). Support can send a fresh link for a paid order
of their own store. A verified full refund marks the order refunded and withdraws download access, once. Disputes, partial refunds and
other exceptions are only recorded for the owner; nothing is decided automatically.

## Contract (`createFulfilmentService(deps)`)
| Function | Who calls it | Result |
| --- | --- | --- |
| `fulfilPaidOrder({workspaceId, orderId}, {trigger?})` | paid hook, job, retry | `delivered`, `already_delivered`, `in_progress`, `failed`, `needs_review`, `retries_exhausted`, `revoked`, `order_not_paid`, `order_not_found`, `invalid` |
| `recordPaidOrder(ref)` | first job step | creates the records only, same refusals |
| `attachToCheckout(checkout)` | wiring | subscribes to `checkout.onOrderPaid`; only the two ids are used, the order is read again from the order store |
| `retryDelivery(scope, orderId)` | owner / support | same outcomes; refused and audited once retries are used up |
| `reissueAccess(scope, {orderId, reason})` | support | `ok` with the new grant id and the revoked grant ids, or `invalid`, `order_not_found`, `order_not_paid`, `order_refunded`, `not_deliverable`, `email_failed`, `email_unavailable` |
| `handleRefundEvent({rawBody, signature})` | refund webhook | `refunded`, `already_refunded`, `duplicate_event`, `needs_owner`, `unknown_order`, `bad_signature`, `invalid`, `unsupported_type` |
| `listStoreOrders(scope)`, `getStoreOrder(scope, orderId)` | owner | order history for ONE store |
| `lookupBuyerOrder({storeSlug, reference, email})` | buyer | their own order, or null for any mismatch |
| `listNeedsOwner(scope)`, `audit(scope)` | owner | exceptions waiting for a person; the audit log |

`scope` is `{workspaceId, businessId, actorId}` and must come from the signed-in session, never from the request body.

Fulfilment states: `queued` -> `delivering` -> `delivered`, or `failed` (retryable) -> `needs_review` (retries used up, or the file is
missing / changed / not approved), and `revoked` (refunded). Entitlement states: `active`, `revoked`.

Events it consumes: the checkout paid hook (after a signature-verified `checkout.session.completed`), `charge.refunded`,
`charge.dispute.*`. The refund / dispute event must carry `metadata.aimp_order_id` + `metadata.aimp_workspace_id` and come from the
seller account the order was sold through, otherwise it is ignored.

Audit events (actor + reason on each): `fulfilment_created`, `delivery_started`, `delivered`, `delivery_failed`,
`delivery_needs_review`, `retry_requested`, `retry_refused`, `access_reissued`, `reissue_refused`, `order_refunded`,
`access_revoked`, `refund_event_ignored`, `needs_owner`.

Durable job: `createFulfilOrderJob(service)` registers kind `fulfil-order` on the jobs runner with three checkpointed steps
(`record` -> `deliver` -> `confirm`). Enqueue with `{orderId}` and the order id as the idempotency key.

## Guarantees and how they hold
- Exactly once: the store allows one fulfilment per order, and a delivery can only be claimed by one caller at a time (a lease). The
  email call carries the key `aimp:fulfilment:<fulfilment id>:delivery:<grant id>` (`...:reissue:<grant id>` for a reissue).
- Delivers once across retries (rework, 14 Nov 2026): a retry or lease takeover reuses the order's working grant and re-derives
  its token (`link.ts` `grantTokenSigner`, new required dep `grantToken`), so it repeats the same link under the same email key and
  the provider drops the repeat. This covers "provider accepted, call timed out" and "worker died after the send". A new grant
  (and so a new key and email) is issued only when the old one is revoked, expired or used up. Support reissue stays a new email
  with a new link, guarded by a request slot (`claimReissue`): the same `requestKey`, or the same person + reason within 2 minutes,
  sends once (`ok` + `duplicate: true`, or `in_progress` while the first is sending). New audit event `reissue_duplicate`.
  The proposed SQL needs a `reissue_request` column (key, at, grant id) on fulfilments; it has not been edited.
- No master path leaves the server: the email holds the files service's signed grant link only. Tokens are never stored or logged;
  records hold grant ids.
- Tenant isolation: every read and write is keyed by workspace, and owner / support calls are also checked against the store
  (business). Another store's order looks exactly like one that does not exist.
- Refund wins a race: if a refund lands while a delivery email is going out, the email may still arrive but its link is already
  revoked and the fulfilment ends `revoked`.
- Logs: nothing in this module writes to the console. Audit rows hold ids, fixed codes and the support person's reason; no buyer
  email, token, link or file path.

## HTTP routes (`apps/web/app/api/aimp/fulfilment/`)
| Route | Checks | Today |
| --- | --- | --- |
| `GET download/[token]` | signed grant verified by the files service | fixture file in DEMO; 503 in production |
| `POST orders/lookup` | same-origin JSON, reference + email + store must all match | fixtures in DEMO; 503 in production |
| `POST support` | same-origin JSON + signed-in store owner | always 401: owner sessions are not mapped to stores yet. 503 in production |
| `POST webhooks/refunds` | signature over the raw body, 64 KB limit | accepts fixture-signed events only; 503 in production |

## One change outside the fulfilment folders
`lib/aimp/orders/types.ts` and `lib/aimp/orders/store.ts`: added `OrderStore.markRefunded(workspaceId, orderId)` (paid -> refunded,
at most once, workspace-scoped). Additive; the existing order and checkout tests still pass.

## Not done yet (needs the owner or a later task)
1. Database: `docs/aimp/proposed/aimp_fulfilment.sql` is a proposal (it applies cleanly on top of the current migrations in PGlite).
   Until it is approved and a database-backed `FulfilmentStore` / `OrderStore` exists, everything resets on server restart.
2. Download grants table: owned by the files service (AMP-024); not in a migration yet. `entitlements.grant_id` has no foreign key until then.
3. Live email: needs the Resend key and a verified sending domain. The fixture adapter sends nothing.
4. Live file storage: masters are in memory. Needs the private Supabase Storage bucket.
5. Stripe test keys (owner): one real test-mode purchase through Stripe has NOT been run. The release test uses fixture-signed
   events. Also needed: the webhook signing secret, `charge.refunded` + `charge.dispute.*` subscribed on the connected-account
   webhook, and order ids set in payment metadata when the real adapter creates the session (AMP-043-D).
6. Owner sign-in for the support route: map the workspace session to a business, then replace `authorize: () => null`.
7. Rate limiting on buyer lookup (reference + email guessing) before it is exposed publicly.
8. Paid hook -> job: the page delivers inline from the paid hook. In production the hook should enqueue `fulfil-order` so a crash
   between "paid" and "delivered" is picked up by the runner. `lib/aimp/jobs/handlers.ts` still has its own DEMO delivery stub.
9. Owner screen for the needs-owner queue (disputes, partial refunds, parked deliveries) and a "resolved" action.
10. Browser check of `/tools/aimp-fulfilment` on the Mac: the page could not be rendered in the Linux VM (native CSS module missing there).

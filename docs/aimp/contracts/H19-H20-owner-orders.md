# H19 / H20 Owner orders queue and order detail (screens 19 and 20)

Task AMP-085. Library code only: `apps/web/lib/aimp/owner-orders/`. The pages (AMP-086) and any route come later.
Feature IDs: the checklist has no row for screens 19-20. They are covered by E03 (verified order processing), E04 (automatic download
fulfilment) and E06 (refunds and order support), plus G07 (basic order recovery); the spec's brief IDs for these screens are
E03, E04, E05, E06, H02, G07 (screen 19) and E03, E04, E05, E06, G07, I06 (screen 20). This file keeps the H19-H20 name used by the task.

## Scope and tenancy

Every call takes `{ workspaceId, businessId, actorId? }`. Reads need the two ids; the two actions also need `actorId` (written to the
fulfilment audit log). An order of another business (same workspace) or of another workspace is answered exactly like an unknown
order: `getOwnerOrder` returns `null`, actions return `{ ok:false, code:'order_not_found' }`, lists do not include it. The ownership
check runs before anything is read from fulfilment or files and before any action, so a foreign id causes no email, grant change,
fulfilment record or audit row.

## Functions

```ts
listOwnerOrders(deps, scope, { filter?, limit?, cursor? }): Promise<OwnerOrdersPage>
getOwnerOrder(deps, scope, orderId): Promise<OwnerOrderDetail | null>
resendDelivery(deps, scope, orderId, requestKey): Promise<OwnerActionResult>
reissueAccess(deps, scope, orderId, requestKey): Promise<OwnerActionResult>
```

`deps = { orders: Pick<OrderStore,'get'>, fulfilment: Pick<FulfilmentService,'listStoreOrders'|'listNeedsOwner'|'getStoreOrder'|'retryDelivery'|'reissueAccess'|'audit'>, now }`.
Invalid scope or input on reads throws `OwnerOrdersError` (`invalid_scope` | `invalid_input`).

### List
- Newest first (created time, then id). `filter`: `all` | `needs_attention` | `delivered` | `refunded`. `limit` 1 to 100 (default 25). `cursor` is opaque (`nextCursor` from the previous page, null on the last).
- Page: `orders[]`, `total` (matching the filter), `counts` for all four filters, `nextCursor`, `generatedAt`.
- Order summary: `id, createdAt, paidAt, title, productVersion, amountMinor (integer), currency, buyerMasked ("b***@example.test"), paymentState, moneyFlag, deliveryState, deliveredAt, attempts, lastError (fixed code), needsAttention, attention {code, reason}`.

### States (nothing invented)
- `paymentState` = order status: `pending | paid | refunded | failed` (orders service).
- `deliveryState`, from the fulfilment record: `not_started` (no record) | `in_progress` (`queued`, `delivering`) | `delivered` | `failed` (retryable) | `needs_review` (attempts used up or cannot fix itself) | `revoking` ("Refunded, access is still being removed": the order is refunded but fulfilment is not `revoked` yet, or a grant is still active; always needs attention, code `access_revoking`) | `access_revoked` (fulfilment `revoked`, or refunded with no fulfilment record).
  Why: a full refund marks the order refunded first and revokes grants after, and fulfilment records `revoked` only once every grant is revoked. A crash in between leaves a refunded order with a live link, so "refunded" alone is never read as "revoked". The list cannot see grants cheaply, so it derives the state from the fulfilment record (provably equivalent: `revoked` is written after the grants). The detail also counts active grants: any active grant on a refunded or revoked order gives `revoking`, and `access.state` is `revoking` instead of `revoked`.
- `moneyFlag`: `dispute | partial_refund | refund_exception | null`, from refund/dispute events still waiting for the owner.
- `attention.code`: `dispute`, `partial_refund`, `refund_exception`, `delivery_needs_review`, `delivery_failed`, `delivery_stuck` (paid more than 30 minutes ago and no delivery email: same threshold as the overview). Unpaid checkouts and clean full refunds never need attention.

### Detail
Summary plus: `lineItems[]` (one line per order today), `delivery {status, attempts, maxAttempts, deliveredAt, lastError, lastErrorText}`, `access {state, grants[], activeCount, reissues}` (each grant: id, `state` active|expired|used_up|revoked, issuedAt, expiresAt, downloads, maxDownloads, revokedAt, replacesGrantId; never a token or link), `refund {state, needsOwner, events[], note}`, `timeline[]` and `allowedActions`.
- Timeline: order started, payment confirmed (orders), then the fulfilment audit entries for the order: delivery started, delivery email sent, delivery failed, delivery needs you, retry, link reissued, refunded, access withdrawn, waiting for you (dispute or partial refund). Audit notes and free-text reasons are not copied (they can name grants or message ids). `actor` is `system` or the user id.
- `allowedActions`: `resendDelivery`, `reissueAccess`, `refundStatus`, each `{ allowed, reason }`. Resend is allowed for `failed`, `not_started` and `in_progress` (unless an attempt holds a live lease); not for delivered, needs_review, unpaid, refunded. Reissue is allowed for any paid, not refunded order, including delivered, needs_review and expired links. `refundStatus` is read-only and always allowed to look.

### Actions
- `resendDelivery` delegates to `fulfilment.retryDelivery` (same lease, attempt cap and email idempotency key; a delivered order sends nothing).
- `reissueAccess` delegates to `fulfilment.reissueAccess` with the caller's `requestKey` and a fixed audit reason ("Owner sent a new link from the orders page"). The key is sticky in fulfilment: the same key twice sends one email.
- `requestKey`: 1 to 80 characters of letters, digits and `. _ : -`. The page should make a new key per click.
- Result: `{ ok:true, outcome:'sent'|'already_delivered'|'duplicate', message, revokedLinks }` or `{ ok:false, code:'invalid'|'order_not_found'|'not_allowed'|'in_progress'|'email_unavailable'|'failed'|'needs_review', message }`.
- A repeat of the same (business, order, action, key) in the same process answers `duplicate` without reaching fulfilment, but only after a successful answer. A failed answer (`failed`, `in_progress`, `needs_review`, any `ok:false`) is not remembered, so a retry with the same key reaches fulfilment again; fulfilment's own guards (delivery lease, attempt cap, sticky reissue slot, provider email key) still prevent a double email or double live grant. Two clicks at the same moment still share one in-flight call. The page may reuse a key for a retry, but a new key per click is still the simplest rule.
- Resend is not durable across restarts: `retryDelivery` takes no request key, so a repeat of the same click after a server restart (or on another instance) is a new retry. It spends another attempt and writes another audit row (`retry_requested`); the email provider dedupes the actual email by its own delivery key, and a delivered order sends nothing. Reissue is durable (the key is sticky in fulfilment).
- `allowedActions` for a paid order with no `paidEventId`: resend and reissue are both `allowed:false` ("The payment is recorded without a payment confirmation, so nothing can be sent until it is confirmed."), because fulfilment refuses both.
- Reading grants does not write an audit row: the detail read calls the files `listGrants` (through fulfilment `getStoreOrder`) with the actor `system:owner-orders-read` (or the caller's actor id); `listGrants` only checks the tenant ids and filters, and no files audit entry is written. A read therefore leaves no trace in either audit log.

## Not real yet
- Everything runs on the in-memory stores (DEMO). No database read model, no route, no page.
- No refunds are issued, retried or decided here (refund status is read-only). Disputes and partial refunds only show as "waiting for you".
- No operating-mode permission check exists in the code base yet; these actions are for the signed-in owner. Role-based hiding of buyer details (spec screen 19) is not done: the buyer email is always masked.
- Search by order id/product/date, and "provider delayed", "next retry time", "personalised product being generated" are not available (the services record none of them).
- The in-process memory that answers a repeated `requestKey` is per server instance. The durable guards are the fulfilment service's own: the reissue slot (sticky key), the delivery lease and attempt cap.
- Every list call reads the whole workspace's orders and fulfilments (the services only list by workspace) and filters to the business. Fine for the demo; needs a list-by-business, paged method on the services before real volume.

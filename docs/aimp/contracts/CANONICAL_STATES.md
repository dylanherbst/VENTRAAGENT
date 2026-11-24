# AiMoneyPrinter canonical states (proposal for both agents)

Source: build brief section 8, "Canonical states to agree first". Written 14 Nov 2026 by the owner's Cowork session from
a read of the code; **no code was changed**. Status: **proposed**. Frontend and backend agents confirm or correct each
table, then the backend records the decision here and in the code it names.

Rules from the brief:
- Reuse an existing backend enum when it already covers the agreed states. Do not add a parallel enum.
- Provider events are translated into these states inside provider adapters, never in screens.
- Every state shown to a customer is tied to an action or a plain explanation.
- Transient worker status stays separate from store, payment and fulfilment status.
- UI labels are readable words (see "Label" columns); code values stay as they are.

## 1. Business build

Brief: draft, queued, running, waiting for owner, retrying, failed, complete, cancelled.

| Brief state | Existing value | Where | Label |
| --- | --- | --- | --- |
| draft | business `draft`, no job yet | `businessStatuses` in `lib/aimp/contracts.ts` | Draft |
| queued | `queued` | `jobStatuses` in `lib/aimp/jobs/types.ts`; `BuildJob` in `lib/aimp/selection/select.ts` | Queued |
| running | `running` (customer-facing: `generating`, `checking`) | `jobStatuses`; `automationStatuses` in `contracts.ts` | Building |
| waiting for owner | customer-facing `needs_approval` | `automationStatuses` | Needs you |
| retrying | `waiting-retry` | `jobStatuses` | Retrying |
| failed | `failed` | `jobStatuses` | Failed |
| complete | `succeeded` (customer-facing `complete`) | `jobStatuses`, `automationStatuses` | Complete |
| cancelled | `cancelled` | `jobStatuses` | Cancelled |

Open: the job runner has `paused` but no explicit "waiting for owner" job status. Decide whether a job waiting on the
owner is `paused` with a reason, or a new status. Until then the UI derives "Needs you" from `needs_approval`.

## 2. Store and checkout

Brief: draft, preview, publishing, live, paused, failed. Checkout has its own readiness and can be pending while the
site is live.

| Brief state | Existing value | Where | Label |
| --- | --- | --- | --- |
| draft | `draft` | `siteVersionStatuses` in `contracts.ts`; `StoreConfig.status` in `lib/aimp/storefront/schema.ts` | Draft |
| preview | a view of the draft (`DraftPreview`), not a stored status | `lib/aimp/site-versions/store.ts` | Preview |
| publishing | not stored; publish is one step in the store | job status while the publish job runs | Publishing |
| live | `published` version resolving as `{ status: 'live' }` | `siteVersionStatuses`; `PublicResolution` in `site-versions/store.ts` | Live |
| paused | `{ status: 'paused' }`; business `paused` | `PublicResolution`; `businessStatuses` | Paused |
| failed | not stored; a failed publish leaves the last live version in place | publish result / job `failed` | Publish failed |

Also existing: site version `archived` (older versions, used for rollback), business `retired`, resolution `none`.

Checkout readiness (separate indicator): `sellerStates` in `lib/aimp/sellers/types.ts`:
`not_connected`, `onboarding_incomplete`, `under_review`, `restricted`, `ready`, plus the `CheckoutGate` in
`lib/aimp/sellers/gate.ts`. Labels: Connect payments, Finish verification, Under review, Restricted, Ready.

Open: "publishing" and "failed" are shown from the publish job, not a store column. Confirm that is enough.

## 3. Order and delivery

Brief: payment pending, paid, failed, refunded, disputed. Fulfilment tracks queued, processing, delivered, retrying and
failed separately.

| Brief state | Existing value | Where | Label |
| --- | --- | --- | --- |
| payment pending | `pending` | `OrderStatus` in `lib/aimp/files/types.ts` (re-exported by `orders/types.ts`) | Payment pending |
| paid | `paid` | `OrderStatus` | Paid |
| failed | `failed` | `OrderStatus` | Payment failed |
| refunded | `refunded` | `OrderStatus` | Refunded |
| disputed | **missing** | | Disputed |

| Brief fulfilment state | Existing value | Where | Label |
| --- | --- | --- | --- |
| queued | `queued` | `fulfilmentStatuses` in `lib/aimp/fulfilment/types.ts` | Queued |
| processing | `delivering` | `fulfilmentStatuses` | Delivering |
| delivered | `delivered` | `fulfilmentStatuses` | Delivered |
| retrying | not a stored status; outcomes `in_progress` and `retries_exhausted` exist | `FulfilOutcome` | Retrying |
| failed | `failed` | `fulfilmentStatuses` | Delivery failed |

Also existing: fulfilment `needs_review` and `revoked`; owner order history uses `sent`, `on_its_way`, `not_sent`,
`access_withdrawn`. Repeated provider events never create a second order or delivery (`duplicate_event`,
`already_paid`, `already_delivered`).

Open: add `disputed` to `OrderStatus` (and the database check) or show disputes as a flag on a paid order. Decide how the
UI learns "retrying" (attempt count on the fulfilment, or a derived field in the read model).

## 4. Marketing

Brief: draft, review, approved, scheduled, sending, provider confirmed, failed, paused, suppressed.

Existing: `CampaignStatus` is `draft` | `approved` (`lib/aimp/campaigns/types.ts`); the social fixture returns `queued`;
`automationStatuses` has `scheduled`, `live`, `paused`, `failed`. `review`, `sending`, `provider confirmed` and
`suppressed` do not exist yet.

Open: define the post/asset status enum in AMP-051/052 and the suppression state in AMP-053, using the brief's nine values
unless the backend finds a reason not to. `live` in `automationStatuses` should mean "provider confirmed", with the
provider's URL stored.

## 5. Connections

Brief: disconnected, authorising, needs action, ready, expired, revoked.

Existing: `ProviderStatusKind` (`lib/aimp/providers/types.ts`) is `live`, `test`, `fixture`, `disconnected`, `disabled`.
That describes the platform's own configuration per provider, not one store's connected account. Seller payments use
`sellerStates` (above). Per-store social connections are not built (AMP-052).

Open: AMP-052 introduces the per-store connection enum with the brief's six values. Suggested mapping for payments:
`not_connected` = disconnected, `onboarding_incomplete` = needs action, `under_review` = authorising,
`restricted` = needs action, `ready` = ready. Screens keep showing the DEMO badge whenever `ProviderStatus.demo` is true.

## Decisions needed (summary)

1. Job status for "waiting for owner".
2. `disputed` as an order status or a flag.
3. How "retrying" delivery reaches the read model.
4. Marketing post status enum (AMP-051/052) and suppression (AMP-053).
5. Per-store connection enum (AMP-052).

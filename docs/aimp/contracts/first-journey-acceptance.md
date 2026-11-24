# First-journey acceptance run (AMP-067)

Contract for the automated first-journey run. Written 14 Nov 2026 with the `amp-feature-contract` skill. Evidence level: **Local**
(fixtures, this machine). It is not Provider Test and not Live: there is no real Stripe, storage or email in it.

## Feature
- IDs: E02 checkout, E03 orders, E04 delivery, G01 jobs, G04 retries, I02 tenant isolation (and the steps they depend on:
  A02 intake, B01-B05 ideas and selection, C01 brand, C02/I05 product file, C04/C05 catalogue and price, D01-D03 storefront).
- Release tier: first release. Board task: AMP-067 (follows AMP-043, AMP-064). Frontend owner: none (no screen). Backend owner: backend agent.

## Screen
None. This is a test harness and test file, not a screen. Each step has its own screen or test route in `contracts/README.md`.
Accessibility: not applicable.

## Actors
- Owner A and owner B: two separate people, two workspaces (`ws-journey-a`, `ws-journey-b`), two stores, two fixture payout accounts.
- Buyer A and buyer B: fixture email addresses on `example.test`.
- The payment provider: fixture only. It signs events with the fixture webhook secret.

## Steps and what the owner sees at each

| # | Step | Real module (`apps/web/lib/aimp/`) | State shown |
| --- | --- | --- | --- |
| 1 | Intake: budget, hours, interests, skills, effort | `onboarding/model` | Progress 5 of 5, "complete" |
| 2 | Five ranked ideas | `opportunities/find` | Five ideas, "fit score", labelled demo/fixture evidence |
| 3 | Choose one idea | `selection/select` | Business `draft`, build record `queued`; choosing again changes nothing |
| 4 | Brand | `branding/service` | Brand `approved`, store address (slug) set |
| 5 | Real downloadable product file | `factory`, `products/service`, `files/service` | Version `approved`, file stored, bytes pinned to the approved hash |
| 6 | Catalogue and price | `catalogue/service` | Listing `approved`, price in whole cents (AUD) |
| 7 | Seller ready (fixture) | `sellers` | Checkout ready |
| 8 | Published test storefront | `site-versions/store`, `hosts/registry`, `storefront/load` | Store `live`, shows the catalogue price |
| 9 | Fixture checkout | `checkout/service`, `orders` | Order `pending`, nothing delivered |
| 10 | Paid order | `checkout/service` (signed event) | Order `paid` |
| 11 | Delivery of the correct file | `fulfilment/service`, `files/service` | Fulfilment `delivered`, one email, link gives this business's file |
| 12 | Owner's order and delivery status | `fulfilment/service` `listStoreOrders`, `lookupBuyerOrder` | Owner row: paid + delivered; buyer: "sent" |

Steps 4-8 run as one durable job (`journey-build-business`, steps `brand`, `product`, `listing`, `seller`, `publish`).

## Read model
Owner order row: `OrderHistoryRow` (`fulfilment/types.ts`): `orderStatus` (`OrderStatus`), `fulfilmentStatus` (`FulfilmentStatus` or `none`),
`deliveredAt`, `needsOwner`. Buyer: `BuyerOrderView.delivery`. Job: `JobRecord.status` and per-step status (`jobs/types.ts`).
All reads are scoped to workspace and business; another business's record looks like one that does not exist.

## Mutations, events, idempotency
- Choose idea: key `select:<workspace>:<idea>`. Build job: key `build:<businessId>` (one job per business).
- Payment event: provider event id plus checkout session id; a replay answers `duplicate_event` and changes nothing.
- Delivery: one fulfilment and one grant per order; email sent once (fulfilment lease). Reissue: revokes old grants, one new email.
- The server re-checks workspace, business and payment state on every call.
- Persisted before dependent work: ids are saved in job step checkpoints (never a download link).

## Fixtures
`apps/web/lib/aimp/journey/fixtures.ts` (two businesses, clock start `2026-11-14T10:00:00Z`, fixture secrets) and
`apps/web/lib/aimp/journey/world.ts` (harness; calls only existing public functions). Provider registry is built from an empty
environment, so every provider is a labelled fixture.

| Case | Fixture or helper |
| --- | --- |
| Success | `world.buy(key)` |
| No data | `loadPublishedStore('no-such-store')` returns null; empty order list for the other business |
| Waiting | `world.startOrder(key)` (pending, unpaid) |
| Retry | `world.jobs` (stop, expire lease, resume) |
| Expired access | advance `world.clock.t` by 73 hours |
| Forbidden | the other business's ids, tokens and slugs |

Customer-safe errors: a bad or expired link is a plain "gone" (410) or a refusal with no internal reason; operational reasons stay in the audit log.

## Acceptance scenario (numbered; run by `aimp-journey-acceptance.test.ts`)
1. Both businesses walk steps 1-12 above; they end with different niches, stores, files, orders and one email each.
2. Interrupted build: stop after step `brand`, kill a worker after `product` did its work but before its checkpoint, resume after the lease. Proven: the job engine resumes from its checkpoint (finished step not re-run, lost step re-run once) and each harness step ran its effect once; the real stores then hold one brand, one product, one approved version and file, one listing and one site. NOT proven: idempotency of the real services when called twice (the harness steps skip work already done).
3. Repeated payment event (burst and through the webhook handler): one order, one fulfilment, one grant, one email. Also (2b): a second, different event id for the same session, and concurrent first deliveries (same event id, and two event ids), give the same single result.
4. Pending order: no link can be issued, delivered, reissued or retried; a bad signature does not pay it; the real event does.
5. Expired link (73 hours): 410; owner reissue gives a working link to the same file; the old link stays dead.
6. Isolation both ways across two workspaces: orders, fulfilments, grants, files, products, listings, brand, selections, campaign, store drafts, checkout. (5b) Two businesses in the SAME workspace: owner order history, buyer lookup, download with the wrong business id, catalogue listing and checkout of the other's listing all answer as "does not exist". Grants via `files` are NOT separated by business (see gaps).
7. Campaign draft built from the real listings and approved brand, approved (with `expectedVersion`) with no social adapter in the pipeline; links equal the published product page of the real listing. Nothing here proves posting or publishing-account handling.

Command (repo root `/Users/dylan/Developer/AIMONEYPRINTER`):
`npm --prefix apps/web test` for everything, or for this run only:
`cd apps/web && node --experimental-strip-types --test test/aimp-journey-acceptance.test.ts`

## States used
Order `pending`/`paid`/`refunded`; fulfilment `delivered`/`none`; job `queued`/`running`/`succeeded`; store `live`/`none`;
campaign `draft`/`approved`; link `expired` (410). See `CANONICAL_STATES.md` sections 1-3.

## Dependencies and blockers (gaps are `test.todo` in the test file)
- No production job builds a business (`build_business` record is never consumed; `generate-product` and `publish-site` are demo stubs).
- The storefront buy button is off (`checkoutBuilt = false` in `storefront/load.ts`); no storefront route calls `/api/aimp/checkout`.
- No seam turns published site versions into the checkout store directory or the order-book workspace list.
- Campaigns have no publishing-account input; posting is AMP-052.
- GAP: idempotency of the real build services under a repeated call is not exercised: the harness steps guard against repeats.
- GAP (real finding): `files` grant calls take `FilesCtx = { workspaceId }` only, so two businesses in one workspace can list, issue and reissue each other's order grants through `files`. `redeem(token, { businessId })` and the fulfilment service do separate them.
- Harness substitutions: the storefront config is built by the harness (`world.ts` `storeConfigFor`; no production builder exists); cover assets are written straight into the memory cover store; `sellers.register` is called with a fixture snapshot (seller onboarding is not exercised); the store directory and order-book workspace list come from harness records.
- Still needed for Provider Test: Stripe test keys (AMP-043-D), real email and storage. Live stays pending.

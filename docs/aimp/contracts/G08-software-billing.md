# G08 Software billing (AMP-044, fixture slice)

Code: `apps/web/lib/aimp/billing/` (`types.ts`, `plans.ts`, `store.ts`, `fixtures.ts`, `service.ts`, `index.ts`). Tests: `apps/web/test/aimp-billing-service.test.ts`, `aimp-billing-independence.test.ts`.
Library level on in-memory stores and a fixture provider only: no route, no page, no migration, no network, no keys, nothing in the app calls it yet. A real Stripe adapter comes later behind `BillingProvider` (owner item AMP-043-D).

This is what a workspace pays AiMoneyPrinter for the software. It is NOT seller revenue (what a seller's buyers pay the seller through Stripe Connect, `lib/aimp/sellers`). The two never mix: software charges use `PlatformSubscriptionCharge` (`flow: 'platform_subscription'`) from `sellers/money.ts`, seller sales use `SellerCharge`, and each total function refuses the other. Billing code imports only that money type from `sellers`; it never reads or writes seller accounts, orders or payouts.

## Actor and permissions

The service takes the tenant and actor as arguments and trusts them; the caller must build them from a verified server session. Mutations take `OperationContext` (`workspaceId`, `actorUserId`, `idempotencyKey`, all required). Who may change a plan (workspace owner only, by default) is enforced by the route that calls this, not here. `applyEvent` is the webhook path: the real adapter MUST verify the provider signature on the raw body before calling it. Every read and write names one `workspaceId`; the store has no method that lists or reads across workspaces (the one exception, `workspaceOfProviderSubscription`, is the webhook lookup).

## Plans (names and prices from the public site config, `lib/aimp/site-config.ts`, "draft pricing hypotheses")

| id | name | price (AUD / period) | businesses | products / period | AI generations / period | adds features |
| --- | --- | --- | --- | --- | --- | --- |
| discover | Discover | A$0 | 0 | 0 | 0 | opportunity suggestions (5 / period), sample preview |
| launch | Launch | A$79 | 1 | 20 | 40 | store, product creation, seller payments, file delivery |
| autopilot | Autopilot | A$149 | 1 | 40 | 80 | social publishing, daily checks |
| scale | Scale | A$249 | 3 | 120 | 300 | multiple businesses |

Billing keeps its OWN snapshot of names and prices (`PRICE_SNAPSHOT` in `plans.ts`, whole AUD dollars) and does not import the site config: editing the public pricing page cannot change what is charged or break billing at import (AMP-166). A test pins the charged numbers as literals and compares the snapshot with the public config, so a drift fails loudly until billing is updated on purpose; a second test (import graph) proves billing never imports `site-config.ts`. The feature lists follow the site's "includes" text. The allowance numbers and `maxBusinesses` are PLACEHOLDERS (the site says "monthly limits are still being set"); every plan carries `placeholder: true`. Features: `opportunity_suggestions`, `sample_preview`, `store`, `product_creation`, `seller_payments`, `file_delivery`, `social_publishing`, `daily_checks`, `multiple_businesses`. Meters: `opportunity_suggestions`, `products`, `ai_generations`.

### How allowances relate to the automation caps (G04 / `lib/aimp/automation`)

Two different limits that both exist. The billing allowance is the PLAN limit: what the workspace has paid for, per billing period. The automation usage cap (`DEFAULT_CAP` 20, owner-set) is the owner's own limit on automatic generation inside a business. The effective limit for a generation is the smaller of the two. This library does not read or change the automation cap and the automation code does not call billing yet; wiring (the job engine calling `recordUsage` with the job id as `key`, and showing the lower number) is a later slice. Billing does not duplicate the cap's per-business, owner-editable setting.

## Subscription record and states

One per workspace: `planId`, `status` (`trialing` | `active` | `past_due` | `cancelled`), `cancelAtPeriodEnd`, `pendingPlanId`, `currentPeriodStart/End` (epoch ms; for a trial the end of the trial), `graceEndsAt`, `providerSubscriptionId`, `lastEventAt`, `version` (compare-and-set). No record = `none` = the free Discover plan.

The owner-facing `state` (`BillingView.state`): `none`, `trialing`, `active`, `past_due`, `cancel_at_period_end` (active but ending), `cancelled`.

The state is computed with the clock (`effectiveOf`), so a missed webhook cannot leave paid access open:
- a cancelling subscription at its period end -> `cancelled`;
- a period that ended with no renewal event -> `past_due` with grace counted from the period end;
- `past_due` whose grace has ended -> `cancelled`.
`cancelled` and `none` get Discover entitlements. `past_due` keeps the paid plan until grace ends. `reconcile(workspaceId)` writes these time-based changes down; reads give the same answers without it.

### Transitions

| from | event | to |
| --- | --- | --- |
| none / cancelled | `startPlan` (paid) | `active` (or `trialing` when a trial applies) |
| active / trialing | `cancel` | `cancel_at_period_end` (access kept) |
| cancel_at_period_end | `resume` | `active` |
| cancel_at_period_end | period end | `cancelled` |
| active / trialing | `payment.failed` | `past_due`, `graceEndsAt = event time + grace` (first failure only; retries do not extend it) |
| past_due | `payment.succeeded` | `active` |
| past_due | grace ends | `cancelled` |
| active / past_due | `subscription.renewed` | `active`, new period, scheduled downgrade applied, allowance resets |
| any live state | `subscription.cancelled` (provider) | `cancelled` (`cancelledBy: 'provider'`, final) |
| cancel_at_period_end | period end, written by `reconcile` | `cancelled` (`cancelledBy: 'owner'`, final: a later renewal is ignored) |
| past_due / lapsed | grace ends, written by `reconcile` | `cancelled` (`cancelledBy: 'clock'`) |
| cancelled by the clock | `subscription.renewed` for a NEWER period | `active`, new period, `cancelledBy` cleared (the customer paid; the result is the same whether or not `reconcile` ran). A replay of an old period is ignored. |

Charges: the software charge for a start, an upgrade or a renewal is filed BEFORE the subscription is written, under a key the retry repeats (`start:<provider subscription>`, `change:<workspace>:change:<idempotency key>`, `event:<event id>`; filing the same key twice stores one). If either step fails, the event claim is released (or the caller retries with the same idempotency key) and the retry ends with exactly one charge. A stored subscription that fails validation (unknown plan, non-integer or negative times, unknown status) is treated as unreadable: reads answer "not allowed" (`subscription_unreadable` / `unavailable`) and events answer `unavailable`. Plan prices are validated as whole cents when the catalogue loads.

Starting a plan over an old record that OUR clock ended (stored `active`/`past_due` but lapsed, or `cancelledBy: 'clock'`, and not already set to cancel) first calls `setCancelAtPeriodEnd(old provider subscription, cancel: true)` under the key `<workspace>:replace:<idempotency key>`, so the provider cannot keep billing the old subscription beside the new one. A provider `not_found` there is ignored; any other provider failure refuses the start (`payment_failed` / `provider_unavailable`) and creates nothing. Records ended by the owner (`cancelAtPeriodEnd` set) or by the provider (`cancelledBy: 'provider'` / `'owner'`) are already ended at the provider and are not touched again.

If the old subscription was told to end and `createSubscription` then fails, the start is refused and nothing is written: the customer stays on the free plan (Discover), nothing is charged, and a retry (the same or a new idempotency key) ends with exactly one new provider subscription and one charge (test AMP-172).

REAL adapter requirement (AMP-172): the fixture only flags the old subscription to end at period end. A real provider may already have renewed and charged the old subscription before our clock-based replacement (a missed renewal webhook). The real adapter must then cancel the old subscription IMMEDIATELY, or refund that renewal charge; "end at period end" alone is not enough, because the customer would be paid up twice. Late provider events for the replaced subscription (renewal, payment, cancel) answer `unknown_subscription` from `applyEvent` and are dropped: the old provider id no longer maps to a workspace, so it never changes the new subscription.

## Operations (`createBillingService({ store, provider, now?, graceMs?, trialDays? })`)

All results are typed, never thrown: `{ ok: true, view, changed }` or `{ ok: false, code, message }`. Codes: `invalid`, `unknown_plan`, `already_subscribed`, `no_subscription`, `not_cancelling`, `past_due`, `payment_failed`, `provider_unavailable`, `conflict`, `unavailable`.

- `getSubscription(workspaceId)` -> `{ ok, view }`. `view` = `{ workspaceId, state, planId, planName, priceMinor, currency: 'AUD', cancelAtPeriodEnd, pendingPlanId, currentPeriodEnd, graceEndsAt, features }`.
- `startPlan(ctx, { planId })` for a workspace with no live plan. Discover is a no-op (free needs no subscription). The same plan again returns `changed: false`; a different plan returns `already_subscribed` (use `changePlan`). A trial applies only to a workspace that has never had a subscription.
- `changePlan(ctx, { planId })`. Upgrade (higher rank): immediate, the provider charges the prorated difference, entitlements and allowance change at once, usage already spent this period is kept; refused with `past_due` while a payment is failing. Downgrade: NOT immediate; recorded as `pendingPlanId` and applied by the next renewal event (what was paid for stays until then). Choosing the current plan while a downgrade is scheduled cancels the schedule. Choosing Discover = `cancel`. No live plan -> `no_subscription`.
- `cancel(ctx)`: ends at the period end, access kept until then, idempotent (`changed: false` the second time). `resume(ctx)`: undoes it before it takes effect; after the period end the subscription is `cancelled` and `resume` answers `no_subscription` (start a new plan).
- Mutations are guarded per workspace: a second change started while one is running answers `conflict`, and the write is a compare-and-set on `version`. A provider failure (`payment_failed`, `provider_unavailable`) changes nothing in the store.
- `reconcile(workspaceId)` -> `{ ok, view }`.
- `applyEvent(event)` -> `'applied' | 'duplicate' | 'stale' | 'ignored' | 'invalid' | 'unknown_subscription' | 'unavailable'`. Event: `{ id, type, created (ms), providerSubscriptionId, data?: { periodStart, periodEnd, amountMinor } }`, types `subscription.renewed`, `payment.failed`, `payment.succeeded`, `subscription.cancelled`. Idempotent by event id (second time: `duplicate`, nothing changes). An event older than the newest applied one for that subscription is `stale`. An unknown provider subscription is never created from a webhook and its id is not recorded. If storing fails the claim on the event id is given back so the provider's retry works. A renewal for a subscription set to cancel, and a replayed old period, are `ignored`.
- `can(workspaceId, feature)` -> `{ allowed: true, reason: 'in_plan', planId }` or `{ allowed: false, reason: 'not_in_plan' | 'unknown_feature' | 'invalid_request' | 'subscription_unreadable', planId, message }`.
- `remaining(workspaceId, meter)` -> `{ ok: true, meter, limit, used, remaining, periodKey, resetsAt }` or `{ ok: false, reason, message }`.
- `recordUsage({ workspaceId, meter, amount = 1, key? })` -> `{ allowed: true, replay, ...usage }` or `{ allowed: false, reason: 'not_in_plan' | 'limit_reached' | 'invalid_request' | 'unavailable', message, usage? }`. Amount is a whole number 1 to 1000. The limit check and the add are ONE store step (`addUsage`, a conditional increment), so two simultaneous calls at the limit cannot both pass; a request that does not fit is refused whole. A repeated `key` spends once (`replay: true`). `replay: true` IS the visible signal that a key was reused: callers must log it (and must not treat it as a fresh spend); a test (AMP-172) asserts the flag reaches the caller. Spending behaviour is unchanged. The key is scoped to workspace + meter and NOT to the period, so a retry that arrives after a renewal (a new period) is still a replay and does not spend again in the new period.
- Usage period: the billing period while a plan is live (allowance resets on renewal), otherwise the UTC calendar month (Discover). An upgrade raises the limit immediately and keeps what was already used.

Fail closed: if the subscription or the usage cannot be read, `can` answers not allowed (`subscription_unreadable`, even for features the free plan has), `remaining` answers `ok: false`, `recordUsage` answers `unavailable` and never reaches `addUsage`, and every mutation answers `unavailable`. Nothing returns an allow on an error.

## Provider (`BillingProvider`)

`createSubscription`, `changePlan` (`timing: 'immediate' | 'period_end'`), `setCancelAtPeriodEnd`, each with an idempotency key; failures are `BillingProviderError` (`payment_failed`, `unavailable`, `not_found`, `idempotency_conflict`). A provider MUST refuse an idempotency key that is reused with a different request (`idempotency_conflict`; the service answers `invalid` and changes nothing); the same key with the same request replays the first answer. The fixture provider records a fingerprint (method plus every field except the key) per key and does exactly this, across methods too. The fixture provider (`createFixtureBillingProvider`) is deterministic (counting ids, injected clock, 30-day periods, proration by time left), records its calls, can be told to fail the next call, and builds events (`event`, `renewalEvent`). No network, no env, no keys.

## Fixtures

`createMemoryBillingStore()` (subscriptions, usage, event ids, charges), `createFixtureBillingProvider()`, `PLANS`. All DEMO data. Single process memory.

## Expiry of seen-event ids and usage keys (rule for the database version)

The memory store keeps both for the life of the process. The database version keeps one row per seen webhook event id (`claimEvent`) and one per usage key (`addUsage` with a `key`), each with a `created_at`, and deletes rows by this rule (a scheduled clean-up; deleting is never done inside a request):
- Seen event ids: keep 90 days from first claim. Providers stop redelivering a webhook within days, and events older than the newest applied one are dropped as `stale` anyway (`lastEventAt`), so an expired id replayed later is still harmless.
- Usage keys: keep 90 days from first use. This covers monthly periods; if a plan ever has a period longer than 60 days, keep the key until 30 days after that period ends instead. A key that has expired and is replayed spends again, so callers must not reuse a key (use the job id) and must stop retrying well inside that window.
- Never expire a key or id whose workspace's period is still open. Rows are keyed `(workspace_id, meter, key)` for usage keys and `(event_id)` for events, with an index on `created_at` for the clean-up.

## Independence (the board's acceptance criterion)

"Changing a software plan updates product entitlements independently of merchant sales and buyer orders." Shown by `aimp-billing-independence.test.ts` with an import-graph check (AMP-166): it reads the real billing source files, follows every `import` / `export ... from` / `import()` transitively, and fails if billing reaches any `sellers/` or `orders/` module other than `sellers/money.ts` (which itself must import nothing), if billing imports anything from `sellers/money.ts` except `platformSubscriptionCharge` / `PlatformSubscriptionCharge`, if it imports a package, or if it reaches the public `site-config.ts`. (The earlier behavioural tests that ran a lifecycle beside a seller store could not fail, because billing never held a reference to that store, and were replaced.) Software charges and seller charges are different types and each total refuses the other (a behavioural test).

## NOT done in this slice

- No real provider, no Stripe, no webhook route, no signature check (the adapter must do it), no checkout or customer portal, no invoices or receipts, no tax (GST), no refunds or credits, no coupons, no dunning emails.
- Nothing in the app calls it: no route, no page, no UI, no job-engine hook, no migration. The automation cap and the business and product creators do not check billing yet.
- No persistent store. Per-process only: the per-workspace change guard lives in one process's memory, so two servers need the database compare-and-set (already the real guard) and a shared lock or accept `conflict`.
- Provider-then-store is two steps: if the provider changed and the store write then fails, the next provider event (or a manual `reconcile` against the provider) must repair it. A real adapter should add a read-back from the provider.
- Platform admin changes (comp a plan, refund) and who counts as an admin: not built.

## Open decisions for the owner (with the default assumed)

1. Prices: assumed the public draft prices (A$0, A$79, A$149, A$249 a month). They are "draft pricing hypotheses" on the site.
2. Allowances per plan (products, AI generations, businesses): placeholders in `plans.ts` (see table).
3. Free trial: assumed NONE (`DEFAULT_TRIAL_DAYS = 0`); the library supports one trial per workspace on its first paid plan when `trialDays` is set.
4. Grace after a failed payment: assumed 7 days of full access (`DEFAULT_GRACE_MS`), then Discover.
5. Downgrade timing: assumed at the next renewal (no refund of the unused part); upgrades immediate with proration.
6. Cancellation: assumed at period end only (no immediate cancel, no refund); refund and cancellation terms are still being finalised on the public site.
7. Billing period: fixture uses 30 days; a real provider will use its own cycle (monthly, with an annual option?).
8. What happens to a business and its store when a workspace drops to Discover (kept read-only, unpublished, or removed): not decided here; this library only answers entitlements.
9. Who may change the plan (workspace owner only assumed).

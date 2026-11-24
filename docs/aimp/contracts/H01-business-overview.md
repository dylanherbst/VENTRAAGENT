# H01: Business Overview read model (screen 10, `/app/[business]`)

Status: **read model built on fixtures and injected deps, Local evidence.** No merchant page, no real wiring, no analytics source.
Written 14 Nov 2026 for AMP-080. Code: `apps/web/lib/aimp/overview/`. Isolated page: `/tools/aimp-overview` (plain markup, DEMO).
Spec: `Page_By_Page_Build_Specification.md` screen 10 (brief IDs H01, H04, G03, G06). Frontend owner: the glass page agent.

## Entry points (all exported from `lib/aimp/overview/index.ts`)

```ts
collectOverviewSnapshot(deps: OverviewDeps, scope: OverviewScope): Promise<OverviewSnapshot>   // tenant-scoped reads
buildBusinessOverview(snapshot: OverviewSnapshot, now: Date): BusinessOverview                  // pure, deterministic
getBusinessOverview(deps: OverviewDeps, scope: OverviewScope): Promise<BusinessOverview>        // collect + build
formatMoney(m: Money): string   formatMoneyList(list: Money[]): string   formatUtc(iso: string): string
currencyDigits(currency: string): number   isMinorAmount(v: unknown): boolean   // decimals follow the currency (JPY/KRW 0, KWD 3, others 2)
```

`OverviewScope = { workspaceId, businessId }`. Every dep read receives both. Orders, deliveries and money events carry their own ids and
`collect` drops any row that is not this workspace and business, so a dep that lists a whole workspace cannot leak another business.
A failing read fails the whole collect (never a half-empty snapshot that reads as zero). Bad scope throws `OverviewError`.

**Pre-scoped deps (important).** Approvals, activity, seller, store, steps, currency and analytics return data with no tenant ids, so `collect` CANNOT
re-check them. The adapter behind each of those deps MUST already return only that workspace and business's data. The overview tests only prove
that the full scope is passed to every dep (spy tests); that each real adapter filters by it must be tested at the real adapter, not here.

**Freshness.** `OverviewDeps.freshness?.asOf(scope)` (optional) returns when the underlying data was last refreshed (a cache or replica time).
`collectedAt`, `summary.lastUpdatedAt` and `data_stale` then follow that time. Null, unreadable or future times fall back to now; without the dep,
data is treated as read now and `getBusinessOverview` is never stale. Staleness is `now - collectedAt > STALE_AFTER_MS`.

**Hrefs.** `buildBusinessOverview` and `overviewHref` throw `OverviewError` for a business id that is not a plain id (letters, digits, `. _ : -`,
1 to 100 long, not `.` or `..`). Record ids in a path are `encodeURIComponent`-encoded.

## Output: `BusinessOverview`

`{ businessId, workspaceId, state, flags, summary, needsYou[], needsYouTotal, recentActivity[], launchProgress, dailyBrief, generatedAt }`

- **state** (existing names only; the five open canonical-state decisions are not settled here): `new_setup | live | zero_orders | data_stale | degraded_checkout`.
  Precedence: not published = `new_setup`; snapshot older than `STALE_AFTER_MS` (15 min) = `data_stale`; published and seller cannot take payments =
  `degraded_checkout`; no paid order = `zero_orders`; else `live`. `flags` (`stale`, `checkoutDegraded`, `storePublished`) keep the conditions the
  primary state hides. "Tenant switch" is the page's job: call again with the other business.
- **summary**: `visits: { known: true, value } | { known: false }` (unknown when there is no analytics source; a source reporting 0 is a known 0),
  `orders` (paid, including later refunded; pending and failed are not orders), `grossSales: Money[]` and `refunds: Money[]` (integer minor units; `grossSales` has one entry per
  currency that has sales, sorted by code; `refunds` has exactly one entry for every currency in `grossSales`, zero where that currency has no refunds; with no sales at
  all, both are one zero in the business currency), `invalidAmounts` (one combined count of paid orders and refund events skipped because their amount is not a whole
  non-negative number of minor units; skipped amounts are in no total), `delivery { delivered, pending, failed }`, `storeUrl`, `lastUpdatedAt`.
  Refunds = fully refunded orders + `partial_refund` events once per event id, only on paid orders (never on top of a fully refunded order), capped cumulatively at the
  order amount. All time, not windowed.
- **needsYou**: ranked, at most `MAX_NEEDS_YOU` (8), `needsYouTotal` is the count before the cut. Item: `{ id, rank, category, severity, title, action, impact, href, source }`.
  Order: category `checkout > delivery > money > approval > blocker > setup`, then severity `critical > high > medium > low`, then `id` ascending (stable tiebreak).
  Sources: seller readiness (checkout when the store is published, setup when it is not), failed / needs-review / stuck (30 min) deliveries, refund and dispute
  events waiting for the owner, pending unexpired approvals, failed publish, job and limit blockers from the activity feed, and the next unfinished build step.
  `href` is always under `/app/<businessId>/` (`payments`, `orders/<orderId>`, `website`, `products`, `marketing`, `brand`, `build`, `settings`).
- **recentActivity**: newest first, at most 10, from the automation activity feed.
- **launchProgress**: `steps` idea, brand, product, catalogue, store, payments, first_order with `done`, `total`, `nextStep`. Store, payments and first order are
  derived from the store, seller readiness and orders; the first four come from persisted build steps.
- **dailyBrief**: at most 6 short sentences built in code from the snapshot (no model call). Each line has `links` to the destination.

## Inputs a real wiring must supply (`OverviewDeps`)

| Dep | Real source | Not yet real |
| --- | --- | --- |
| `orders.list` | orders store (`OrderStore.list(workspaceId)`, filter to business) | no business-scoped list method; adapter filters |
| `fulfilment.list`, `.moneyEvents` | fulfilment store `list` and `listMoneyEvents` | rows mapped to `OverviewDelivery` / `OverviewMoneyEvent` |
| `seller.readiness` | sellers store `get(workspaceId, businessId)` then `deriveReadiness(account?.snapshot ?? null)` | |
| `store.get` | site-versions / hosts registry (published flag, URL, last publish failed) | no single read exists yet |
| `steps.get` | persisted setup state (the `/start` runtime holds idea, brand, product, catalogue in memory) | not persisted anywhere queryable |
| `automation.approvals`, `.activity` | `AutomationService.approvals(ctx, { status: 'pending' })` and `.activity(ctx)` | needs an `OperationContext` (actor id) |
| `analytics.visits` (optional) | none | **no analytics source exists**; leave it out and visits stay unknown |
| `business.currency` | business record | |

## Not built / not proven

- No database, no real services wired, no analytics, no scheduled cache or refresh (the page agent caches the snapshot; staleness is measured from `collectedAt`).
- Summary is all-time; date windows and date-range formatting for the page are open.
- Tests run on fixtures and in-memory deps only. Code under test: `test/aimp-overview-build.test.ts`, `test/aimp-overview-collect.test.ts`.

# H01 Business Overview data sources and cached snapshot (AMP-091)

Code: `apps/web/lib/aimp/overview/sources.ts`, `cache.ts` (exported from `overview/index.ts`). Tests: `apps/web/test/aimp-overview-sources.test.ts`.

## Sources

| Dep (`OverviewDeps`) | Adapter | Status | Backed by |
| --- | --- | --- | --- |
| `seller` | `createSellerSource(sellerStore)` | real | `SellerAccountStore.get(ws, biz)` + `deriveReadiness`; no account = `not_connected` |
| `fulfilment.list` | `createFulfilmentSource(fulfilmentStore)` | real | `FulfilmentStore.list(ws)`, filtered to the business |
| `fulfilment.moneyEvents` | same | real | `FulfilmentStore.listMoneyEvents(ws)` (refund, partial refund, dispute, refund exception), filtered to the business |
| `analytics` (visits) | `createAbsentVisitsSource()` | absent | no per-business visit counter exists (`lib/aimp/analytics.ts` is marketing `track()` only). Answers `null`; the read model shows `visits: { known: false }`, never 0 |
| `analytics` (future) | `createVisitsSource(read)` | port | accepts a non-negative integer, anything else is unknown |

Sales and refund totals still come from `orders` (paid / refunded orders) in the read model; refund events from the fulfilment store feed Needs you.
No buyer email, token or link is copied into the overview shapes.

Gap: `FulfilmentStore` has no list-by-business, so the adapter lists per workspace and filters; `collect` filters again.

## Snapshot cache

`createOverviewCache({ deps, staleAfterMs?, refreshAfterMs?, maxEntries?, now? })` returns `get(scope)`, `refresh(scope)`, `invalidate(scope)`, `size()`.
`get` and `refresh` return `{ overview, refreshedAt, ageMs, stale, fromCache, refreshFailed, lastRefreshErrorAt }`.
`refreshFailed` is true (and `lastRefreshErrorAt` is the ISO time of the failed re-read, else null; never error text) when the latest automatic re-read failed and the older snapshot is being served. The next successful read clears it. The UI should show "could not refresh" when it is true, even if `stale` is still false.
`invalidate()` and `refresh()` supersede any load already in flight: the older load's result is not stored.

- Keyed `workspaceId/businessId`; scope ids are validated (`OverviewError` on bad ids).
- Built once, then served from cache; the overview is rebuilt from the cached snapshot at the injected `now`, so `generatedAt` moves and the data does not.
- `refreshedAt` is when the sources were read. After `staleAfterMs` (default 15 min) `overview.flags.stale` is true and the state is `data_stale`.
- `refresh()` re-reads; failure throws. With `refreshAfterMs`, `get()` re-reads when older, and a failed auto refresh keeps serving the old snapshot (which then goes stale). A failed first build is never cached. Concurrent reads share one build.
- `buildBusinessOverview(snapshot, now, { staleAfterMs? })`: new optional third argument; default behaviour unchanged.
- In memory, per server process. A shared cache (database) is a later step.

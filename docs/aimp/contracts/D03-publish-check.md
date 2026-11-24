# D03 Publish smoke test (AMP-035)

Code: `apps/web/lib/aimp/publish-check/` (`check.ts`, `publish.ts`). Tests: `apps/web/test/aimp-publish-check-*.test.ts`.

## Inputs

`publishWithCheck(deps, { actor: { workspaceId, userId }, businessId, storeSlug, note?, expectedRevision? })`

`deps = { versions, check }`
- `versions`: the site-versions API (`publish`, `rollback`, `pause`, `history`, `resolvePublished`).
- `check` (`PublishCheckDeps`): `resolveLive(slug)` (public resolver), `loadPage(slug, ref)`, `checkout: CheckoutProbe`, optional `checkoutAvailable` (defaults to the storefront `checkoutBuilt` flag).

Helpers: `createPageLoader(loadStore)` (page must come from the published snapshot and have its content), `createCheckoutProbe(deps)` (see below).

`runPublishCheck(checkDeps, { workspaceId, businessId, storeSlug, versionId })` is the pure check on its own.

## Result

- Check: `{ ok: true, checks: [{check, detail}], skipped: [{check, detail}] }` or `{ ok: false, failed: [{check, reason}], checks, skipped }`.
- Publish: `{ ok: true, outcome: 'published', version, checks, skipped }` or `{ ok: false, outcome, message, failed, version?, rolledBackTo?, rollbackErrors? }`.
  Outcomes: `rolled_back`, `unpublished`, `rollback_failed`, `not_published` (store refused, paused, or no access), `unchanged_check_failed`, `timed_out`.
  `message` is plain English and names every failed check.

## Fixes in AMP-098

- Result shape: a failed publish always carries `failed`, `checks`, `skipped` and `retryable`. `retryable: true` only for `not_published` caused by a store `conflict` or `failed` code, or by a throw before anything could change ("please try again"). Never true for check failures or `rollback_failed`.
- `PublishSiteApi` now also needs `getVersion` (to compare restored content).
- Marker: every version published here has `PUBLISH_MARK` (`[publish-check]`) appended to its note (so the owner note may be at most 200 minus the marker length minus one characters).
- Crash retry: if a run died after a failed check but before the undo, the retry sees draft equal to live (`unchanged`). If that live version is a `publish` version whose note carries the marker and it fails the check, it is undone like a fresh failure (roll back to version - 1, or pause if it is version 1): `rolled_back` or `unpublished`. An unchanged live version without the marker is still only reported (`unchanged_check_failed`). (Superseded by AMP-101: a version that passed is never undone, and an unrecorded one is re-checked once first. Rollback target is from history, not version - 1.)
- One publish per workspace + store at a time inside the process (a queue). Across processes the guard is: before any undo, `history.liveVersion` must still be the version this run published; otherwise nothing is undone and the result is `rollback_failed` ("another version went live since") with the other version left untouched.
- Every call in the undo (history, getVersion, rollback, pause, resolvePublished) is wrapped: a throw becomes `rollback_failed` with a plain `rollbackErrors` entry (no raw error text) and the "may still be live" message. `publishWithCheck` never throws.
- After a rollback the public resolver must serve the restored version number AND content equal to the target version (deep compare); otherwise `rollback_failed`.
- Checkout: when the storefront would show buy buttons but no probe is connected, `checkout` fails (never passes). No products for sale: reported skipped. A skipped checkout is only ever in `skipped`, never in `checks`.
- Business check: `CheckoutProbe.checkStore` (store directory matches workspace and business) runs on every publish, also when checkout is skipped. Result `business` in `checks`, a failure, or `skipped` when the probe has no `checkStore`.
- Job `publish-site`: the `publish` step stores the structured result (`published`, `outcome`, `message`, `version`, `checks`, `skipped`, `failed`, `rolledBackTo`, `rollbackErrors`); a retryable refusal throws a temporary `JobError` (the job retries with backoff). The `smoke-test` step fails the job (permanent, the message) unless `published` is true and otherwise reports `{ smokeTest: 'pass', checks, checkout: 'passed' | 'skipped', skipped }`.

## Fixes in AMP-101

- Passed versions are recorded (AMP-101: in memory only, key workspace/slug/version/publishedAt; since AMP-145 in the site-version store first, memory is the fallback). A version that passed is never rolled back or paused because a later check of the unchanged draft failed: outcome `unchanged_check_failed`, version left live. This replaces the AMP-098 "known trade-off" (a healthy marked version that later breaks is no longer undone on an unchanged republish).
- A marked, unchanged live version with no recorded pass (crash before the undo, or a restart that lost the record) gets a confirming re-run. Pass: kept, result `published`. Fail again: undone as before (`rolled_back` / `unpublished`), using the second run's findings.
- `PublishWithCheckDeps.queueTimeoutMs` (default 120000): one publish may hold the per-store queue this long. On timeout the caller gets outcome `timed_out` (`ok: false`, `retryable: false`, message "may or may not have changed, look at your live store"), the queue moves on, and the abandoned run makes no further store change (it is checked before publishing and before the undo). A step that never settles cannot be cancelled, only abandoned.
- Rollback target: the version that was live before ours, read from history. Fresh publish: `history.liveVersion` before publishing. Unchanged retry: the go-live event (publish or rollback) before ours in `history.events`; none means pause. Never `version - 1`.

- Abandoned runs (second round): the version is tracked as soon as publish succeeds and named in the `timed_out` result when known. An abandoned run does not start the check after publish returns. Before every rollback or pause it re-checks "not abandoned" and re-reads history to confirm our version is still live (the target read comes first, so only that history read sits before the change). If another version is live, the existing `rollback_failed` "another version went live" result is returned and nothing is touched.
- Limits of the pass record (AMP-101 state, superseded by AMP-145 below): it was kept only in memory per version-store object and was lost when the caller built a new versions wrapper per call. Since AMP-145 a pass is recorded in the site-version store (see below); the in-memory record is only a fallback.

## Site-version store: expectedLive and stored pass flag (AMP-145)

- `rollback(actor, slug, toVersion, { note?, expectedLive? })` and `pause(actor, slug, { expectedLive? })`: when `expectedLive` is given and the live version is different (or nothing is live), the store changes nothing and answers `{ ok: false, code: 'conflict', errors: ['Version N is live now, not version M, so nothing was changed.'] }`. A non-integer `expectedLive` answers `invalid`. Without the argument, behaviour is unchanged.
- publish-check passes `expectedLive: <the version it published>` on both undo paths. A `conflict` there gives `rollback_failed` with the "another version went live since" message and the other version untouched. This closes the cross-process gap that the history read before the undo only narrowed.
- `markChecked(actor, slug, version)` records that a version passed its check: `{ ok: true, value: { version, checkedOk: true } }`, idempotent, workspace-scoped (`denied` for another workspace, `not_found` for an unknown version). Only the version that is live right now can be marked: any other version (old, or nothing live) answers `conflict` ("Version N is live now, not version M, so nothing was changed.") and nothing is flagged, so a same-workspace caller cannot flag an old version. The flag shows as `checkedOk: true` on `VersionSummary` (history, and the `unchanged` publish result); it is absent when not recorded. A rollback copy is a new version and starts unrecorded.
- publish-check records every pass through `markChecked` (it marks the version it just published and checked, which is live) and reads `checkedOk` from the store. The in-memory record is only a fallback. It is used silently when the store has no `markChecked` (`PublishSiteApi.markChecked` is optional) or answers `failed` (the column is not there yet). For any other refusal (`denied`, `not_found`, `invalid`, `conflict`) or a throw, the in-memory pass is still kept (outcomes do not change) and a plain warning goes to the optional `PublishWithCheckDeps.onWarning(message)`; a throwing hook is ignored.
- What survives what: the only site-version store today is in memory. A recorded pass survives a new publish-check instance or a new wrapper over the same store object. It does NOT survive a process restart. Surviving a restart needs a database-backed store with a boolean column on the versions table, for example `site_versions.checked_ok boolean not null default false`. That store and migration are not written yet. Until then the in-memory fallback has the old limits: it is lost on a restart or when the caller builds a new versions object per call.
- `history().events` must keep a go-live event (publish or rollback, with `version`) per version, in order, because the rollback target is read from it.

## Checks

1. `live-version`: the public resolver serves this store address and exactly the version just published (not paused, not another slug).
2. `page:home`, `page:product:<slug>` for each product, `page:policy:refund|privacy|terms`, `page:contact`: loaded through `loadPage`.
3. `checkout:<slug>` for every product, only when the storefront would show a buy button (`purchaseState`: not a demo store, charges enabled, checkout built). Otherwise reported under `skipped` with the reason.
   The probe repeats the checkout service preconditions without side effects: store directory matches workspace and business, approved listing of that business, readable stored price, `checkoutGate` (provider on and seller `ready`), payments adapter present. A store with no seller connected fails with the seller gate's own message.

A check that throws counts as failed; raw error text never reaches the message.

## Rollback rule

Failed check after publish:
- a version was live before: `rollback` to it (a new version that copies it), then confirm the public resolver serves it. Outcome `rolled_back`.
- nothing was live before: `pause` the store, then confirm the resolver says paused. Outcome `unpublished`. The owner must resume before publishing again (a paused store is refused up front, `not_published`).
- the rollback or pause fails, throws, or does not take effect (including restored content differing from the target): outcome `rollback_failed` with `rollbackErrors`; the message says the store may still be live.
- publish was a no-op (draft equals live): nothing is undone; outcome `unchanged_check_failed`.

## Isolation

The actor's workspace is enforced by the site-versions store (another workspace gets `not_published` and no check runs). The probe refuses a store address that belongs to a different workspace or business before any catalogue read.

## Job

`publish-site` in `lib/aimp/jobs/handlers.ts` uses this when `HandlerDeps.publishSite` is set (input `{ storeSlug }`, business from the job). A failed check fails the job permanently with the message. Not set: the old DEMO stubs run unchanged.

## Not real yet

- No production caller sets `HandlerDeps.publishSite`; the demo job wiring (`jobs/demo.ts`) still uses stubs.
- Pages are loaded through the storefront loader and checked for content, not fetched over HTTP from a rendered server.
- Checkout is checked by preconditions; no payment session is created (`startCheckout` writes a pending order), so "checkout can start" is not an end-to-end purchase test. While `checkoutBuilt` is false, checkout is reported as skipped.
- The publish queue is per process. Across processes the undo is guarded by the store's `expectedLive`; the in-memory store implements it, a database-backed store must implement it atomically (one conditional update).
- The crash-retry rule relies on the note marker; a store that drops notes would lose it.
- The storefront product slug to catalogue listing mapping does not exist yet; the probe takes it as `listingIdFor`.
- The site-versions store is in memory; the database-backed store is a separate task.

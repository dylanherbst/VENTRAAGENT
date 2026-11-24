# Backend notes

Maintained by the backend engineer. Facts here come from reading code and running the unit tests with a fake Supabase; nothing here was checked against a real database or in a browser.

## Route test harness

`apps/web/test/helpers/route-harness.ts` registers a Node resolve hook (routes use extensionless relative imports and `next/server`), and offers `installFakeSupabase` (emulates `/auth/v1/user`, `/rest/v1/rpc/*`, `/rest/v1/<table>`), `setEnv`, `makeRequest` and `call`. Import it first in a test, then `await import()` the route. Each test file runs in its own process, so in-memory rate limiters do not leak between files.

## What the routes now share

- `lib/api-errors.ts`: error codes (`not_configured`, `signed_out`, `session_revoked`, `forbidden_origin`, `no_workspace_access`, `storage_unavailable`, `invalid_request`, `too_large`, `rate_limited`, `conflict`, `upstream_failed`) added as `code` next to the existing `error` text and flags (`signedIn`, `configured`). Plus same-origin JSON, plain-object and integer helpers.
- `lib/workspace-route.ts`: config check, cookie, Auth user, per-user rate limit and `session_active` for team, export, search, activity.
- `lib/rate-limit.ts`: `workspaceLimits` and `routeLimits` (see below), `clientKey`.
- `lib/byte-size.ts`: UTF-8 byte length and response caps (export 4.9 MB, search 1 MB, activity 1 MB).

## Limits in force (per server instance)

| Route | Key | Limit |
| --- | --- | --- |
| team, search, activity | user | 60 / minute |
| export | user | 10 / 10 minutes |
| launcher | user | 240 / minute |
| courses (and /workspace/courses) | user | 240 / minute |
| /api/workspace (all signed-in calls) | user | 300 / minute |
| login and signup | client address hint, and email | 20 and 10 / 10 minutes |
| checkout | client address hint, plus global | 10 and 200 / 10 minutes |
| courses/generate | user | 5 / 10 minutes (unchanged) |
| integrations/status | user | 30 / minute (unchanged) |
| stripe webhook | all callers, before the signature check | 600 / minute |

## Needs an owner decision or a migration (not done)

1. Rate limits live in process memory. On several instances or serverless they are per instance and reset on restart. A shared store (database table or a hosted cache) needs an owner decision and, for a table, a migration.
2. `x-forwarded-for` is only a hint and can be spoofed unless the host strips it. Confirm the production proxy before relying on the per-client limits for checkout and login.
3. Checkout is anonymous. Decide whether it should require sign-in so the limit can be per user.
4. Stripe webhook orders are held in memory (idempotent by event id) and are lost on restart. `supabase/migrations/202611030011_orders.sql` exists; wiring the webhook to it is a separate task and `docs/agents/ORDERS_PROPOSAL.md` applies. The in-memory ledger is not size-bounded (only verified events enter it).
5. Set `LAUNCHPAD_APP_ORIGIN` in any deployed environment; without it the origin check compares against the request Host header.
6. Login and signup have no CAPTCHA or lockout beyond the limits above and Supabase Auth's own limits.
7. `session_active()` is one extra database call per request. Fine at current scale; a short cache would need an owner decision on revocation delay.
8. Reads cap at 500 rows (`limit(500)`). There are 38 draft kinds, one row per kind per workspace, so this is not reachable today; paging is only needed if kinds multiply.
9. The import workspace-mismatch flag (`ImportItem.otherWorkspace`) exists but the UI does not show it yet; that is a frontend task.
10. `/api/courses` still returns one generic 400 for every invalid input and does not use `lib/api-errors.ts` codes except on the new session and rate-limit paths.

# P01 Platform operations (AMP-063 slice 1)

Code: `apps/web/lib/aimp/ops/` (`types.ts`, `store.ts`, `service.ts`, `index.ts`). Tests: `apps/web/test/aimp-ops-platform.test.ts`.
Library level on in-memory fixtures only: no route, no page, no database migration, nothing in the app calls it yet.

## What exists

Tenant key = `workspaceId` (as in the job engine and `lib/aimp/account`); an optional `businessId` narrows a request to one business.

- Actor (passed in by the caller, never read from user input): `owner` `{ id, workspaceId }` (own workspace only), `admin` `{ id }` (any tenant, reason required), `system` `{ id }` (refused for every operation here).
- `createOpsService({ jobs, audit, recoveries, limiter, workspaceExists, now })`:
  - `listProblemJobs(actor, { workspaceId, businessId?, reason? })` returns `{ ok: true, failed, stuck, auditId }`. `failed` = status `failed`. `stuck` = `running` with an expired lease (`lease_expired`) or `queued`/`waiting-retry` more than `STUCK_AFTER_MS` (15 min) past `nextRunAt` (`overdue`). A summary has no job `input` and no lease data.
  - `recoverJob(actor, { workspaceId, businessId?, jobId, reason? })` re-queues ONE failed job with the job engine's own `JobService.retry` (the engine gives the failed step a fresh attempt budget; finished steps are not re-run or re-charged; the job keeps its id and idempotency key, so no second job exists). The service never edits a job record itself. Returns `{ ok: true, job, auditId }`.
  - `readAudit(actor, { workspaceId, businessId?, limit? })` returns `{ ok: true, entries }` newest first (default 50, max 200). Owner: own workspace; admin: any; reading the audit is not itself audited.
- Job engine pieces reused: `JobService.get`, `list`, `retry`; `JobsError`; `safeText`; the runner and `createMemoryJobStore` in tests.

## Audit entry

`{ id, at, workspaceId, businessId | null, actor { kind, id }, action, target { kind, id }, outcome, reason?, metadata }`, deep-frozen.

- `action`: `job.list` | `job.recover` | `audit.read`. `target.kind`: `job` | `tenant`. `outcome`: `attempted` | `allowed` | `refused`.
- Append-only: `AuditStore` has `append`, `list` and the bounded unattributed pair (`appendUnattributed`, `listUnattributed`), and nothing that updates or removes. Reads are per workspace; `createAuditLog(...).reader(workspaceId)` cannot name another workspace.
- `metadata` is allow-listed: `refusal`, `jobKind`, `statusBefore`, `statusAfter`, `retryAfterSeconds`, `failedCount`, `stuckCount`. Keys matching token, secret, password, key or authorization are dropped even if listed. Values are numbers, booleans or short redacted strings.
- `reason` (max 200 chars): control characters rejected, secrets and file paths redacted by the job engine's `safeText`, email addresses replaced by `[email]`.
- `actor.id`, `target.id` and (unattributed entries only) the named workspace id are passed through the same redaction as the reason before they are stored (secrets and paths, email addresses become `[email]`, max 100 chars).
- Read limits: a caller-supplied `limit` becomes an integer from 1 to 200 (`boundedLimit`); NaN, Infinity, a non-number or missing gives the default 50. The store applies the same bound.
- Entries per request, once the request has a valid actor, a valid workspace (and business) id and a valid job id: a refusal writes one `refused` entry; a recovery that reaches the retry writes TWO: an `attempted` entry BEFORE `JobService.retry` runs and an outcome entry (`allowed`, or `refused` if the retry then refuses) after it. A request where any of those ids is missing or malformed returns `invalid` with `auditId: null` and writes nothing: the request is not trustworthy enough to name in a log. A refused owner attempt on a foreign workspace is written to the owner's own workspace, never the target's.
- Recovery FAILS CLOSED: if the `attempted` entry cannot be stored, `retry` is never called, the job stays `failed` and the answer is `unavailable`. If only the outcome entry fails after the retry, the recovery stands (it already happened and the attempt entry is durable) and `auditId` is the attempt entry's id. `retry` is called at most once per request, so a job step never runs twice because of this. For `listProblemJobs` (read only): an OWNER reading their own workspace still gets the list with `auditId: null` when the audit write fails. An ADMIN read FAILS CLOSED (AMP-162): an admin reading any tenant's jobs must have a durable `job.list` entry; if it cannot be stored, nothing is returned and the answer is `unavailable`. Likewise an admin `readAudit` is refused with `unavailable` when the workspace-existence lookup throws (it is not treated as "no such workspace") or when the audit store cannot be read. If the "recovered" record write fails after a retry, a second call answers `not_recoverable` instead of `already_recovered` (the job engine still prevents a second run).
- In-flight guard: a duplicate concurrent `recoverJob` for the same job is refused (`already_recovered`) before the rate limiter, so it spends no counter.
- `workspaceExists(workspaceId)` is a REQUIRED dependency of `createOpsService`. A workspace that does not exist (or a check that throws) answers `job_not_found` with the same code and message as a missing job for `recoverJob`, and for `listProblemJobs` when the caller is an owner; the refusal is written only to the unattributed list and no history is created for it. For an admin, `listProblemJobs` on a missing workspace is NOT refused (AMP-163): it returns `ok` with empty `failed` and `stuck` and an audit id (entry in the unattributed list), like an existing workspace with no problem jobs; if the lookup throws, the admin gets `unavailable`. AMP-162 closes the two observable differences an admin used to have: (1) the recovery rate limiter and the in-flight guard run BEFORE the existence check, and an admin's counter is keyed by the admin's own id (`admin:<id>`; an owner's by their own workspace), so an existing and a missing workspace spend the same counter and answer `rate_limited` / `already_recovered` at the same moments. The recovery limit for an admin is therefore per admin, not per workspace. (2) Every refusal an admin gets after naming a tenant (`job_not_found`, `rate_limited`, `already_recovered`, `not_recoverable`, `unavailable`) returns `auditId: null`; the entry is still written (under the workspace if it exists, in the unattributed list if not) and is found through `readAudit` / `readUnattributedAudit`. Successful admin results still return the id (only an existing workspace can succeed). `readAudit` of a missing workspace writes nothing and returns no entries.
- Unattributed list: refusals by a `system` actor, and `reason_required` refusals (an admin with no reason), are NOT written under the workspace the caller named, because that id may not exist and would grow a history for it without bound. They go to a separate list (`MAX_UNATTRIBUTED` = 500 entries in the memory store). When it is full the append is refused, not overwritten, the call's `auditId` is `null`, and the store counts the drops (`droppedUnattributed()`). Only an admin can read it, through `readUnattributedAudit`. An admin who gives a reason but names a workspace that does not exist also lands here: `recoverJob` is refused like a missing job, and `listProblemJobs` returns an `ok` empty list whose `job.list` entry is stored here (see `workspaceExists`).

## Refusals (typed results, never thrown)

`{ ok: false, code, message, auditId, retryAfterSeconds? }`

| code | when |
| --- | --- |
| `invalid` | missing or malformed actor, workspace, business or job id |
| `not_permitted` | `system` actor; owner acting outside their own workspace |
| `reason_required` | admin without a non-empty reason |
| `rate_limited` | over the recovery limit; `retryAfterSeconds` set |
| `job_not_found` | no such job, a job of another workspace, or of another business than the one named (identical answer, nothing leaks) |
| `not_recoverable` | job is not `failed` (including stuck jobs: the engine reclaims those itself) |
| `already_recovered` | this job was recovered here and is not failed again, or a concurrent recovery of it is in flight |
| `unavailable` | the job engine threw something other than not found / bad state |

Idempotency: recovery is valid only from `failed`, and the engine's `retry` is the one transition. A second or concurrent request answers `already_recovered`. A job that fails again may be recovered again.

## Rate limit

`createRateLimiter({ now, limit, windowMs, maxKeys })`: fixed window per (tenant, action), `check` returns `{ ok: true, remaining }` or `{ ok: false, retryAfterSeconds }`. Expired windows are dropped on each check; at `maxKeys` (default 1000) the oldest counter is evicted, so memory is bounded (an evicted tenant starts a fresh window). Applied to recovery: `RECOVERY_LIMIT` = 10 per `RECOVERY_WINDOW_MS` = 60 s, per owner workspace or per admin id (AMP-162). It runs after the permission check (so a refused stranger cannot use up anyone's quota) and before the existence check (so it cannot reveal whether a workspace exists). A clock that goes backwards keeps the current window and quota (retry-after is capped at the window length). A fixed window allows a burst across a window edge (up to twice the limit). The counter is per process.

## NOT built in this slice

- Connection secrets, a support queue, backups and restore (infrastructure, not app code).
- Tenant export and deletion: they live in `lib/aimp/account`; slice 2 is AMP-157.
- Any admin route or screen; nothing in the app calls this library.
- Any persistent (database) audit store, recovery store or shared limiter; no migration. The fixtures are single-process memory.
- Who counts as an admin is an OPEN DECISION. The library takes the actor as an argument and trusts it; the caller must build it from a verified server session.
- Cancel, pause or resume of jobs, recovery of stuck jobs, bulk recovery.

## Before a real store (known gaps)

- Per-process limits (stated, not changed): the in-flight guard, the recovered record and the rate limiter live in one process's memory. Two servers do not share them. With a database job store, `retry` must be atomic (a conditional update from `failed` only), the recovered record must be stored with it, and the limiter must be shared; otherwise two servers can both pass the checks and the quota is per server.
- The `workspaceExists` check and the recovery are not one atomic step: a workspace deleted in between could still get one entry. A real store should enforce this with a foreign key.
- AMP-163: `listProblemJobs` for an admin on a workspace that does not exist returns `ok` with empty `failed` and `stuck` and an audit id (entry in the unattributed list), the same as an existing workspace with no problem jobs. `readAudit` for an admin uses the existence answer: a missing workspace returns `ok` with `entries: []` and the audit store is not read; a lookup that throws is still `unavailable`. An owner naming a missing workspace still gets `job_not_found`. Orders page: a flag that cannot be read is shown as test (decided, not "unknown"), one store read per order.
- AMP-163 accepted difference: a workspace lookup that throws gives an admin `unavailable` from both `listProblemJobs` and `readAudit` (an outage is never shown as an empty list). The direct answers of `listProblemJobs` and `readAudit` are the same for a missing workspace and an existing empty one. A platform admin can still tell them apart indirectly: after an admin list, the audit history of a real workspace gains a `job.list` row and a missing one does not (its entry goes to the unattributed list, never under a tenant id), and when the unattributed list is full a missing workspace answers `unavailable` while an existing one answers `ok`. This is accepted because admins are platform operators who can already list workspaces. Owners can never tell, because they only reach their own workspace.
- Admin existence leak: CLOSED in AMP-162 (limiter keyed by admin id before the existence check; audit id not returned on admin refusals). Remaining, smaller: an existing workspace whose job engine throws answers `unavailable` where a missing one answers `job_not_found`; `readAudit` for an existing workspace with entries differs from a missing one by its contents. Both need a real tenant list to hide and are only reachable by admins.
- Admin audit reads (`readAudit`) are not themselves audited (writing an entry per read would also make every existing workspace's history non-empty, revealing it). Revisit when who counts as an admin is decided.
- The memory audit store is unbounded per workspace (append-only on purpose); retention is an owner decision.

## Owner candidates

Who is a platform admin and how that is verified; audit retention period; whether stuck jobs need a manual recovery path.

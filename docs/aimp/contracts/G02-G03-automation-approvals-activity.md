# G02, G03, G04, G08: automation settings, approvals, activity feed, usage caps

Status: **built on in-memory stores, Local evidence.** Database stores and the real merchant screens are not built.
Written 14 Nov 2026 for AMP-061 with the `amp-feature-contract` steps. Code: `apps/web/lib/aimp/automation/`.

## Feature

| Item | Value |
| --- | --- |
| IDs | G02 automation permissions and approval centre, G03 activity and notification centre (activity feed only; notification preferences and outbound alerts are not built), G04 failure recovery visibility, G08 AI usage guardrails (generation allowance only; money cost estimates are not built) |
| Release tier | First release |
| Board task | AMP-061 |
| Frontend owner | `ventra-frontend` (merchant screen not built; the isolated page below uses plain markup) |
| Backend owner | this module |

## Screen

| Item | Value |
| --- | --- |
| Name | Automation, approvals and activity |
| Route | none in the merchant app yet. Isolated test page: `/tools/aimp-automation` |
| App surface | Growth (settings, approvals) and Home (activity, "needs you" count) |
| Figma frame | none yet |
| Actor | the business owner |
| Stage | after the first build, ongoing |
| Primary action | Approve or reject a waiting action; pause marketing |
| Accessibility | buttons at least 44px, status shown as words not colour, every list has an empty text |

## Read model

All reads take an `OperationContext` (`lib/aimp/contracts.ts`) with `workspaceId` AND `businessId` (both required here).
Every record is keyed by both; another business, even in the same workspace, sees nothing and gets `not_found`.

| Read | Type (path: name) | Notes |
| --- | --- | --- |
| Settings | `lib/aimp/automation/types.ts`: `AutomationSettings` | `modes` per area (`marketing`, `product-generation`, `publishing`), each `automatic`, `owner_approval` or `paused`; plus `usage`. Defaults: marketing `owner_approval`, product-generation `automatic`, publishing `owner_approval` |
| Usage | `UsageSummary` | `used`, `limit`, `remaining`, `periodKey` (UTC calendar month `YYYY-MM`), `resetsAt` (epoch ms), `reached` |
| Approvals | `ApprovalView` | `id`, `area`, `kind`, `description` (plain text, secrets removed), `status`, `requestedAt`, `expiresAt`, `decidedAt`, `jobId`. The job input is never returned |
| Activity | `ActivityFeed` / `ActivityEntry` | newest first. `status` reuses `JobStatus` and `AutomationStatus` values (no new enum), `label`, `title`, `detail`, `needsOwner`, `nextAction`, `nextRetryAt`, `at` |

Approval `status`: `pending`, `approved`, `rejected`, `expired`. This is a decision record, not a job state.

## Mutations

All re-check scope and mode at execution time inside the service; nothing trusts the screen.

| Mutation | Input | Result | Idempotency | Owner confirmation |
| --- | --- | --- | --- | --- |
| `setMode(ctx, area, mode)` | area, mode | settings; activity entry | repeating the same mode records nothing new | is the owner action itself |
| `setCap(ctx, limit)` | whole number 0 to 100000 | settings; activity entry | same value is a no-op | is the owner action itself |
| `start(ctx, {kind, input, description})` | a registered job kind | `started`, `needs_approval`, `already_decided` (`decision`: rejected or expired), `paused` or `cap_reached` | `ctx.idempotencyKey`: the same key returns the same job or approval; the same key with different input is `conflict` | per mode |
| `retryJob(ctx, jobId)` | a failed job id of this business | `{ jobId, jobStatus, message }`; activity entry | a job that is not failed is `conflict` | is the owner action itself |
| `decide(ctx, approvalId, 'approve' or 'reject')` | approval id | the approval, `ran`, `alreadyDecided` | a repeated approve (or reject) returns `alreadyDecided: true` and never enqueues again; the job key is `approval-<id>` | is the owner action itself |

Rules:
- `paused` for an area stops NEW jobs of that area from being started AND holds work already scheduled: `setMode(area, 'paused')`
  pauses this business's `queued`, `waiting-retry` and `running` jobs of that area through `JobService.pause(ctx, id, businessId)`.
  A running job is paused too: the job engine's pause (`jobs/store.ts` `pause`) takes the lease and resets the in-flight step, so
  that step's late result is discarded at settle (`lost-lease`) and the step re-runs on resume under the same step key
  (`<jobId>:<step>`); handlers are idempotent on that key, so its effect happens once. No later step runs while the area is paused.
  Finished, failed or cancelled jobs are not touched. The module remembers which job ids it paused; leaving paused (to automatic
  or owner_approval) resumes only those, and only if they are still paused. Another business's or another area's jobs
  are never touched; a job the owner paused separately is never resumed. Each pause and resume is an activity entry
  (`jobs-paused`, `jobs-resumed`). `setMode` with the mode it already has records no second `mode-changed` event but still re-runs
  the sweep (pause sweep for `paused`, resume sweep otherwise); both are idempotent, so a pause or resume that failed half way
  (store outage) is repaired by calling `setMode` again. `JobService.resume` keeps a future `nextRunAt` (a post scheduled for
  tomorrow and paused for an hour still runs tomorrow) and makes a past one due now. `fulfil-order` (delivery) is not in any area,
  so it is never gated, counted, paused or blocked. Every built-in job kind is in `AREA_FOR_KIND` or `UNGATED_KINDS` (a test enforces it).
- Cap slots: approving reserves the slot keyed by the approval before enqueueing. If the enqueue itself fails the approval goes back
  to pending and the slot is released; if the job was created and only the `jobId` write fails, the approval stays approved and the
  slot is kept. `start()` with the same key on an approved approval that has no `jobId` (crash recovery) reserves the slot too
  (refused with `cap_reached` when over the allowance), then returns the one job.
- A request key that already has an approval keeps its fate, whatever the mode is now: pending returns the same `needs_approval`;
  approved returns its one job; rejected or expired returns `already_decided` (names the decision, creates nothing, never says
  "waiting"), so a rejected key can never run unapproved after a switch to automatic.
- If the key already started a job (for example under automatic) and is re-sent under `owner_approval`, `start` answers
  `started` with `created: false` and that job; no approval is created, so the work cannot run twice. Same key with different input is `conflict`.
- `retryJob(ctx, jobId)` retries a failed job of this business via `JobService.retry(ctx, id, businessId)`; completed steps are not
  repeated. Another business's or an unknown job answers `not_found`; a job that is not failed answers `conflict`. Recorded as `job-retried`.
- Approval status changes are compare-and-set (`AutomationStore.transitionApproval(scope, id, from, to)`): approve, reject and expiry
  each only succeed from the expected status, so an expiry can never overwrite an approve, and the loser of a race answers
  `alreadyDecided` (same decision) or `conflict` (opposite decision), or `expired`.
- Event ids carry a per-business sequence (`AutomationStore.nextSequence`), so two changes in the same millisecond are both kept.
- `owner_approval` records a pending approval and starts nothing. Approving enqueues once. Rejected and expired approvals never run.
- Approving while the area is `paused` or the cap is reached is refused (`blocked`), and the approval stays pending.
- Pending approvals expire after 24 hours (checked on every read and decision).
- Only `generate-product` counts against the cap. The cap is reserved before the job is enqueued (so two parallel starts cannot
  both take the last slot) and released if the enqueue fails. A repeated key is never counted twice. A generation that is
  accepted but later fails (even permanently) keeps its slot for the period; it is not released. Retrying it does not take a second slot.
- Request keys are up to 99 characters and are namespaced by business before reaching the job engine, whose keys are unique per
  workspace and kind only (two businesses in one workspace would otherwise be handed each other's job).
- Errors use `AutomationError` codes `invalid`, `not_found`, `conflict`, `blocked`, `expired`.

## Workflow and events

- Producer: `start` and `decide` (the only paths into `JobService.enqueue` for gated kinds). Consumer: the existing job runner.
- Persisted events (`AutomationEvent`, schema version 1): `mode-changed`, `cap-changed`, `approval-requested`,
  `approval-approved`, `approval-rejected`, `approval-expired`, `blocked-paused`, `blocked-cap`, `jobs-paused`, `jobs-resumed`, `job-retried`. Each carries workspace id,
  business id, a stable id (repeats do not add rows) and a time.
- Job rows come from `JobService.list`, filtered to the business. No new job state is created.
- Trace id: not built (the job engine has none yet). Action key: the idempotency key.

## States

"Waiting for owner" (CANONICAL_STATES decision 1): **no job exists until the owner approves.** The waiting action is an
approval record, shown as `needs_approval` ("Needs you"). A job is never put in `paused` for this, and no job status is added.

| State | Label | Action or explanation |
| --- | --- | --- |
| loading | Loading | page text only |
| empty | "Nothing has happened yet." / "Nothing is waiting for you." | none |
| `needs_approval` | Needs you | Approve or Reject |
| `queued` | Queued | "Waiting to start" |
| `running` | Building | none |
| `waiting-retry` | Retrying | next retry time shown, no action needed |
| `failed` | Failed | safe reason plus "Choose Retry." (a Retry button calls `retryJob`) |
| `paused` | Paused | mode paused (scheduled work held until the area is switched back on) or cap reached, with how to resume |
| `succeeded` | Complete | none |
| `cancelled` | Cancelled | rejected or expired approvals show here with their own wording |

## Fixtures and errors

Fixture/demo module: `lib/aimp/automation/demo.ts` (real service on the in-memory job engine with fixture providers, cap of 3 per month).

| Case | Customer-safe message |
| --- | --- |
| success | "Started." |
| no data | empty-state text above |
| waiting | "This is waiting for your approval. Nothing has been started." |
| retry | "Tried again; next try at <time>." |
| cap reached | "You have used all <n> AI generations for this month. New generation is paused until <date>. Orders and deliveries are not affected." |
| paused area | "<Area> is paused, so this was not started. Deliveries are unchanged." |
| expired | "This request expired and was not run. Ask for it again." |
| key already rejected | "This request was rejected, so it was not run. Ask again as a new request if you still want it." |
| key already expired (start) | "This request expired and was not run. Ask again as a new request if you still want it." |
| forbidden / other business | "Approval not found." (same as a missing id; nothing leaks) |

Operational detail (provider payloads, keys, paths) never reaches a message; `safeText` from the job engine is applied to every stored text.

## Acceptance scenario

1. Open `/tools/aimp-automation`. See DEMO and the connection states.
2. Set marketing to Paused. Start a marketing post: refused with the paused message and an activity entry. Already scheduled posts show as Paused and do not run. Start a delivery: it still runs. Switch marketing back on: only the posts that pausing held are resumed.
3. Set publishing to Owner approval. Start a publish: a pending approval with a description appears and no job exists.
4. Approve it: one job starts; approve again: "already approved", still one job. Reject another: it never runs.
5. Start product generations until the cap (3): the next is refused with the safe message and an activity entry; delivery still runs.
6. Run due jobs. The activity feed shows what ran, what failed or was retried and what waits for you, newest first.
7. "Switch to another business" shows none of the above.

Test route: `/tools/aimp-automation`. Test files: `apps/web/test/aimp-automation-*.test.ts`. Evidence level: Local.

## Open decisions

- This module assumes CANONICAL_STATES decision 1 = "no job exists until approval; the wait is an approval record shown as
  `needs_approval`", pending owner sign-off in `docs/aimp/contracts/CANONICAL_STATES.md`. If the decision goes the other way
  (a job in a waiting state), `start` and `decide` change.

## Dependencies and current blocker

- Builds on `lib/aimp/jobs` (service, runner, statuses) and `lib/aimp/providers` (status labels).
- Not built: database stores (proposed SQL in the AMP-061 report), a merchant screen, notification preferences and outbound
  alerts (G03), monetary cost estimates and plan entitlements (G08), a trace id, a runner-level usage guard that knows the
  business (the runner guard receives only workspace and job id). Marketing post jobs (`scheduled-post`) are the only marketing kind today.

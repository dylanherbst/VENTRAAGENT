# VENTRA scope freeze (2026-11-06)

Source: Ventra Pivot Master Plan and Implementation Tracker (owner, 2026-11-06).

VENTRA narrows to one thing: an AI front office that turns conversations into booked, closed and retained
customers. Three agents on one pipeline: AI Setter, AI Sales, AI Receptionist, plus the plumbing they share.

## What is active

| Area | Status |
| --- | --- |
| Front office: orchestrator, lead store, handoff contract, channels (`/api/front-office/*`) | Build |
| Contacts, deals, lead forms, lead scoring, follow-ups, appointments (booking availability) | Active (they feed the pipeline) |
| Account, workspace, team, notifications, integrations status, export, search, activity | Active (shared plumbing) |
| Everything else | Frozen. See `PARKED.md` |

## How the freeze is enforced (backend)

- `apps/web/lib/scope-freeze.ts` is the single list of what is active.
- Frozen API routes answer `423 feature_paused` before doing any work (no reads, no writes, no AI or payment calls).
  The Stripe webhook answers `503 feature_paused` so Stripe retries instead of dropping an event.
- Frozen launcher draft kinds are refused by `/api/workspace/launcher` with `423 feature_paused`.
  Existing saved data is not touched or deleted. Browser drafts are unchanged.
- Owner override for local debugging only: `VENTRA_SCOPE_FREEZE=off`. Never set it in production.

## Rules for saying no

A request is built only if (1) a lead needs it to move from first touch to booked, closed or supported, or
(2) a paying customer cannot go live without it. Everything else gets a line in `PARKED.md` with a date and a
reason, and the reply "after the pipeline is live". Bugs in frozen features get a workaround, not a fix,
unless they lose data or money.

The freeze lifts per item only when the pipeline passes the Phase 4 gate (3 clients live on one pipeline).

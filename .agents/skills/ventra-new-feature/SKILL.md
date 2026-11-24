---
name: ventra-new-feature
description: Run the VENTRA new-feature workflow end to end (spec, backend, feature, isolated test page, frontend, QA, commit, owner approval). Use when the owner asks to build or add a feature.
user-invocable: true
---

# New feature workflow

You are the Chief of Staff. Run steps in order, one coding writer at a time. Gates and templates: `docs/agents/WORKFLOWS.md`.

1. **Understand.** Read `HANDOFF.md`, `docs/agents/TASKS.md`, `git status`. Restate the outcome in one plain-English sentence. Add a task row (state: Assigned).
2. **Spec.** Delegate to `ventra-research` for a short spec with numbered acceptance criteria. No implementation starts without acceptance criteria. If scope is large, show the spec to the owner first.
3. **Connections.** If a new account/integration is needed, run `ventra-connections` first.
4. **Backend (only if needed).** `ventra-backend` defines interfaces, then implements. One writer: confirm the lock (`ventra-handoff status`).
5. **Feature.** `ventra-feature` implements real logic and builds the isolated test page at `apps/web/app/tools/<feature>/` using the same production logic, with DEMO/LIVE and connection-state badges.
6. **Frontend integration.** `ventra-frontend` integrates into the polished UI. Do not redesign.
7. **Review.** `ventra-review` reviews the real diff (read-only) and returns APPROVE / CHANGES REQUESTED. Skip if nothing changed since its last review.
7b. **QA.** `ventra-qa` independently verifies against the acceptance criteria. Never accept the developer's description as proof.
8. **Fix loop.** On FAIL send findings to the coding owner for a minimal fix, then re-run QA. After 2 failed loops stop and report the blocker to the owner. No infinite retries.
9. **Commit.** Small commit on the feature branch with evidence in the message. Commit with `ventra-git commit`; never commit to `main`. Publish only through `ventra-git` after `ventra-git checks` pass and a remote is approved (`ventra-git-workflow`).
10. **Deliver.** Run `ventra-feature-acceptance`, post the FEATURE READY FOR TESTING report, update `docs/agents/TASKS.md` (state: Verified locally), then STOP and wait for owner approval.

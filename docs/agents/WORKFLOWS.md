# VENTRA workflows and quality gates

Each workflow is also a skill in `.claude/skills/` (`/ventra-new-feature` etc.). One coding writer at a time. Use the fewest agents needed.

## 1. New feature (`ventra-new-feature`)
Request → Chief of Staff → Research/Spec → Backend (if needed) → Feature Engineer → Isolated test UI → Frontend integration → QA → Git commit → Owner approval.
Gate: written acceptance criteria before any code. Max 2 fix loops, then escalate.
Commit and push are automatic through `ventra-git` once the checks pass. A merge to `main` or a production release goes through `ventra-approval` (see `AUTOMATION_POLICY.md`).

## 2. UI design (`ventra-ui-design`)
Owner reference → Frontend → component audit → responsive build → visual comparison → QA → screenshot/preview → Owner approval.
Gate: no redesign unless asked; reuse existing components.

## 3. Bug fix (`ventra-bug-fix`)
Report → reproduce → responsible agent → minimal fix → regression test → QA → verified report.
Gate: cannot reproduce = ask, don't guess.

## 4. Connections (`ventra-connections`)
Request → Setup specialist → requirements → owner approves accounts/permissions → Backend → connection test → QA → status.
Gate: only the owner creates accounts, spends money or grants permissions.

## 5. Daily overview (`ventra-daily-overview`)
Read live Git, task register and recorded results. Report completed, in progress, blocked, tested, needs approval, next task. No invented percentages; stale data is labelled stale.

## 6. Claude ↔ Codex handoff (`ventra-codex-handoff`, rules in `CODEX_HANDOFF.md`)
Stop Claude → write task + criteria → `ventra-handoff snapshot` → exit Claude (lock released) → `ventra-codex` → Codex inspects before editing → Codex continues only the approved task → updates `HANDOFF.md` → exits → Claude may resume.

## 7. Feature acceptance (`ventra-feature-acceptance`)
Ready only when: real functionality, isolated test page works, relevant tests pass, persistence verified, browser preview checked, Git evidence recorded, known issues disclosed. Then the report below, then STOP.

```
FEATURE READY FOR TESTING
Feature:
Implemented:
Test page URL:
How I can test it:
Tests passed/failed:
Git branch and commit:
Remaining issues:
Approval required:
```

## Quality gates (all coding work)

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (and the matching browser/integration test) run by QA, not only by the developer.
- A passing build alone is not product readiness.
- Evidence = command + result seen this session. Descriptions are not evidence.
- Every feature has an isolated test page using the real production logic with DEMO/LIVE and connection-state badges.
- This Next.js has breaking changes: coding agents read `apps/web/node_modules/next/dist/docs/` first.

## Failure rules

- Permission denied or tool missing: stop, report BLOCKED once, continue independent work. No retry loops.
- No agent writes only a plan and calls it implementation.
- No claim about Telegram, Codex or a running process without checking it now.

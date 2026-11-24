# VENTRA AI operating system (Stage 3), checked 2026-11-03

## Roles

| Stage 3 role | Implemented as | Writes code | Notes |
| --- | --- | --- | --- |
| Coordinator | Main session (Chief of Staff, `CLAUDE.md`) | no | Plans, delegates, records in `TASKS.md`. Subagents cannot spawn subagents, so the Coordinator must be the main session. |
| Frontend | `ventra-frontend` | yes | Uses `docs/DESIGN.md`; design plugins on demand |
| Backend | `ventra-backend` | yes | |
| Feature | `ventra-feature` | yes | Builds the isolated test page |
| Testing | `ventra-qa` | no | Runs lint, typecheck, tests, build, browser checks |
| Code Review | `ventra-review` | no | Reviews the real diff before QA |
| Research | `ventra-research` | no | Spec and acceptance criteria |
| DevOps | `ventra-devops` | no | Health, backups, CI check, audits, release review; never deploys |
| Connections | `ventra-setup` | limited | Extra role from Stage 2 |

Concurrency on this 8 GB Mac: one writing agent plus at most one read-only helper. One writer per worktree (`ventra-handoff` lock). Use a separate worktree (`ventra-git branch`) only when two writers are truly needed; raise the limit only after measuring (dashboard System checks: CPU, memory, disk).

## Already in place before Stage 3 (kept unchanged)

Bash and edit guard hooks, `ventra-git`, approval inbox with macOS authentication, Codex handoff, Telegram bridge, Agent Dashboard dashboard (agents, workflows, jobs, schedules, approvals, Codex), plugin set (`PLUGINS.md`). See `AUTOMATION_POLICY.md`.

## Added in Stage 3

- Agents `ventra-review`, `ventra-devops`.
- `ventra-backup create|verify|list`: git bundle (all branches and history) plus a secret-free file archive into `~/Backups/ventra` (mode 700, never overwritten). `verify` restores the newest bundle into a temp clone and checks the commit.
- Dashboard System checks now show CPU load, memory free, disk free and running Next.js dev servers (real values).
- `ventra-statusline`: model, branch and CPU load for the Claude Code status line.

## Test pipeline and retry rule

`ventra-verify` runs the whole gate in about 30 to 60 seconds: lint, typecheck, unit tests, production build, and (only if local Supabase answers on port 55321) the workspace and course account integration tests. Skipped steps are recorded as SKIPPED with the reason, never as passed. The result is saved to `~/.ventra-dashboard/last-verify.json` and shown in the dashboard's Test results card. A daily 6:30 PM scheduled task for it was proposed but the auto-mode classifier denied creating it; create it in the Claude Desktop Scheduled section if wanted.

Required gate for every task: `npm run lint`, `typecheck`, `test`, `build`, then `ventra-git checks`. Also run the changed feature's `apps/web/test/<feature>-browser.mjs` (Playwright, 375 px and desktop) instead of all of them. A coding agent may repair a routine failure at most 3 times; then record BLOCKED in `HANDOFF.md` and stop that task. Failures are never hidden and gates are never skipped.

## Recovery from an interrupted task

1. `ventra-handoff status`, `git status`, read `HANDOFF.md`.
2. `ventra-handoff recover` only if the lock holder is gone.
3. Restore files from `ventra-backup`: `git clone ~/Backups/ventra/<name>.bundle /tmp/restore` (history) or extract the `.files.tar.gz` (working files). Never restore over a live worktree without the owner.

## Remote access

Official Claude Code Remote Control, started with `ventra-remote` (runs `claude remote-control --name ventra --capacity 1 --permission-mode default` in the VENTRA repo). Authentication is your claude.ai login (checked: signed in). The Mac makes an outbound connection only; no public ports. Open the Code tab in the Claude mobile app or claude.ai/code and choose "ventra". Tested 2026-11-03: the command starts and asks "Enable Remote Control? (y/n)"; you must answer `y` yourself, so a phone connection was not tested.

Restrictions: it runs only while that Terminal window is open and the Mac is awake (use `caffeinate -i`); it is not unattended or a background service. Sessions run in the VENTRA repo, so hooks, deny rules and approval gates still apply. Approvals still require macOS authentication on the Mac, not the phone.

Telegram: the official `telegram` plugin from `claude-plugins-official` is already in use via `ventra-claude` (allowlist-only, pairing closed). It can send tasks and status to the running session; it cannot approve production actions. No third-party bridge was installed.

## Scheduled work (Claude Desktop scheduled tasks, Australia/Perth because this Mac's timezone is Perth)

| Task id | Schedule | Purpose |
| --- | --- | --- |
| `ventra-morning-production-report` | weekdays 08:00 | progress, blockers, top 3 tasks, next action |
| `ventra-development-health-check` | daily 19:00 | repo, CI, machine health, uncommitted work |
| `ventra-weekly-code-review` | Monday 09:00 | changed-code review, `npm audit`/`outdated` report only |
| `ventra-backup-recovery-audit` | Friday 17:00 | `ventra-backup create` + `verify`, git fsck, recovery docs |

All are read-only (the backup task only adds a new backup), each ends with a phone/desktop notification. They run only while Claude Desktop is open and the Mac is awake; a missed run executes on next launch. Dispatch is delayed by a few minutes (load balancing). Manage them in the app's Scheduled section. Dashboard schedules (`Agent Dashboard`) are separate and unused.

## Workflows

`/ventra-new-feature` (research, plan, code, test, fix, review, commit), `/ventra-ui-design` (frontend), `/ventra-backend-dev` (API, database, auth, integration tests, security review), `/ventra-recovery` (detect, diagnose, fix, retest, report; 3 attempts), `/ventra-git-workflow` (branch, test, commit, publish, draft PR; publishing is blocked until a remote is approved).

## Token rules for automation

Scheduled tasks read only git facts and recorded results, skip when nothing changed, and never run full suites. Specialist agents run only when a workflow calls them; no repeated reviews without new changes. Serena for symbol lookup; Context Mode stays off (measured no saving, see `PLUGINS.md`). The dashboard shows no token usage because Claude Code exposes none to it; use `/context` and `/usage` in the session.

## Codex fallback

`codex` CLI 0.166.0 is installed and signed in with ChatGPT (subscription sign-in, not an API key). Handoff: `/ventra-codex-handoff`. Last known limit: retry after Nov 4 2:48 PM. API billing is never used without your explicit permission.

## Limits

- The dashboard is a zero-dependency Node and plain JavaScript app, not React and TypeScript. It was kept to preserve its tested security model (77 tests) and low memory use on an 8 GB Mac; rewriting it is possible on request.
- Dashboard repo `VENTRA-DASHBOARD` is not an approved repository for `ventra-git`; only the owner can add it to `~/.ventra-dashboard/git-policy.json`.
- Production protection on GitHub is unavailable for this private repo on the free plan (`GITHUB_PROTECTION.md`).

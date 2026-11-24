# VENTRA agent architecture

Rebuilt natively for Claude Code. The old OpenClaw design is not used. Its separation of duties, one-writer rule, state vocabulary and approval boundaries are kept.

## Shape

```
Owner (you) ── Claude Desktop / terminal / Telegram
      │
Chief of Staff = the main Claude Code session (CLAUDE.md)
      │  launches only what a task needs, one coding writer at a time
 ┌────┴───────────┬───────────────┬──────────────┐
 research (RO)  setup (RO+docs)  qa (RO)    coding owner (ONE at a time):
                                            frontend | feature | backend
Backup coder: OpenAI Codex (separate CLI, same repo, same lock)
```

Agents are definitions, not running processes. Nothing runs in the background. Default is sequential work.

## Roles

| Agent | File | Edits files? | Owns |
| --- | --- | --- | --- |
| Chief of Staff | main session, `CLAUDE.md` | only docs/task register | planning, delegation, status, approvals |
| Frontend UI/UX | `.claude/agents/ventra-frontend.md` | yes, when current owner | `apps/web/app/ui`, `design-system`, `(ventra)` layouts, styles |
| Feature Engineer | `ventra-feature.md` | yes, when current owner | `apps/web/lib/**` (not supabase), `app/tools/<feature>/` test pages |
| Backend & Integrations | `ventra-backend.md` | yes, when current owner | `supabase/`, `app/api`, `lib/supabase`, `*-api-contract.ts`, integration scripts |
| Research & Architect | `ventra-research.md` | no (read-only, web) | specs and acceptance criteria |
| Connections & Setup | `ventra-setup.md` | only `docs/agents/STATUS.md` | integration status and beginner setup steps |
| QA, Review, Security | `ventra-qa.md` | no (read-only + test commands) | independent verification |
| Codex (backup) | external CLI | yes, only when it holds the lock | continues the approved task from `HANDOFF.md` |

## Concurrency rules

1. One coding writer in `VENTRA-FEATURES` at a time. Claude and Codex share one lock (`ventra-handoff`).
2. A second agent may run only if read-only (research or QA).
3. Agent Teams (experimental) stay off. 8 GB Mac: no parallel farms.
4. Specialists have distinct ownership paths. If a task needs another owner's files, go through the Chief of Staff.
5. Never launch duplicate workers or interrupt protected work to look faster.

## Enforcement (not just instructions)

- `.claude/settings.json` hook `scripts/agents/guard-edit.sh` blocks edits to `VENTRA-CLEAN`, `~/.openclaw`, `.env*`/keys, and any edit while Codex holds the lock.
- Deny rules block reading `.env` files and OpenClaw paths.
- Read-only agents have no Edit/Write tools.
- Limit: the hook covers Edit/Write, not arbitrary shell commands. Shell commands still go through normal permission prompts (`rm`, `git push`, `git reset`, `sudo`, deploys always ask).

## Task states (never merge these)

Assigned → Running → Implemented → Verified locally → Accepted by review → Approved for release → Deployed

"Implemented" is a developer claim. "Verified locally" needs QA evidence. "Accepted by review" and later need the owner.

## Repositories

`VENTRA-FEATURES`, `VENTRA-CLEAN` (`main`, protected), `VENTRA-UI`, `VENTRA-BACKEND` and one `VENTRA-FEATURE-course-editor-*` folder are linked Git worktrees of one repository (checked with `git worktree list`). They share history; branches are separate. There is no Git remote.

## Approval required (always)

Production or destructive data changes, deleting files, paid services or spending, account creation, external publishing, deployment, credential changes, `git push`, merging to `main`.

## Secrets

No tokens, passwords or keys in agent files, docs, task register, Git or Telegram. Telegram bot token lives in `~/.claude/channels/telegram/.env` (mode 600).

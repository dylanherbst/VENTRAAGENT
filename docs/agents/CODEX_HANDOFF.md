# Codex backup coder: handoff rules and template

Codex is a separate app/CLI. It does not run inside Claude Desktop and does not replace Claude there. Switching is manual and takes about a minute.

## Commands

| Command | Does |
| --- | --- |
| `ventra-handoff status` | who holds the lock, branch, HEAD, uncommitted count |
| `ventra-handoff snapshot` | writes Git evidence into `HANDOFF.md` |
| `ventra-codex` | takes the lock, snapshots, opens Codex told to inspect `HANDOFF.md` first |
| `ventra-claude` | takes the lock, starts Claude with Telegram |
| `ventra-handoff recover` | removes a stale lock safely |

Install or refresh commands: `bash scripts/agents/install.sh`.

## Procedure

1. Claude stops coding, fills `HANDOFF.md` (task, acceptance criteria, tests, blockers, next steps) and runs `ventra-handoff snapshot`.
2. Exit Claude. Its lock is released automatically.
3. Run `ventra-codex`. If it says BLOCKED, the other side still holds the lock.
4. Codex reads `AGENTS.md`, `HANDOFF.md`, runs `git status`, compares, then continues ONLY the approved task.
5. Codex updates `HANDOFF.md` before exiting. Lock is released on exit.
6. Start `ventra-claude`; Claude reads `HANDOFF.md` first.

## Lock rules

- Lock file: `<git dir>/ventra-agent.lock` (inside `.git`, never committed). Format: `owner pid epoch`.
- Owner is the wrapper script's process. A lock whose process is dead is stale and is reclaimed automatically on the next `acquire`.
- Claude's edit hook blocks edits while a live Codex lock exists.
- Recovery: `ventra-handoff recover`. If the process is alive but the session is truly gone (over 12 h): `ventra-handoff release --force`. Never force a lock while its session is working.
- Sessions started outside `ventra-claude` (e.g. Desktop app) do not take the lock; the hook still stops them editing while Codex holds it.

## Codex limits

Codex needs your ChatGPT subscription limit. When it is exhausted it cannot continue. Check with `codex login status` (login only; it does not show remaining usage).

## HANDOFF.md template

```
# VENTRA handoff
Updated / Last editor:
## Current task (approved scope only)
## Acceptance criteria
## Git state (auto)   <- ventra-handoff snapshot
## Changed files and why
## Tests run and results (command, result)
## Blockers
## Next steps (ordered)
## Do not touch
```

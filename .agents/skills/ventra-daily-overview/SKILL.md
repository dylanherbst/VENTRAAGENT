---
name: ventra-daily-overview
description: Produce the VENTRA daily project overview from the real repository, Git state, task register and test results. Use when the owner asks for status, progress, or what to do next.
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git branch *)
  - Bash(git diff *)
  - Bash(git worktree list)
  - Bash(ventra-handoff status)
---

# Daily overview

Read live sources only; never report from memory or old documents as current. Sources: `git status`, `git log -10`, `git worktree list`, `ventra-handoff status`, `HANDOFF.md`, `docs/agents/TASKS.md`, `docs/agents/STATUS.md`. Do not run tests just to fill the report; report the last recorded result with its date, or "not run".

Output, plain English, short:
- **Completed** (with commit hashes)
- **In progress** (owner, branch)
- **Blocked** (what, who can unblock)
- **Tested** (command, result, date) and **not tested**
- **Needs your approval**
- **Next recommended task** (one)

No invented percentages. If a source is missing or stale, say so.

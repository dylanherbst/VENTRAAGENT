---
name: ventra-codex-handoff
description: Hand the current approved coding task from Claude to Codex (or back) using the shared handoff file and one-writer lock. Use when Claude is near its usage limit or the owner asks to switch to Codex.
user-invocable: true
---

# Claude to Codex handoff

Full rules and recovery: `docs/agents/CODEX_HANDOFF.md`.

1. **Stop coding.** Finish or revert the current edit. No agent is mid-change.
2. **Write the task.** In `HANDOFF.md` fill: Current task, acceptance criteria, owner-approved scope, tests run and results, blockers, next steps.
3. **Record Git evidence.** Run `ventra-handoff snapshot` (writes branch, HEAD, uncommitted files, diff stat). Commit work that is verified; otherwise list it as uncommitted.
4. **Tell the owner** to exit this Claude session (this releases the lock), then run `ventra-codex`. It takes the lock, snapshots again, and opens Codex told to inspect `HANDOFF.md` and `git status` before changing anything.
5. **Codex works** only on the approved task and updates `HANDOFF.md` when done.
6. **Resume.** After Codex exits (lock released) the owner starts `ventra-claude`; read `HANDOFF.md` first.

If a lock seems stuck: `ventra-handoff recover`. Never force a live lock.

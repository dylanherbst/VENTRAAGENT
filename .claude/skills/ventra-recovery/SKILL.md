---
name: ventra-recovery
description: Run the VENTRA automated recovery loop (detect failure, diagnose, attempt safe fix, retest, report). Use when lint, typecheck, tests, build or a dev server fails, or a task was interrupted.
user-invocable: true
---

# Automated recovery

1. **Detect.** Capture the exact failing command and the first error lines only (not the whole log). For an interrupted task: `ventra-handoff status`, `git status`, `HANDOFF.md`.
2. **Diagnose.** Find the cause with a targeted search. Say whether it comes from the current change or was already failing (compare with `git log` and the recorded results).
3. **Safe fix.** Minimal edit by the owning agent inside its permitted files. Never touch the guard, policy, settings, secrets or `VENTRA-CLEAN`. No force operations, no deleting data, no major-version dependency upgrades.
4. **Retest.** Re-run only the failing check, then the required gate once at the end.
5. **Limit.** Maximum 3 attempts per failure. Do not repeat the same failed approach. After the third, stop, write the blocker and evidence in `HANDOFF.md`, and continue other independent work.
6. **Report.** One concise message: what failed, cause, what was changed, result, anything the owner must do. Never hide a failing test or lower a gate.
7. **Lost files or broken tree.** Restore from `ventra-backup` (see `docs/agents/OPERATING_SYSTEM.md`); never reset or clean without the owner.

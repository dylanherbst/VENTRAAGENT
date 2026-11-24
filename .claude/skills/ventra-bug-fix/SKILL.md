---
name: ventra-bug-fix
description: Run the VENTRA bug-fix workflow (reproduce, find the owner, minimal fix, regression test, QA, verified report). Use when the owner reports something broken.
user-invocable: true
---

# Bug-fix workflow

1. **Reproduce.** Get exact steps and expected vs actual. Reproduce it yourself (command, test or browser). If you cannot reproduce it, say so and ask; do not guess a fix.
2. **Owner.** Decide the responsible agent from `docs/agents/ARCHITECTURE.md` (UI to frontend, logic to feature, data/API/auth to backend). Confirm the lock is free.
3. **Minimal fix.** Smallest change that fixes the cause. No refactors, no unrelated cleanups.
4. **Regression test.** Add or extend a test that fails before and passes after.
5. **QA.** `ventra-qa` re-runs the reproduction, the new test and the related existing tests.
6. **Report.** Cause, fix, files changed, test results (commands and outcomes), commit hash. Mark task Verified locally in `docs/agents/TASKS.md`.

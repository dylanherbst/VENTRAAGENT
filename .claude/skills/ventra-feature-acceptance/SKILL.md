---
name: ventra-feature-acceptance
description: Check a VENTRA feature against the acceptance gate and produce the FEATURE READY FOR TESTING report. Use before telling the owner a feature is ready.
user-invocable: true
---

# Feature acceptance gate

A feature is ready only if ALL are true, each backed by evidence you saw this session:
- Real functionality implemented (not a mock).
- Isolated test page works at `apps/web/app/tools/<feature>/`.
- Relevant tests pass (commands and exit results).
- Persistence verified where applicable (reload/round trip).
- Browser preview checked.
- Git evidence recorded (branch, commit).
- Known issues disclosed.

If any item is missing, say NOT READY and list it. Never fill a field from the developer's claim alone.

Then output exactly:

FEATURE READY FOR TESTING
Feature:
Implemented:
Test page URL:
How I can test it:
Tests passed/failed:
Git branch and commit:
Remaining issues:
Approval required:

Stop after delivering the milestone. Do not start the next task.

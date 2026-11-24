---
name: ventra-git-workflow
description: Run the VENTRA Git workflow (develop, test, commit, publish to an authorised development branch, draft PR). Use when work is ready to save or share.
user-invocable: true
---

# Git workflow

1. **Branch.** `ventra-git branch feature/<name>` (never `main`; names are checked).
2. **Test.** Lint, typecheck, tests, build for the changed area; `ventra-git checks` runs the required set for this exact commit.
3. **Commit.** `ventra-git commit -m "type(scope): summary" [paths]` with evidence in the body. Secrets are scanned and refused. Add the attribution trailer required by the session.
4. **Publish.** `ventra-git ci-check`, then `ventra-git push` (feature branches only, never forced, verified on the remote). It stays disabled until the owner approves a remote in the policy.
5. **Draft PR.** `ventra-git pr` with test results and the commit hash. Merging into `main` needs the owner through `ventra-approval`.
6. If a step is refused, record it once in `HANDOFF.md` and continue other work. Do not retry or route around it.

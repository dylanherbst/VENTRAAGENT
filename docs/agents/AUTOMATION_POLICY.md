# VENTRA automation and approval policy

Goal: agents finish routine development jobs without asking, and only production, financial, security-sensitive and destructive actions reach you. Everything below is enforced by code (hooks and tools), not only by instructions. Last checked 2026-11-03.

## What happens automatically

Reading and editing project code, creating components, features, tests and docs, running local servers, tests, lint, typecheck and builds, installing free dependencies from the npm registry, creating feature branches, committing, pushing feature branches, opening and updating **draft** pull requests, delegating to subagents, updating task records and handoff, preview deploys of an already linked Vercel project.

## What needs you

Merging into `main` or any protected branch, production deploys, production environment variables, production database migrations, changing live customer data, live authentication or payment settings, paid campaigns or customer messages, purchases or new paid services, infrastructure that creates cost, deleting projects or important databases.

## What is blocked outright

Force-pushing or deleting remote refs, rewriting history, pushing straight to a protected branch, reading or printing secrets, editing the guard, policy or settings, disabling bypass-mode protection, `curl | sh`, `rm -rf` on `/`, `~`, the project root or `.git`.

## How it is enforced

| Layer | What it does | Where |
| --- | --- | --- |
| **Bash guard hook** | Parses every shell command (compound commands, `bash -c`, `$(...)`, wrappers, heredocs) and blocks or asks. Fails closed on any internal error. Runs before permission rules, so a rule cannot override it. | `~/.local/share/ventra-agents/guard-bash.mjs` |
| **Edit guard hook** | Blocks edits to secrets, `VENTRA-CLEAN`, OpenClaw, the guard files, and any edit while on a protected branch or while Codex holds the lock. | `guard-edit.mjs` |
| **Permission rules** | Allow list for routine commands, deny list for dangerous ones, project default mode `auto`, bypass mode disabled for this project. | `.claude/settings.json` |
| **`ventra-git`** | The only way to branch, commit, push and open draft PRs. Pushes check: repository approved, branch not protected, remote approved, no deployment trigger, no secrets, no force, required checks pass on this exact commit, result verified on the remote. | `ventra-git` |
| **Approvals** | Production-class commands run only after you approve in the Command Center with macOS authentication. | `ventra-approval`, Command Center |
| **Safety policy** | Approved repositories and remotes, protected branches, required checks. Lives outside every repository. | `~/.ventra-dashboard/git-policy.json` |

Scripts are installed to `~/.local/share/ventra-agents` (outside any repo). After you change one in the repo, run `bash scripts/agents/install.sh`.

## Git workflow

```
ventra-git branch feature/my-change      # protected names and bad names are refused
# ...edit, test...
ventra-git commit -m "feat: ..."         # stages intended files, scans for secrets, records the commit
ventra-git checks                        # lint, typecheck, test, build for this exact commit
ventra-git ci-check                      # could a push here trigger a deployment?
ventra-git push [--dry-run]              # feature branch only, never forced, verified on the remote
ventra-git pr [--dry-run]                # DRAFT PR with the test results and commit hash
```

Pushing stays **disabled** until a remote is approved in the policy (see `GITHUB_PROTECTION.md`).

## Production approvals

1. The agent prepares a release review and runs `ventra-approval request --kind <kind> --title ... --env production --changed ... --tests ... --risks ... --rollback ... --financial ... -- <exact command>`.
2. It appears in the Command Center under **Approvals** with the exact command, branch, commit, environment and review. If Telegram is connected the agent also sends a notification. A notification is never an approval.
3. You choose **Approve** (macOS asks for Touch ID or your password), **Request changes**, or **Reject**.
4. The agent runs `ventra-approval run <id>`. The service re-checks that the commit and clean tree still match, hands out the exact command once, and records the result. Any change after approval means a new request.

An approval is bound to the exact command, repository, branch, commit, working folder and environment, expires (default 2 hours) and cannot be reused.

## Honest limits

- The local guard stops mistakes, prompt injection and ordinary agent behavior. It is **not** a sandbox against a determined program running as you: Bash rules in Claude Code are explicitly "not a security boundary". The independent boundary has to be GitHub (branch protection, approval environments). **GitHub does not offer those for private repositories on the free plan** (checked: HTTP 403). See `GITHUB_PROTECTION.md`.
- Hooks and settings live in the repository branch that contains them. A checkout of a branch without this commit (for example `VENTRA-UI`, `VENTRA-BACKEND`, `VENTRA-CLEAN`) is not covered until it is merged in.
- Codex is not governed by Claude's hooks. `AGENTS.md` tells it to use `ventra-git`; that is an instruction, not enforcement.
- In headless `claude -p` runs, Claude ignores a project's allow rules until the folder is trusted. Hooks and deny rules still apply. Open Claude interactively in the project once and accept the trust prompt.
- Production deployment: no deploy target is configured. Approved production commands run only through `ventra-approval run`.

## Changing the controls (owner only)

Agents cannot edit the guard, policy or settings. To change them, in a real Terminal: `ventra-guard unlock 10`, make the change, `ventra-guard lock`. The guard refuses `ventra-guard unlock` when an agent runs it.

## Tests

`node --test scripts/agents/test` runs 29 tests: a 216-command rule table (dangerous, confirm-first, safe), the hooks as real processes, and the Git tool against throwaway repositories with a local bare repository as the "remote". Dashboard side: `npm test` in `VENTRA-DASHBOARD` (77 tests, including a real merge through the approval CLI).

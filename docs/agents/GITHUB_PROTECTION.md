# GitHub protection: findings and options

Checked read-only on 2026-11-03 with your authorized `gh` login. Nothing on GitHub was changed.

## Findings for `dylanherbst/Ventraa` (private, default branch `main`)

| Check | Result |
| --- | --- |
| Branch protection on `main` | **Unavailable.** GitHub answers "Upgrade to GitHub Pro or make this repository public". `main` is not protected. |
| Rulesets | Unavailable (same reason). |
| Environments with required reviewers | None, and not available for private repos on the free plan. |
| GitHub Actions workflows | None (`.github` does not exist). Pushing a branch cannot start a GitHub deployment. |
| Webhooks and recorded deployments | None. |
| Vercel/Netlify GitHub app | Cannot be seen with your token. Check the Vercel dashboard: a project connected to this repo builds pushed branches as previews, and builds production only from its configured production branch. |
| History | The tip of GitHub `main` (`6876bc5`, "Build responsive Ventra glass Home...") is **not in your local repository's history**. Local `VENTRA-FEATURES` has no remote. The two lines of work are unrelated, so a pull request from local branches into GitHub `main` would not work. |

## What this means

Without GitHub-side protection, any credential that can push can push to `main`. The local guard prevents agents from doing that, but GitHub cannot yet enforce the production boundary independently, which is what the policy asks for.

## Options (your decision)

1. **GitHub Pro** (paid, about US$4 a month): enables branch protection and rulesets on private repos. I will not buy or upgrade anything. After you upgrade, tell me and I will apply the protection below.
2. **Separate dev repository for agents** (free): agents push feature branches to a second private repo (for example `Ventraa-dev`) using a fine-grained token limited to that repo. You merge into the real `Ventraa` yourself. The credential then physically cannot touch production. Needs a new repo (your account action) and a token only you create.
3. **Keep local-only** (current state): pushing stays disabled. Safe, but nothing is backed up off this Mac.

## Settings to apply once protection is available (I will run these only on your go-ahead)

```bash
gh api -X PUT repos/dylanherbst/Ventraa/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": [] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
```

Also: create a `production` environment with you as required reviewer, store production secrets only there, and keep development secrets separate. If a status-check workflow is added later, list its name in `required_status_checks.contexts`.

## Linking a remote safely (when you are ready)

1. Decide how local and GitHub history relate (new repo, or rebase local work onto GitHub `main`). I will not guess.
2. Tell me which repository to link. I will add it as `origin` and put it in the policy's approved remotes (an owner step, `ventra-guard unlock`).
3. First push is a dry run: `ventra-git push --dry-run`, then a real push of one feature branch, verified on the remote, never `main`.

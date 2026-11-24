# Course Creator QA baseline

Date: 2026-11-03. Code: identical to `feature/course-creator-20261030` @ `f8cfd9f` (checked with `git diff --stat f8cfd9f HEAD -- apps supabase`, empty). Run by `ventra-qa` (read-only). All results are on Node 26.13.0, NOT the pinned 24.21.0. No product code was changed.

Overall verdict: **FAIL (partial)**. Static checks are green; the browser regression is broken; the account and AI paths are unproven end to end.

## Results

| Check | Result | Verified by Chief of Staff |
| --- | --- | --- |
| `typecheck` | PASS | re-run, exit 0 |
| `lint` (0 warnings allowed) | PASS | re-run, exit 0 |
| `npm test` (full unit suite) | PASS, 269/269 per QA | re-run, exit 0 (count not re-read) |
| Course-related test files (12) | PASS, 0 failures | not re-run |
| Browser test `test/course-creator-browser.mjs` | FAIL at line 34 | read the code; not re-run |
| `test:local-integration` | BLOCKED: needs Docker daemon and a running local Supabase (port 55321); neither is running | n/a |
| Production build (`NEXT_DIST_DIR=.next-qa-baseline`) | PASS, 17 static pages | not re-run |

## Browser test failure

`getByLabel('Account workspace', {exact:true})` times out. The `<select>` sits inside its `<label>` (`app/ui/course-account.tsx:34`), so the label's accessible name very likely includes the option text and an exact match never succeeds. This is a likely cause, not yet reproduced. Also, the documented `PLAYWRIGHT_MODULE` directory path fails (`ERR_UNSUPPORTED_DIR_IMPORT`); pointing it at `playwright-core/index.mjs` works.

Before the failure the script did pass: fill, save, "Course saved", reload with persistence from localStorage, learner preview. The account half of the script uses mocked API routes (`page.route`), so it would prove client behaviour only, not Supabase.

## Gaps against the feature standard

- Isolated test page: yes (`/tools/course-creator`, real `lib/local-education-course` logic).
- DEMO/LIVE badge and connection-state indicator: **missing** (confirmed by grep and reading).
- Loading/error: status text and a `busy` flag only; no persistent connection state.
- AI generation: injectable adapter; only tested with a mock fetch, never a live provider.

## Security and risk findings

1. `app/api/courses/generate/route.ts:9-20`: any authenticated user can trigger a paid OpenAI call; no workspace membership check, no rate limit or quota. Cost-abuse risk. (Confirmed by reading.)
2. `app/api/courses/route.ts:27`: every `save_course` error returns the same 409 message, so a revision conflict cannot be told apart from a non-owner, invalid input or an outage. (Confirmed by reading.)
3. `app/api/courses/route.ts`: no refresh-token renewal and no `session_active` check, unlike `app/api/workspace/route.ts`. (Reported by QA; not independently compared.)
4. GET relies on the row-level-security policy `course_read` for tenant isolation; looks correct in the migration but has not been run against a live database with real JWTs.
5. Positives (reported by QA): server-side token validation, same-origin and JSON checks, bounded bodies, `no-store`, httpOnly SameSite cookies, input validation, 256 KB cap, no hardcoded secrets found.

## Not verified

Account save/load against a real Supabase; AI generation against a real provider; the browser account flow past line 34; mobile layout and accessibility; Node 24.21.0; `test:integration` and `test:api-integration`.

## Side effect (handled)

The build rewrote two tracked files (`apps/web/next-env.d.ts`, `apps/web/tsconfig.json`). Both were reverted with `git checkout`. The build output `apps/web/.next-qa-baseline` is git-ignored and was left in place.

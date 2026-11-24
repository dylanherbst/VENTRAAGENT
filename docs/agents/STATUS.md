# VENTRA agent system: verified status

Checked 2026-11-03 on this Mac. "Verified" means I ran a real check this session and saw the result. Re-check before relying on anything that may have changed (processes, logins, limits).

## Verified working

| Item | Evidence |
| --- | --- |
| Claude Code 2.1.317 | `claude --version` |
| 6 specialist agents load | headless Claude run listed `ventra-backend, -feature, -frontend, -qa, -research, -setup` |
| 7 workflow skills | `ventra-bug-fix, -connections, -daily-overview, -feature-acceptance, -new-feature, -ui-design`, then `-codex-handoff` after a fix (it was wrongly hidden from Claude) |
| Research delegation | `ventra-research` subagent really ran read-only and returned file-level findings |
| Feature → QA workflow | `ventra-feature` created a temp file, `ventra-qa` independently verified content and `git status`, I re-checked it by hand, then deleted only that file |
| Edit guard hook | live headless run: Write to an `.env.*` file was blocked with the guard message; no file created. Script test also blocks `VENTRA-CLEAN`, `.openclaw`, and edits while Codex holds the lock |
| Lock logic | temp-repo tests: dead-pid lock reclaimed, live lock blocks other agent, `recover` safe on live lock |
| Repository intact | all 6 branch tips unchanged except the new chore branch; no diff in `apps/`, `supabase/`; `VENTRA-CLEAN`, `VENTRA-UI`, `VENTRA-BACKEND` have no changes |
| Telegram access | owner-only `allowlist` (1 user), no pending codes, token file mode 600; two-way message test passed earlier (owner confirmed a reply) |
| Agent Teams | off (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset) |
| Codex CLI | 0.166.0, `codex login status`: Logged in using ChatGPT |
| GitHub CLI | logged in as `dylanherbst`; the repo has no remote |

## Not working or not verified

| Item | Status |
| --- | --- |
| Codex inspecting VENTRA-FEATURES | BLOCKED: ChatGPT usage limit until 2026-11-04 14:48. Retest with `ventra-codex` |
| Codex handoff end to end | Not demonstrated yet (commands and lock tested; Codex run blocked by the limit) |
| Telegram after the Stage 2 fix | Poller process was restarted and seen running; a fresh end-to-end message test is still needed |
| Mac permissions (Accessibility, Screen Recording) and app/browser interaction | Not verified; needs the owner's macOS permission dialogs |
| `NEW SIMPLE VENTRA BUILD.pdf` | NOT FOUND on this Mac. Other VENTRA PDFs in Downloads are older and were not used as the blueprint |
| Supabase | Not checked (`.env*` files are deliberately not read). Status: unknown |
| AI provider and front-office channels | Checked 2026-11-10: see "Front-office connections" below and `docs/agents/CONNECTIONS.md`. Nothing is Verified yet |
| Telegram bot token | Owner action: it was pasted into chat; rotate via @BotFather `/revoke` then `ventra-telegram-token` |

## Front-office connections (2026-11-10, Connections agent, task A-5)

Status values: Not started, Code present (not configured), Configured (unverified), Verified. Env variable names, routes, owner steps and policy sources are in `docs/agents/CONNECTIONS.md`. Test runs are fixture or scripted tests; no live provider was called.

| Connection | Required or optional | Status | Evidence | Owner action needed |
| --- | --- | --- | --- | --- |
| Model provider (Anthropic) | Required for AI replies | Configured (unverified) | Owner note says key and model are in Vercel (not checked by me). Setter tests 11/11 pass (scripted). Live replay not run. Console balance A$0 | Add funds; make the key a Secret; set a spend limit |
| Website chat `/api/front-office/chat` | Optional | Code present (not configured) | Chat tests 2/2 pass. Channel not created | Run `create_channels.sql`; set chat channel id and key in Vercel; redeploy; test |
| Meta Instagram and Messenger `/api/front-office/meta/webhook` | Optional | Code present (not configured) | Meta tests 5/5 pass. No Meta variable in the owner's Vercel list | Meta app, tester role, App Review and Business Verification before outsiders |
| WhatsApp Business | Optional | Not started | No code or route (name only in `contracts.ts`) | Owner decides whether to build it |
| Vapi AI Receptionist `/api/front-office/voice/vapi/...` | Optional (needed for calls) | Code present (not configured) | Vapi tests 9/9 pass (fixture, not a live call). Vapi account not created; voice live off | Create Vapi account, voice channel, assistant and tools; test call |
| Google Calendar OAuth (booking) | Required for booking | Code present (not configured) | Calendar tests 9/9 pass. No consent route in the app; refresh token not yet made | Make refresh token in OAuth Playground; set four Google variables; share bookings calendar |
| Twilio SMS `/api/front-office/sms/inbound` | Optional | Code present (not configured) | SMS tests 7/7 pass. SID and token in Vercel (owner note); no number or SMS channel | Buy AU mobile number (needs ID); set `TWILIO_FROM_NUMBER`; channel; webhook |
| Postmark email `/api/front-office/email/inbound` | Optional | Code present (not configured) | Email tests 3/3 pass. Token in Vercel (owner note); sender, webhook secret and channel missing | Verify sender domain; set two variables; inbound webhook; channel |

Last verify record (`~/.ventra-dashboard/last-verify.json`, commit 5d5d38d, 2026-11-09) has no front-office step. Node 26 was used for these tests; the repo targets Node 24.

## Course Creator baseline (2026-11-03, Node 26, see `QA_COURSE_CREATOR_BASELINE.md`)

Typecheck, lint, unit tests (269) and production build pass. The browser regression test fails (stale selector at `test/course-creator-browser.mjs:34`). Local integration is BLOCKED (Docker and local Supabase not running). No DEMO/LIVE or connection-state badges. Generate route has no abuse controls. Verdict: FAIL (partial).

Update (same day): the browser regression was repaired (test file only: one selector, two waits, no assertion weakened) and independently re-verified: 3 consecutive passes, a wrong-URL run still fails correctly, lint, typecheck and 269 unit tests pass. Still true: the account half of that test uses mocked API routes; local integration is BLOCKED; no DEMO/LIVE badges; generate route has no abuse controls. Not run after the fix: production build, mobile viewport, Node 24.

## Automation and approval policy (2026-11-03, see `AUTOMATION_POLICY.md`)

Verified: Bash and Edit guard hooks (live run: 8 of 10 forbidden commands blocked, 2 safe ones allowed, nothing changed), guarded Git workflow in a throwaway repo (branch, commit, checks, push to a local bare remote verified, protected-branch and force-push refusals, secret scan, deployment-trigger detection), approval service with real merge execution, owner authentication helper available on this Mac, 29 agent tests plus 77 dashboard tests.
Not enforced yet: GitHub branch protection and approval environments (unavailable for private repos on the free plan); no remote is linked, so automatic pushes are disabled; no production deploy target is configured; the first macOS authentication prompt has not been exercised by a person.

## Known risks

- **One Telegram poller only.** A second plugin server for the same bot kills the first. The plugin is therefore disabled globally and enabled only by `ventra-claude`. Do not run extra `claude --channels` sessions; close old ones.
- **Context bloat.** `~/.claude/agents` holds 282 old agent files (outside this repo), causing the "agent descriptions over 15k tokens" warning in every session. Owner decision pending: move them to a backup folder.
- The edit hook covers Edit/Write/NotebookEdit, not arbitrary shell commands (those use normal permission prompts).
- Stage 2 files live on `chore/agent-setup-handoff` and are not in the other branches until merged (owner decision).
- Untracked OpenClaw leftovers remain in `VENTRA-FEATURES` (`SOUL.md`, `IDENTITY.md`, `USER.md`, `DREAMS.md`, `memory/`); `~/.openclaw` exists and was not touched.

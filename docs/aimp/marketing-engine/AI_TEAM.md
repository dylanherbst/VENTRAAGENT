# AI Team: Marketing agent + Social Media agent on one backend

Built 23 Nov 2026 from `MONEY_PRINTER_AGENT_MARKETING_AND_SOCIALS_BUILD.pdf`.

The two agents share one orchestrator, one text-model integration, one set of media and publishing adapters, one business profile, one approval and audit trail, and one usage meter. Customers open it at **/app/&lt;business&gt;/ai-team**, which has five tabs:

- AI Team
- Marketing studio
- Social & calendar
- Agent settings
- Connections & results

## Phase 0 audit

These parts of the stack were already in the repo:

- **Framework:** Next.js 16 App Router with React 19 and TypeScript. Server actions act as the authenticated API.
- **Database:** Supabase Postgres, with RLS based on `public.memberships`. It is not MySQL: the guide assumed MySQL, so we reuse what exists.
- **Demo runtime:** an in-memory demo runtime, gated by `availability()`.
- **AI:** Claude was already used by the AI Setter (`ANTHROPIC_API_KEY`).
- **Marketing:** the Marketing Engine (five angles) from 22 Nov, plus the AMP-050/051 campaign plan and drafts.
- **Queue:** there is no queue or Redis. The setter uses in-process timers.
- **Missing:** there was no OpenAI, Creatomate or Zernio code before this work.

The decisions that follow from the audit:

- **No new dependencies.** BullMQ and Redis are not added. The OpenAI Agents SDK is not added either: the orchestrator is ours, and it calls a provider-agnostic `JsonModel` (Claude or OpenAI). It can move onto the SDK later without changing the agents.
- **Renders without a queue.** Render status is reconciled on demand (the Refresh button) and by the Creatomate webhook hint.
- **Scheduling.** Zernio owns the posting time once a schedule is accepted, so there is no local publish cron.

## What lives where

| Piece | File |
|---|---|
| Locked policy, blueprints, versioned industry presets (beauty, fitness, trades, ecommerce, AI services, software, digital products, local services) | `lib/aimp/agents/presets.ts` |
| Customer layer: schema, override and injection guard, plan ceilings, compiled prompt | `lib/aimp/agents/config.ts` |
| Shared text model (Claude / OpenAI), retryable errors | `lib/aimp/agents/llm.ts` (the Marketing Engine now uses it too) |
| Tool registry: READ / DRAFT / EXTERNAL levels, per-agent allowlists, flags | `lib/aimp/agents/tools.ts` |
| Social agent: backend slot grid (7 or 30 days), platform rules, validator, demo writer | `lib/aimp/agents/social.ts` |
| Orchestrator: runs, retries, limits, handoff, revisions, approvals, scheduling, media, webhooks, metrics, dashboard | `lib/aimp/agents/team.ts` |
| OpenAI Images + Creatomate adapters and mocks | `lib/aimp/agents/providers/media.ts` |
| Zernio adapter, mock, signature check | `lib/aimp/agents/providers/zernio.ts` |
| Server wiring and signed asset links | `app/start/_server/agent-team-runtime.ts` |
| Routes | `/api/webhooks/zernio`, `/api/webhooks/creatomate`, `/api/aimp/agents/assets/[ws]/[asset]` |
| Database (not applied) | `supabase/migrations/202611230001_ai_agent_team.sql` |
| Tests | `test/aimp-agent-team.test.ts` (11), `test/aimp-agent-team-db.test.ts` (1) |

## Safety rules enforced in code, not only in prompts

- **Workspace scoping.** Every read and write is scoped to the server-checked workspace. An id from another workspace behaves like a missing one.
- **Approvals.** An approval is bound to an exact revision hash and connected account. Any edit, or a new image, withdraws it.
- **One schedule per revision.** The idempotency key is `ws:post:rN`, and the database key is unique.
- **Publishing switch.** Publishing needs `SOCIAL_PUBLISHING_ENABLED=true`.
- **Off and ignored for now.** Paid ads and auto-DMs are off. Their env flags are ignored until the Phase 6 flow exists.
- **Claims.** Banned claims (income, guarantees, fake urgency) are blocked. Numbers not in the owner's facts are flagged and need a tick before approval. Testimonial posts appear only when the facts include real reviews.
- **Customer text.** Customer text sits under the locked policy as data. Override attempts such as "ignore the rules" are rejected.
- **Webhooks.**
  - Zernio: HMAC-SHA256 of the raw body is checked, event ids are deduplicated, and the sending profile must be the one we created for that workspace.
  - Creatomate: the webhook is only a hint, and status is re-fetched from the API.
- **Honest results.** Metrics show "Not measured yet", never zero. Mock results are labelled mock everywhere.

## Live vs mock vs blocked

| Capability | Status |
|---|---|
| Five ad angles, 7 or 30-day plans, edits, revisions, approvals, calendar, settings, presets, limits, audit | **Built, tested.** Live with Claude (key already set), demo writer otherwise |
| OpenAI images | Built and contract-tested, **mock** until `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` are set. The model name and size option are not confirmed in docs: set them yourself. |
| Creatomate reels and statics | Built and contract-tested, **mock** until the key and template ids are set |
| Zernio connect, schedule, status webhooks | Built and contract-tested, **mock** until `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET` are set. The `scheduledFor` and `timezone` field names are **unverified**. |
| Real metrics sync | Records provider numbers. **The pull job is not built yet** because the Zernio analytics API has not been read. |
| Database persistence | Migration written and tested in PGlite. **Not applied, and the store is not wired yet.** |
| Durable media storage | In-memory, served by signed links. **Supabase Storage is not wired yet.** |
| Paid Meta ads | **Off by design** (Phase 6) |
| TikTok and LinkedIn publishing | Drafts only. Publishing is marked "not switched on". |

## What you need to do

1. `supabase db push` (when you want saving).
2. Optionally, `OPENAI_API_KEY` + `OPENAI_IMAGE_MODEL` (and a size, e.g. `OPENAI_IMAGE_SIZE_PORTRAIT`) for real images.
3. Creatomate: an account, two templates (9:16 Reel and 4:5 static) with elements named `Headline`, `CTA`, `Brand` and `Image`, then `CREATOMATE_API_KEY` and the two template ids.
4. Zernio:
   1. Create an account and API key.
   2. Create a webhook endpoint pointing at `https://app.aimoneyprinter.com/api/webhooks/zernio` with a secret.
   3. Set `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET`.
   4. Prepare a test Instagram **Business or Creator** account that you own.
5. For live posting, set `APP_PUBLIC_URL=https://app.aimoneyprinter.com`, `AGENT_ASSET_SECRET` (a random 32+ character string) and `SOCIAL_PUBLISHING_ENABLED=true`.

## 5-minute smoke test

1. Test Lab → AI Team.
2. In Agent settings, choose Fitness and describe a PT business. Add the fact "First session free".
3. In AI Team, press **Five ads + 7 days of posts**.
4. In Marketing studio you should see five different angles. Press Make image on one.
5. In Social & calendar you should see a week grid. Open an Instagram post, then Make image, edit the caption, and save. It becomes v2.
6. In Connections, Connect Instagram. In mock mode this adds a test account.
7. Approve the post, then Schedule. It should say "Mock schedule recorded".
8. Edit after approving. Schedule must refuse until you approve again.
9. Open a second business: none of the first business's data shows.

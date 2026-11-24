# Marketing Engine: plan and status

Owner request (22 Nov 2026): "I want our app to have this feature and also a standalone version for myself to use."
Sources: the pasted master prompt (AiMoneyPrinter Marketing Engine MVP), MARKETING_AGENT.pdf (build guide), AD_DRAFTS.pdf (100 ads, 20 niches x 5 angles).

## Phase 0: what already existed

- `lib/aimp/campaigns` (AMP-050): a Pinterest-first launch *plan* service, with its in-memory store.
- `lib/aimp/campaign-assets` (AMP-051): text drafts for the plan.
- Pages: `/app/[business]/marketing` (overview), `/marketing/creative` (review queue), `/marketing/calendar`.
- Wiring: `app/start/_server/marketing-runtime.ts`.
- Nothing rendered images or video, nothing scheduled, and there were no angles, Zernio or Creatomate.
- The new engine sits beside these and does not change them.
- Claude is already wired for the AI Setter (`ANTHROPIC_API_KEY`). OpenAI and Creatomate had no code. Zernio had no code, and `/api/webhooks/zernio` did not exist.

## Decisions

- **Two writers, one interface.**
  - Claude is the default when `ANTHROPIC_API_KEY` is set.
  - OpenAI (Responses API, strict JSON schema) runs when `MARKETING_TEXT_PROVIDER=openai` and both `OPENAI_API_KEY` and `OPENAI_TEXT_MODEL` are set.
  - With no key, a labelled **demo** writer is used.
- **The writer proposes; our validator decides.** Every angle set must pass these checks:
  - Exactly 5 angles, one per approach, with no near-duplicates.
  - Text length limits.
  - Reels have 3 or more beats within 35 seconds.
  - No banned claims: income, guarantees (a negated "not a guaranteed..." is allowed), fake scarcity, crypto returns.
- **Claim status is ours, not the model's.** Any number or result not backed by the owner's own "facts" is a *hypothesis*. Approving an angle that has one requires the owner to tick "I checked these".
- **Approval.** Editing the approved angle withdraws its approval. `canSchedule()` is the gate every later phase must call.
- **Standalone studio.** `/studio/marketing` is one private workspace (`studio:aimoneyprinter`) that runs the same engine as the app. It is preloaded with the 100-ad playbook (`lib/aimp/marketing-engine/playbook.ts`, parsed from AD_DRAFTS.pdf). It runs only where the demo tools are on (your Mac), so it is never public.

## Built (Phase 1A)

| Piece | Where |
|---|---|
| Types, approaches, formats | `lib/aimp/marketing-engine/types.ts` |
| Brief check, angle validator, edit rules | `validate.ts` |
| Prompt, JSON schema, Claude / OpenAI / demo writers, cost estimate | `strategy.ts` |
| Orchestrator: create, generate (1 retry, never half a set), edit, approve, unapprove, import niche, canSchedule, usage | `engine.ts` |
| 20x5 playbook | `playbook.ts` |
| Server wiring | `app/start/_server/marketing-engine-runtime.ts` |
| In-app page | `/app/[business]/marketing/angles` (linked from Marketing) |
| Standalone | `/studio/marketing` |
| Tests (12) | `test/aimp-marketing-engine.test.ts` |

## Next phases

- **1B Creative:**
  - OpenAI image per approved angle, stored in Supabase Storage.
  - Creatomate 9:16 reel from the storyboard.
  - `/api/webhooks/creatomate`, verified.
- **1C Scheduling:**
  - Zernio connection, schedule only after approval.
  - `/api/webhooks/zernio`, signed and idempotent through `provider_events`.
- **1D Dashboard:** real metrics only, "not measured yet" otherwise.
- **2 (flags off):** Meta ads and inbound DMs, which the AI Setter already covers.
- **Persistence:** migrate the `marketing_*`, `social_connections`, `scheduled_posts`, `provider_events` and `usage_events` tables. The user runs `supabase db push`.

## Unverified (docs could not be fetched this session)

Check each of these against live docs before going live:

- OpenAI Responses request and response shape, and current model names and prices.
- The Creatomate render API and its webhook signing.
- Zernio's API, OAuth and webhook signature.

## What you need to do (only when you want real output)

1. Nothing for angles: Claude is already set up. To use OpenAI instead, add `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` and `MARKETING_TEXT_PROVIDER=openai` to `apps/web/.env.local`.
2. For 1B: a Creatomate account, a 9:16 template, and its API key. For 1C: a Zernio account with your Instagram and TikTok connected.

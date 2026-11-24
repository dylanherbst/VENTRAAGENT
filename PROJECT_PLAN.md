# AIMONEYPRINTER-GROWTH: project plan

**Product:** an automated AI growth team for EXISTING businesses. Three agents and a Growth Manager:
- AI Sales (the AI Setter): DMs, qualifying, follow-up, booking and buy links.
- Social Media: plans, posts, images and video, scheduling.
- Marketing: ad angles, creative, competitor research.
- Growth Manager: daily plan, coordination, retries and escalation.

**Goal:** launch fast, get paying customers, prove the agents work, and earn recurring revenue. Then bring back the startup platform, which is parked, not deleted.

**Source:** copied from `AIMONEYPRINTER` at commit `dd99154`, plus its uncommitted working tree (front-end work in progress), on 24 Nov 2026. The original repository was not changed.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Repository audit and migration plan | Done. See MIGRATION_PLAN.md and FEATURE_INVENTORY.md |
| 2 | Independent repo and working copy | Done. Own git, ports 3140 (dev), 3150 (preview) and 3160 (Test Lab), own Supabase local ports and project id |
| 3 | Park startup routes, simplify navigation | Done. Code: `lib/aimp/growth/product.ts`. Nav: Home, AI Sales, Social Media, Marketing, Search |
| 4 | Existing-business onboarding | Done. `/start/existing` (step 1) and `/app/<id>/activate` (steps 2 to 6) |
| 5 | Shared business knowledge | Done. One profile, copied to AI Sales on every save |
| 6 | Existing agents work | Done in demo storage. Tests pass. Durable storage is still open (see below) |
| 7 | Growth Manager | Done (on demand). `lib/aimp/growth/manager.ts` drives Home. The scheduled runner is open |
| 8 | Simplified pages | Done. Home (growth dashboard), Sales, Social, Marketing, Profile, Settings |
| 9 | Landing positioning | Done in this repo (`/start` welcome, `/site`). The separate public website repo still needs the same copy |
| 10 | Auth, billing, security, automation tests | Partly done. Unit and integration tests pass. Needs a real database and keys |
| 11 | Desktop and mobile visual regression | Not started. Needs a browser run on the Mac |
| 12 | Deployment and launch docs | Done. See LAUNCH_CHECKLIST.md |

## Biggest open items before taking money

1. **Durable storage for the agents.** Agent and AI Sales data is still kept in server memory (the demo runtime). Plan: reuse the snapshot vault built for the Studio (`lib/aimp/studio/vault.ts` + `state.ts`), keyed per business, in its own Supabase project.
2. **Agents run while the owner is away.** Add a Vercel Cron route that calls the Growth Manager per business. It must respect limits and approvals, never publish or send, and finish due AI Sales replies.
3. **Real accounts.** Supabase login is in the code. It needs this product's own Supabase project and Vercel project.
4. **Live integrations.** Zernio, OpenAI images, Creatomate, and Meta app review for Instagram DMs.
5. **Stripe tiers.** The entitlements are written in `lib/aimp/growth/product.ts`. Products and prices are created by Dylan, then linked.

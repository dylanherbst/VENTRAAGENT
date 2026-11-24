# Task tracker

Owners:
- **CO:** Coordinator
- **FE:** Frontend
- **BE:** Backend
- **AI:** AI Agent Engineer
- **RS:** Research
- **QA:** QA
- **DYLAN:** needs you

| # | Task | Owner | Depends on | Status | Acceptance |
|---|---|---|---|---|---|
| 1 | Audit and migration plan | CO | none | Done | MIGRATION_PLAN.md and FEATURE_INVENTORY.md written |
| 2 | Independent repo, ports, Supabase local ids | BE | 1 | Done | Original repo unchanged; its own git; ports 3140, 3150, 3160 |
| 3 | Park startup routes, new nav | FE/BE | 2 | Done | `growthRedirect` tests; nav tests; the build passes |
| 4 | Onboarding steps 1 to 6 | FE/AI | 3 | Done (needs a browser pass) | Can go from welcome to an activated team |
| 5 | Shared profile and AI Sales sync | AI | 4 | Done | `aimp-growth.test.ts` |
| 6 | Growth Manager and growth Home | AI/FE | 5 | Done (on demand) | Plan, lights and results come from real records only |
| 7 | Landing copy (`/start`, `/site`) | FE | 3 | Done | Hero, sub-copy and CTAs as briefed; no earnings claims |
| 8 | **Durable storage per business** (snapshot vault, Supabase) | BE/AI | 2 | To do | Restarting the server loses nothing; tenant isolation tests |
| 9 | **Scheduled Growth Manager run** (Vercel Cron, `CRON_SECRET`) | BE/AI | 8 | To do | Plans and AI Sales follow-ups run unattended; never publishes or sends without approval |
| 10 | Enforce tier entitlements in actions | BE | 8, 13 | To do | A Starter workspace cannot run Sales or Marketing |
| 11 | Desktop and mobile visual pass | QA/FE | 4, 6 | To do | Screenshots at 390 and 1440 px for every page |
| 12 | Brand-new Supabase project for Growth, then `supabase db push` | **DYLAN** | none | Waiting | Project ref sent (not keys) |
| 13 | Stripe products and prices for Starter, Growth and Autopilot | **DYLAN** | none | Waiting | Price ids added to Vercel env |
| 14 | Zernio account, key and webhook secret; a test Instagram Business account | **DYLAN** | none | Waiting | Real schedule test |
| 15 | Meta app review for Instagram DMs (AI Sales) | **DYLAN** | none | Waiting | Live DM test on a test account |
| 16 | New Vercel project for Growth and its domain | **DYLAN** | 12 | Waiting | Preview deploy works |
| 17 | GitHub repository `AIMONEYPRINTER-GROWTH`, then push | **DYLAN** | none | Waiting | Remote added; branch pushed |
| 18 | Update the public website repo copy to the growth positioning | FE/DYLAN | 7 | To do | Same copy as `/site` |
| 19 | Competitor and market research refresh for target industries | RS | none | To do | Short notes per industry in `docs/` |

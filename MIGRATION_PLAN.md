# Migration plan (audit summary)

## Architecture as found (24 Nov 2026)

- **Stack:**
  - `apps/web`: Next.js 16.4.1 App Router, React 19.3, TypeScript, plain CSS plus the glass design system (`app/design-system/aimp-glass`, `--amg-*` tokens).
  - Node tests via `node --experimental-strip-types --test`, about 2,760 tests.
- **Backend:**
  - Server actions and route handlers in `apps/web`.
  - Supabase Postgres migrations in `supabase/migrations`, with RLS by `public.memberships`.
  - The demo runtime (`app/start/_server/runtime.ts`) keeps workspace data in memory when `AIMP_TOOLS_ENABLED=1`.
- **AI agents (all in `lib/aimp`):**
  - `setter/`: AI Sales, which is Claude plus policy gates.
  - `agents/`: Social and Marketing agents, orchestrator, tool registry, presets.
  - `marketing-engine/`: five ad angles and the playbook.
  - `gaps/`: competitor research.
- **Integrations:**
  - Anthropic (live).
  - OpenAI text and images (adapter; key needed).
  - Creatomate and Zernio (adapters; keys needed).
  - Instagram Login and webhooks for AI Sales (needs Meta app review).
  - Stripe (test key verified).
  - Resend (key verified).
- **Shared infrastructure:**
  - Approvals and audit.
  - Usage and cost metering.
  - Signed asset links.
  - Webhooks: Zernio, Creatomate, Stripe, Meta.
  - Rate limits.
  - The jobs runner (`lib/aimp/jobs`).

## What was done

1. Copied the working tree into a new folder with a new git history. Excluded: `node_modules`, build output, `.git`, `.env*` (except examples), local data, worktrees, recovery and course notes, and the owner-only Studio app.
2. **Parked (not deleted)** the startup journey. One file decides it: `lib/aimp/growth/product.ts`.
   - Public: `/start/tour`, `goals`, `about`, `ideas`, `brand`, `products`, `catalogue`, `store`, `payments`, `showcase`, `/tools/opportunity-finder`, `/shop`, `/s`.
   - Workspace: `offers`, `products`, `website`, `domains`, `payments`, `orders`, `results`, `brand`, `path-choice`.
   - Parked addresses redirect (307) to onboarding or Home. To bring a page back, remove its prefix.
3. The navigation is data in `workspace-nav-items.ts` and `entry.ts`: Home, AI Sales, Social Media, Marketing, plus Search. Business Profile and Settings are behind the profile menu. Styling is unchanged.
4. **New routes, built only from existing components:**
   - `/app/<id>/sales`: the AI Setter screen.
   - `/app/<id>/social`: AI Team, opened on Social and calendar.
   - `/app/<id>/marketing`: AI Team, opened on Marketing, with links to the angle studio, competitor research, creative library and calendar.
   - `/app/<id>/profile`: AI Team, opened on the business profile.
   - `/app/<id>/activate`: onboarding steps 2 to 6.
   - The old marketing plan moved to `/marketing/plan`.
5. **Home** is the growth dashboard (Growth Manager). The old launch-checklist Home is kept as `home/page-startup.tsx.txt`.
6. **Test Lab** seeds a mock existing business. The old startup seed is kept as `test-lab/actions-startup.ts.txt`.

## Database isolation

- Never point this app at the original Supabase project. Create a new project for Growth, then run `supabase db push` there.
- The local Supabase ports were changed (56321 and 56322) so both repos can run side by side.

## Not migrated (on purpose)

- `apps/studio` (the owner's private tool) stays in the original repo.
- The startup Test Lab seed and the startup Home are kept as `.txt` files for reference only.

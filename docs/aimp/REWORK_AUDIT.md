# AiMoneyPrinter rework: repo audit and milestone 1 plan

Brief: `AiMoneyPrinter_Claude_Rework_Instructions.pdf` (Implementation Brief 01-04, received 15 Nov 2026).
Branch: `aimp/mobile-launch-m1`, created from `aimp/foundation` @ 13024aa. The 67 uncommitted entries from the coordinator's earlier work were carried over untouched and are not committed.
Audit date: 15 Nov 2026. Method: read-only inspection of routes, libs and docs, plus `tsc --noEmit` (clean, 39 s). Tests, lint and `next build` were not re-run for this audit; the last recorded result in `docs/aimp/README.md` is 1568 tests, 1563 pass, 0 fail, 5 todo (14 Nov).

## 1. What already exists (reuse)

| Brief area | What is in the repo | Status |
| --- | --- | --- |
| Marketing website | `/plant-lab` (Seedline, 3D seed-to-tree story, "Watch AI build a business" demo), `/plant-lab/build` | Working lab route. Primary CTA is "Build My AI Business", not "Find my side hustle". Homepage integration pending owner approval. |
| Signup and onboarding | `/start` > `/start/account` > `/start/tour` > `/start/goals`, existing auth `app/api/workspace/route.ts`, `lib/aimp/onboarding` | Working. Collects skills (opportunity `FinderProfile.skills`). Country, preferred language and "who do you already know" not confirmed. |
| Idea finder | `/start/ideas`, `/start/ideas/[id]`, `lib/aimp/opportunities`, `opportunity-scoring.ts`, `lib/aimp/blueprints` | Working on fixtures. Needs check that it returns exactly five ranked ideas with buyer, first-buyer channel, setup cost and owner work. |
| Product creator | `/start/products`, `/start/products/file`, `lib/aimp/factory`, `lib/aimp/products`, `lib/aimp/files` | Partial. File route exists; real PDF output for one niche is still plan step 6. |
| Website and store | `/start/store`, `/start/brand`, `/start/catalogue`, `/app/[business]/website`, `/s/[store]` multi-tenant storefront, `lib/aimp/storefront`, `site-versions`, `publish-check` | Working on demo store. Publish check and publish exist; the single "Approve and publish" action in the guided flow needs confirming. |
| Payments and fulfilment | `lib/aimp/checkout`, `sellers` (eligibility, readiness), `orders`, `fulfilment` (replay-safe, signed download, reissue, refunds), `/api/aimp/{checkout,webhooks/payments,files/[token],fulfilment}` | Built and tested on fixtures. Real Stripe Connect not wired; storefront `checkoutBuilt` still false. |
| Marketing | `lib/aimp/campaigns`, `campaign-assets`, `/app/[business]/marketing` (calendar, creative) | Built on fixtures. Not yet a "Get customers" screen driven by the published product and live shop link. |
| CRM / Setter / Inbox | VENTRA front-office code (`lib/front-office`, `app/(ventra)/inbox`), `/app/[business]/approvals`, `operator` | VENTRA-era. No AIMP Inbox yet. |
| Dashboard | `/app/[business]` overview, `/app/[business]/dashboard`, `lib/aimp/overview` | Working on fixtures. Needs reshaping to "What's ready / What needs me / What happened". |
| Workflow builder | `lib/aimp/automation`, `/app/[business]/operator` | Foundations exist. Preconfigured buttons (Draft a launch campaign, Review replies, Send my weekly brief) not confirmed. |

Other facts:
- `/start`, `/app/[business]` and `/s/[store]` are the AiMoneyPrinter surfaces. `app/(ventra)/**` (create, customers, grow, money, services, onboarding, business, more, settings, ...) and `app/api/courses`, `lib/scope-freeze.ts` are VENTRA leftovers.
- 60 `/tools/*` test pages. 10 are `aimp-*`.
- Workspace nav is 11 desktop-style items (Overview, Dashboard, Brand, Products, Orders, Website, Domains, Payments, Marketing, Approvals, Operator). The brief wants four bottom tabs: Home, My Shop, Growth, Inbox, with Settings behind the profile icon.
- Migrations: `supabase/migrations/202611140001_aimp_commerce_core.sql` is now in place (was a proposal).

## 2. Gaps against the brief

1. **Entry point.** "Find my side hustle" is not the primary mobile action anywhere. Setup labels "Find my side hustle / Build it for me / Review my launch" do not exist.
2. **Intake.** Time, budget, skills, country and preferred language, plus one optional "who do you already know" question: confirm which of these `/start/goals` captures and store country, language, currency, timezone per business.
3. **Five ranked ideas** with product, target buyer, first-buyer channel, setup costs and remaining owner work.
4. **One product format first** (planner or workbook): generate product file, sample, listing and price suggestion together; the user opens the real file on mobile.
5. **Approve and publish** as one action with a clear "what is holding up your launch" list when payments are pending.
6. **Test payment** to correct-download-once to replay-does-not-reissue, end to end through the real routes (currently fixture-level).
7. **Launch kit** generated from the actual product and live shop link (posts, captions, sample, short publishing plan) with one approve/export place.
8. **Mobile app shell**: four bottom tabs, Settings behind profile icon, readable cards.
9. **Inbox** (enquiries, suggested replies, follow-ups, checkout/booking status) replacing the CRM pipeline view. Second milestone.
10. **Claude workflows**: Small Business plugin prototype with the Agent SDK, pinned revision, structured drafts only, execution through AiMoneyPrinter's backend. Not started; per the brief this is Launch (onboarding/brand context, campaign creator, weekly brief) then Setter later.

## 3. Remove or hide from the default journey (do not delete code yet)

Per brief page 1. Hide behind navigation changes and a flag, keep routes working for existing callers, and check dependencies before any deletion:
- VENTRA routes: courses, service businesses, existing-business growth, Course Creator, memberships, communities.
- Business plans, proposals, contracts, client portals, project boards, multiple stores/teams.
- Full website editor, CRM pipeline, manual workflow canvas (replace with simple edits and Inbox).
- AI Receptionist and appointment calendars (bookings stay as a later path).
- Payroll, hiring, inventory, supplier bills, bookkeeping, tax: keep outside the plugin import.

## 4. Blockers and risks

- **Another writer's uncommitted work.** 67 entries (the `/app/[business]` workspace, products, payments, integrations, publish-check) are uncommitted on the working tree. The coordinator's last write was about 30 minutes before this audit. Milestone 1 must build on them, so they need a decision: commit as a baseline first, or leave until the coordinator finishes.
- **Tooling points at the old repo.** `scripts/agents/ventra-handoff` and the VENTRA rules still reference `VENTRA-FEATURES` and the `ventra-git` wrapper. Not found on the Mac VM's PATH, so raw `git switch -c` was used for the branch; no commits yet.
- `lib/scope-freeze.ts` still freezes checkout, webhooks and courses (needs owner OK to change; plan step 3).
- No Stripe Connect and no real payments: the "complete a test payment" step can only run against fixtures or Stripe test mode with credentials the owner has not provided.
- The 3D plant on `/plant-lab` is laggy on scroll (reported 14 Nov, mitigations applied, not yet profiled in a production build).
- Real-device iPhone Safari run not done.

## 5. Milestone 1 plan (fresh user on mobile: idea > file > preview > publish > test payment > one download > launch kit)

Order of work, one writer, each step with a test and a `/tools/*` check:

1. Baseline: resolve the uncommitted tree (owner decision), run full tests, lint, `next build`.
2. Entry: make "Find my side hustle" the primary CTA on `/plant-lab` and the first `/start` action; setup step labels.
3. Intake and ideas: capture country, language, time, budget, skills, optional known-people; return five ranked ideas with the required fields.
4. Product + sample + listing + price: one planner/workbook format, real PDF, opens on a phone.
5. Preview and Approve-and-publish in a single guided step; payment-readiness blockers shown in plain words.
6. Checkout in Stripe test mode (or fixture mode if credentials are missing), single delivery, replay-safe, resend.
7. Launch kit from the actual product and live shop link.
8. Four-tab mobile shell around the existing workspace pages.
9. Phone-viewport end-to-end run with a fresh account; report preview URL, steps, results, changed files, blocked steps.

Second milestone: Inbox and first Setter release, weekly brief, Find customers, Claude plugin prototype.

## Status after milestone 1 work (15 Nov 2026)
Plan steps 2 to 8 are built and tested at node level (see `docs/aimp/README.md`, section "15 Nov 2026"). Open: step 1 build check on the Mac, step 9 phone-viewport run with a fresh account, Stripe test mode, real AI wording, hiding legacy VENTRA routes, and everything in the second milestone.


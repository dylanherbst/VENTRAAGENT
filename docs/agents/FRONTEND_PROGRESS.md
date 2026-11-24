# Frontend progress (owner master brief, 2026-11-05)

Branch `frontend/glass-dashboard-reference`. Palette: approved V5 teal glass kept (light default; dark is an opt-in teal variant). Design source: `docs/DESIGN.md`.

## Stage 1 (mobile foundation): done, awaiting independent QA
- Shell: five-destination navigation (Home, Create, Grow, Customers, More) in the sidebar and a safe-area bottom bar; avatar/account button and notifications in the mobile header; `/tools` removed from customer navigation (pages still exist).
- Feature registry `lib/feature-registry.ts` (65 entries) with `test/feature-registry.test.ts` checking each status against `docs/agents/FEATURES.md`.
- Components: `design-system/feature-tile.tsx` (FeatureTile, AvailabilityLabel, PlainTile), `design-system/charts.tsx` (Panel, StatCard, BarChart, Donut, ProgressList, FunnelBars, AccentCard), `ui/ventra-hubs.tsx`.
- Hubs: `/create` (route-aware order: Courses & Coaching, Start a Business, Services & Offers, Website & Store), `/grow` (no `tab`), `/customers` (no `tab`), `/more` (new). Tabs views keep a "back to hub" link.
- Home: welcome, one personalised primary action by route, Today (top 3, rest collapsed), route progress (course lessons / launch plan steps / follow-ups and campaign drafts), recent saved work (account activity), recommended tools, business overview labelled Local draft.

## Features connected to verified APIs (unchanged real components)
Contacts, deals, follow-ups, offers, website/storefront drafts, workflow/email/funnel/content drafts, notifications, team, integrations, account activity (all existing editors and `LauncherAccountSync`).

## Draft only (labelled)
Sales reports, business overview (FEATURES.md Local draft).

## Disabled (greyed, reason shown)
AI course generation, video lessons, student accounts, AI business idea helper, public booking, live memberships, AI website, checkout, orders, email sending, AI image/video, lead discovery, running automations, AI receptionist, inbox, calendar, auto-assign, revenue/AI insights, billing.

## Stage 2 and 3 (done, awaiting independent QA)
- Reference look is the default theme (warm dark glass frame, blue accent card with real bar chart, gold card, dark card with an area chart of contacts and deals by month last saved, Export header button, Settings and Support pinned in the sidebar). Light V5 stays as the Theme alternative. See `docs/DESIGN.md`.
- `/create/start`: Start a Business flow on a customer route with guided progress from saved data (`ui/start-business.tsx`, `design-system/guided-steps.tsx`); `BusinessLauncher` takes `embedded` and its editors are ordered skills, evidence, validation, pricing, branding, plan, checklist.
- Deep links per tile (`#course-editor`, `#course-quizzes`, `#learner-preview`, `#course-sales-page`, `#certificates`, `#coaching`, `#agreements`, `#client-portal`, `#client-projects`, `#link-in-bio` and the `#start-*` anchors) with `design-system/anchor.tsx`; no registry route points at `/tools` (tested). `lib/draft-registry.ts` and the Today checklist link to customer routes too.
- Shared states (`design-system/states.tsx`), sticky action bar above the bottom bar on mobile, sheet-style dialogs, 16px inputs on phones.
- Tablet: four stat cards at 700px and up; sidebar from 1024px.

## Open issues
- Contrast was checked by eye and by choosing values (muted text about 7:1, disabled tile text about 4.7:1 on the panel), not with a tool.
- The old create dialog code is kept for tests but nothing opens it now.
- Many editor pages are long (the launcher page is very long on a phone); they could be split into steps later.
- Sandbox Course Creator (`/tools/course-creator`) still uses its own profile id; Create > Courses uses the profile-based editor.
- Not browser-checked: every sub-tab in dark; light theme after the reference override.

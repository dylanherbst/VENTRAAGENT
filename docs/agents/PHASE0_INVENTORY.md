# Phase 0 inventory (P0-1)

Written by the Master Coordinator (cycle c-609334b7, 2026-11-09) from a read-only `ventra-research` pass over
`agent/develop` @ 9eaf07c. Source: file and route listings plus targeted greps. A test file listed here proves only
that the file exists; the full suite (610 tests) passed after P0-6 (commit 59a3d957). Live provider connections
(Twilio, Meta, Postmark, Vapi, Google Calendar, Stripe live) are **unknown**: none were exercised. Blueprint pages 6-15
were not re-read in this pass.

Note: `docs/agents/SCOPE_FREEZE.md` (2026-11-06) freezes everything except the front office and its plumbing. The
Build Plan (2026-11-09) names Growth Audit -> Setter/Receptionist -> enquiry -> booking as the first sellable result,
so those are in scope. Course and launcher routes answer `423 feature_paused` by design.

## Modules

| Module | Real files / routes | State | Why | Tests (files) | Plan |
| --- | --- | --- | --- | --- | --- |
| AI Setter | `lib/front-office/setter/*`, `orchestrator.ts`, `router.ts`, `handoff.ts`, `opt-out.ts`, `sms-send.ts`, `twilio.ts`, `email.ts`, `meta.ts`, `sales/*`, `templates/{gym,ventra}.ts`; `api/front-office/{chat,sms/inbound,email/inbound,meta/webhook,settings,summary}`; `tools/front-office*`, `(ventra)/customers/ai-team`; migrations `202611060001`, `0003`-`0005` | KEEP, FINISH demo | Most complete module. No Growth Audit -> Setter link. Live channels unknown | `front-office-{setter,sales,chat,email,meta,channel-setup,ventra-e2e,db}`, `front-office` | BP p.3 |
| AI Receptionist | `lib/front-office/receptionist/{prompt,agent}.ts`, `vapi.ts`, `vapi-route.ts`; `api/front-office/voice/vapi/{webhook,chat/completions}` (+ `[channel]`); migration `202611080001` | KEEP | Route, tables and tests exist. No real Vapi call proven | `front-office-receptionist`, `front-office-receptionist-db`, `route-audit`, `route-rate-limits` | BP p.3 |
| Course Builder | `lib/course-creator.ts`, `openai-course.ts`, `course-account.ts`, `local-education-*`, `learner-portal-preview.ts`; `api/courses`, `api/courses/generate`, `api/workspace/courses`; `tools/course-creator` etc. | FINISH (frozen) | Generation and save exist; learner access and enrolment checkout missing | `course-creator`, `openai-course`, `course-account`, `local-education-*` | BP p.4, phase 3 |
| Business Creator | `lib/local-business-plan-draft.ts`, `local-brand-direction-draft.ts`, `local-offer-validation-worksheet.ts`, `local-pricing-scenario.ts`, `local-market-evidence.ts`, `local-offers.ts`, `offers-sync.ts`, `launch-checklist.ts`; `(ventra)/create/start`, `(ventra)/onboarding` | FINISH (frozen) | Separate drafts, no single saved wizard | matching `local-*`, `offers-sync`, `onboarding` | BP p.4, phase 3 |
| Business Booster (Growth Audit) | `lib/growth-opportunity.ts`, `app/ui/growth-opportunity.tsx`, `lib/audit-sync.ts`, `growth-plan-sync.ts`; `(ventra)/grow/audit`, `tools/growth-audit`, `tools/growth-opportunity`; migrations `0016`, `0017` | REPAIR | Findings carry evidence but saved copy is browser-only; no link to Setter/Receptionist demo | `growth-opportunity`, `audit-sync`, `growth-plan-sync` | BP p.5, first sellable result |
| Website Launcher | `lib/local-website-page*.ts`, `local-link-in-bio.ts`, `local-storefront.ts`, `local-funnels.ts`; no publish or domain route | BUILD (publishing) | Local drafts and templates only | `local-website-page*`, `local-funnels`, `site-content` | BP p.5, phase 4 |

## Shared engine

| Engine | Real files | State | Why | Tests |
| --- | --- | --- | --- | --- |
| Auth | `lib/workspace-route.ts`, `lib/supabase/client.ts`, `rate-limit.ts`, `request-security.ts`; migration `202610160001` (RLS) | KEEP | Bearer auth + RLS; workspace integration test passed against local Supabase this cycle | `workspace`, `workspace-routes`, `supabase`, `rate-limit`, `route-audit` |
| Customers / CRM | `fo_contacts`/`fo_messages`/`fo_handoffs` vs browser-only `local-crm-*` | REPAIR | Two unconnected customer records (BP "one source of truth") | `front-office-db`, `local-crm-*` |
| Bookings | `lib/front-office/booking.ts`, `calendar/{slots,google}.ts`; migration `202611060002` | KEEP, FINISH | Logic tested; Google Calendar live unknown | `front-office-calendar`, `front-office` |
| Payments | `lib/stripe-checkout.ts`, `stripe-webhook.ts`; `api/checkout`, `api/stripe/webhook`; migration `202611030011` | KEEP | Test-mode only; webhook paused by the freeze | `stripe-checkout`, `stripe-webhook`, `orders-db` |
| Jobs / runner | `lib/front-office/jobs.ts`; `api/front-office/jobs/run`; `vercel.json` cron on `feature/ventra-website` (not this branch) | REPAIR | Retry/back-off unverified | `front-office-jobs-run`, `front-office-calendar` |
| Notifications | `lib/notifications.ts`, `notification-prefs.ts` | FINISH | In-app list only; owner alert for new enquiries unknown | `notifications`, `notification-prefs` |

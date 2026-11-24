# Parked list

Frozen on 2026-11-06 by the scope freeze (`SCOPE_FREEZE.md`). Code and saved data are kept; the backend refuses
new work for these. Review on Fridays. Unfreeze only when a gate or a paying customer needs it.

| Item | Parked | Reason | Backend effect |
| --- | --- | --- | --- |
| Course Creator, course editor, lessons, quizzes, learner preview | 2026-11-06 | Not part of the front office | `/api/courses`, `/api/workspace/courses` paused; `lesson-quiz`, `student-progress` drafts paused |
| AI course generation | 2026-11-06 | Not part of the front office | `/api/courses/generate`, `/api/workspace/course-generation` paused |
| Education extras: certificates, sales page, coaching, workshops | 2026-11-06 | Not part of the front office | `education-*` drafts paused |
| Start a Business tools: skills, evidence, validation, pricing, branding, business plan, launch checklist | 2026-11-06 | Not part of the front office | matching drafts paused |
| Services: offers, proposals, agreements, invoices, client portal, project board, membership plans | 2026-11-06 | Sales offer config will be rebuilt for the Sales agent (tracker 2.6) | `service-*`, `membership-plans` drafts paused |
| Website, storefront, link in bio, community space | 2026-11-06 | Not part of the front office | matching drafts paused |
| Checkout and Stripe webhook | 2026-11-06 | Payment link returns in Phase 2 (tracker 2.9), one provider | `/api/checkout` 423, `/api/stripe/webhook` 503 |
| Marketing: email campaigns, funnels | 2026-11-06 | Follow-ups move into the Setter's ladder (tracker 1.4) | matching drafts paused |
| Content calendar, ad concepts | 2026-11-06 | Content loop returns in Phase 2 (tracker 2.3), fed by real lead questions | matching drafts paused |
| Growth plan, growth audit | 2026-11-06 | Replaced by the Friday funnel numbers (tracker 4.4) | matching drafts paused |
| Workflow builder | 2026-11-06 | The orchestrator replaces it | `workflow-builder` drafts paused |
| Dashboards beyond the core funnel (business overview, sales reports) | 2026-11-06 | One funnel view only | browser-only today; no backend route |

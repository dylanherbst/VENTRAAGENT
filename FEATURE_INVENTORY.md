# Feature inventory

Statuses:
- **R:** retained.
- **X:** removed from the active app (parked; the code is kept).
- **M:** modified.
- **N:** newly implemented.
- **I:** requires integration setup.
- **A:** requires customer approval at run time.
- **D:** requires developer attention.

| Feature | Status | Notes |
|---|---|---|
| Glass design system, tokens, desktop and mobile shells, three-panel carousel overview | R | Unchanged |
| Desktop glass nav and floating mobile dock | M | Items now: Home, AI Sales, Social Media, Marketing, Search |
| Welcome `/start` | M | Growth positioning. The side-hustle and demo fast-forward buttons were removed |
| Existing-business onboarding step 1 `/start/existing` | R/M | Now leads into steps 2 to 6 |
| Onboarding steps 2 to 6 `/app/<id>/activate` | N | Website reader (safe: https only, public addresses only), AI draft for review, connect, goals, automation, activate |
| Shared business profile (single source of truth) | N/M | `BusinessProfile` extended. Partial saves keep earlier answers. Copied to AI Sales on every save |
| AI Sales (setter): DMs, qualifying, objections, follow-up, handoff, opt-out, CRM stages, reply delay | R | Route `/sales`. Live Instagram needs Meta app review (I, D) |
| Automatic AI Sales replies | R, A | Owner must tick to confirm. Low confidence becomes a draft |
| Social Media agent: 7 or 30-day plans, captions, hashtags, pillars, images, video, approvals, scheduling | R | Route `/social`. Real publishing needs Zernio plus `SOCIAL_PUBLISHING_ENABLED=true` (I) |
| Approve each post (immutable approved revision) | R, A | |
| Marketing agent: 5 ad angles, claims check, creative, competitor research, playbook | R | Route `/marketing` |
| Paid ad launch and budget changes | X, A | Off by design. Needs a Meta ads connection and a budget approval flow (D) |
| Growth Manager: daily plan, agent lights, retries, escalation, recommendations | N | On demand from Home. The scheduled background run is not built yet (D) |
| Engagement and ad performance metrics | R, I | Show "Not measured yet" until a connected account reports them |
| Subscription tiers Starter, Growth, Autopilot | N, D | Entitlements in code. Not enforced in actions yet. Stripe products not created |
| Stripe checkout and billing | R, I | Test key verified. Live products need Dylan |
| Supabase auth and memberships | R, I | Needs this product's own Supabase project |
| Durable agent storage | D | Still demo memory. Plan in PROJECT_PLAN.md |
| Business idea generator, side-hustle recommendations, opportunity finder | X | Parked |
| Business creation wizard, naming generator, brand builder | X | Parked (brand data still used behind the scenes for the business name) |
| Product creation, digital product builder, Offer builder | X | Parked |
| Website and storefront builder, templates, domains, shop, checkout for shop products | X | Parked |
| Startup dashboards, launch checklist Home, startup Test Lab seed | X | Kept as `.txt` reference files |
| Inbox (email enquiries), Approvals, Operator, Integrations, Dashboard | R | From Settings |
| Owner Studio app | X | Lives in the original repo only |

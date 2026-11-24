# AiMoneyPrinter feature checklist

Source: owner build brief, `docs/aimp/reference/AiMoneyPrinter_Frontend_Backend_Build_Brief.pdf` (text: `reference/text/Frontend_Backend_Build_Brief.txt`), added 14 Nov 2026.
Feature IDs A01-I12 match the Master Business Plan. Board states are from `AIMP_BOARD.json` as of 14 Nov 2026 18:05 AWST and are **Local** evidence on fixtures (`verified` = verified locally, not live). The task mapping is a first pass by the Cowork session; the coordinator should correct it when it adds the brief's tracker fields.
A feature is ticked only when both agents have run the same scenario at the level it needs (Local, Provider Test or Live; brief section 8).

## A. Account, onboarding and business setup

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | A01 | Authentication and customer workspace | First release | AMP-010 verified, AMP-014 implemented |
| [ ] | A02 | Goal, budget and available-time assessment | First release | AMP-010 verified, AMP-014 implemented |
| [ ] | A03 | Guided business setup | First release | AMP-015 running |
| [ ] | A04 | Business and legal setup assistant | Next | AMP-116 queued |

## B. Opportunity research and business choice

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | B01 | AI Opportunity Finder | First release | AMP-012 verified |
| [ ] | B02 | Opportunity scoring and confidence | First release | AMP-012 verified |
| [ ] | B03 | Competitor and product research | First release | AMP-012 verified |
| [ ] | B04 | Business Blueprint Library | First release | AMP-011 verified |
| [ ] | B05 | Business preview and financial simulation | First release; richer simulator next | AMP-013 verified |

## C. Brand, product and catalogue

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | C01 | AI brand and identity creator | First release | AMP-020 verified |
| [ ] | C02 | Digital Document and Template Factory | First release | AMP-021 verified, AMP-022 verified |
| [ ] | C03 | Visual and personalised product factory | Second engine | AMP-110 queued |
| [ ] | C04 | Product catalogue and bundle generator | First release; bundles when enabled | AMP-023 verified, AMP-112 queued |
| [ ] | C05 | Product pricing and margins | First release | AMP-023 verified |
| [ ] | C06 | Private digital asset storage | First release | AMP-024 verified |
| [ ] | C07 | Continuous product improvement | Next | AMP-112 queued |
| [ ] | C08 | Scheduled digital membership product releases | Expansion | AMP-210 queued |

## D. Website, storefront and domains

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | D01 | AI multi-tenant site generation | First release | AMP-030 verified |
| [ ] | D02 | Mobile-first storefront design system | First release | AMP-030 verified |
| [ ] | D03 | One-click publishing and rollback | First release | AMP-031 verified |
| [ ] | D04 | Natural-language website editor | Next | AMP-111 queued |
| [ ] | D05 | Subdomains and custom domains | First release; custom domains next | AMP-032 verified, AMP-033 queued, AMP-111 queued |
| [ ] | D06 | Built-in technical SEO | First release | AMP-032 verified |
| [ ] | D07 | Store conversion optimisation | Next | AMP-115 queued |

## E. Payments, sales and delivery

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | E01 | Merchant payment onboarding | First release | AMP-040 verified |
| [ ] | E02 | Customer checkout | First release | AMP-041 verified |
| [ ] | E03 | Verified order-processing engine | First release | AMP-041 verified, AMP-045 verified |
| [ ] | E04 | Automatic download fulfilment | First release | AMP-042 implemented |
| [ ] | E05 | Order-triggered personalised fulfilment | Second engine | AMP-110 queued |
| [ ] | E06 | Refunds, exchanges and order support | Basic first; fuller case management next | AMP-042 implemented, AMP-114 queued |
| [ ] | E07 | Bundles, upsells and recurring payments | Bundles next; membership expansion | AMP-112 queued, AMP-210 queued |

## F. Marketing, sales and customer acquisition

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | F01 | Automated marketing strategy | First release | AMP-050 running |
| [ ] | F02 | AI content and creative studio | First release | AMP-051 queued |
| [ ] | F03 | One-click social account connection | First release | AMP-052 queued |
| [ ] | F04 | Social posting and scheduling engine | First release | AMP-052 queued |
| [ ] | F05 | Pinterest organic traffic engine | First release | AMP-052 queued, AMP-054 queued |
| [ ] | F06 | Instagram, Facebook and TikTok expansion | Next | AMP-113 queued |
| [ ] | F07 | SEO marketing autopilot | Basic SEO first; ongoing optimisation next | AMP-051 queued, AMP-113 queued |
| [ ] | F08 | Opt-in lead capture | First release | AMP-053 queued |
| [ ] | F09 | Automated email follow-up | Next | AMP-113 queued |
| [ ] | F10 | Inbound AI sales assistant | Next | AMP-114 queued |
| [ ] | F11 | Growth performance optimiser | Next | AMP-115 queued |
| [ ] | F12 | Paid advertising autopilot | Expansion | AMP-213 queued |

## G. Business Operator, automation and support

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | G01 | Business Operator orchestration | First release | AMP-060 verified |
| [ ] | G02 | Automation permissions and approval centre | First release | AMP-061 queued |
| [ ] | G03 | Activity and notification centre | First release | AMP-061 queued |
| [ ] | G04 | Failure recovery and retries | First release | AMP-060 verified, AMP-061 queued |
| [ ] | G05 | Scheduled management routines | Next | No board task yet |
| [ ] | G06 | AI Business Advisor | Next | AMP-115 queued |
| [ ] | G07 | Customer support operator | Basic order recovery first; AI support next | AMP-042 implemented, AMP-114 queued |
| [ ] | G08 | AI usage and cost guardrails | First release | AMP-044 queued, AMP-061 queued |

## H. Business dashboard, analytics and portfolio

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | H01 | Simple business dashboard | First release | AMP-062 queued |
| [ ] | H02 | Cost and margin tracking | Basic first; advanced next | AMP-062 queued, AMP-115 queued |
| [ ] | H03 | Campaign attribution | Next | AMP-115 queued |
| [ ] | H04 | Operational health status | Next | AMP-115 queued |
| [ ] | H05 | Multiple businesses and portfolio view | Expansion | AMP-214 queued |

## I. Platform services with frontend implications

| Done | ID | Feature | Release | Board task and state |
| --- | --- | --- | --- | --- |
| [ ] | I01 | Subscription billing | First release | AMP-044 queued |
| [ ] | I02 | Tenant isolation | First release | AMP-003 verified, AMP-064 queued |
| [ ] | I03 | Secure API links | First release | AMP-063 queued |
| [ ] | I04 | Job observability | First release | AMP-060 verified, AMP-063 queued |
| [ ] | I05 | Product standards | First release | AMP-022 verified |
| [ ] | I06 | Audit and approval trail | First release | AMP-063 queued |
| [ ] | I07 | Platform admin | First release | AMP-063 queued |
| [ ] | I08 | Support workflows | First release | AMP-063 queued |
| [ ] | I09 | Abuse prevention | First release | AMP-063 queued |
| [ ] | I10 | Backup and recovery | First release | AMP-031 verified, AMP-063 queued |
| [ ] | I11 | Privacy and data control | First release | AMP-053 queued, AMP-063 queued |
| [ ] | I12 | Feature flags | First release; expanded controls next | AMP-004 verified |

## Sales and lead-generation agents (owner request, 14 Nov 18:19)

Dylan: "we also need our AI Setter / organic lead gen agent". Checked against the Master Business Plan (31 pages, read in
full; it is the same file as `reference/AIMoneyPrinter_Business_Plan.pdf`) and the build brief section 4. The plan's 68
feature IDs are exactly the 68 above; nothing is missing by ID. The agents below are described in the brief's agent maps
but have no row or board task of their own, so they are tracked here with S-numbers (not plan IDs).

| Done | Ref | Agent or workspace | What it does | Where it sits | Board |
| --- | --- | --- | --- | --- | --- |
| [ ] | S01 | AI Setter (inbound sales assistant) | Answers buyer questions from approved product facts, recommends products, sends checkout links, qualifies leads, high-intent alerts, owner takeover | Plan F10 (P1, "reuse Setter logic"); existing VENTRA Setter code in `apps/web/lib/front-office/` | AMP-114 queued (shared with support; needs its own task) |
| [ ] | S02 | Organic Lead Gen Agent ("Lead Agent") | Business Finder, Lead Scorer, Website Auditor, Email Writer, Lead Log; shows niche or B2B prospect, source, score and draft outreach; hands qualified leads to Inbox with context | Brief section 4 only; not a plan feature. Feeds F08 and F10 | No task |
| [ ] | S03 | Inbox Agent | Morning Sort, Draft Writer, Hot Lead Alert, Call Booker; queues for buying intent, support, routine and noise; draft review, takeover, checkout links | Brief section 4; part of F10 | No task |
| [ ] | S04 | Leads and Booking workspace | Lead catcher, scorer, call booker, reminders, payment links; source, consent, score, next action, appointment status | Brief section 4; booking only when the business model enables it | No task |
| [ ] | S05 | Content Strategist | Video breakdown, Reels, X and LinkedIn, newsletter, clip cutter, visual maker; approved assets and tagged links into lead generation | Brief section 4; overlaps F02 | AMP-051 queued (partly) |
| [ ] | S06 | Support Rep | 24/7 answers, business knowledge, hand-off, reviews and questions; verified order lookup, link recovery | Plan G07 | AMP-114 queued; basic link reissue done in AMP-042 |
| [ ] | S07 | Business knowledge base | Editable business info, products, prices, FAQs, scripts, objections, refund rules, brand voice; shows what uses it | Brief section 4; needed by S01, S03, S06 | No task |
| [ ] | S08 | Voice Receptionist (enabled stores only) | Call answering, missed-call text-back, booking, FAQ, CRM logging | Brief: service-business blueprint (expansion). Plan: "Defer; not necessary for digitally fulfilled businesses" | No task (deferred) |

Limits set by the plan that apply to S01-S04: no unrestricted cold outbound messaging (F10), no mass unsolicited DMs (F06),
marketing consent recorded before any follow-up (F08, F09), Australian Spam Act compliance. Outreach runs only through
supported, permissioned channels. Decision for Dylan: whether S01/S02 move into the first release or stay "Next".

## Plan details not found on any board task (keyword check of titles, acceptance and notes, 14 Nov 18:20)

A keyword search can miss differently worded entries; the coordinator should confirm each and add it to the right task.

- [ ] A01: Google sign-in, optional Apple sign-in, password reset, account export and deletion.
- [ ] C01: preliminary name-collision and trademark-risk screening.
- [ ] C02: spreadsheet and PNG/JPG exports, licence notes, formula checks (PDF and ZIP exist).
- [ ] D03: automated smoke test of public pages and checkout readiness on publish.
- [ ] D07: optional consent-based abandoned-checkout follow-up.
- [ ] E02: coupons and multiple quantities.
- [ ] G03: mobile-friendly daily summaries.
- [ ] H02: manual expense input.
- [ ] Priority differences between plan and brief: plan has B05 and E06 as P1 and I12 as P1 (brief: first release); plan has
  C03 and E05 as "P0 second engine" (brief: after the first downloadable store is proven). The brief is the later
  document, so its tiers are used.

## Working agreements from the brief (sections 7-9)

- [ ] Each AMP board item carries: frontend owner, backend owner, contract link, fixture, test route, dependencies, required evidence level, current blocker.
- [ ] (proposed in `contracts/CANONICAL_STATES.md`, five decisions open) Canonical states agreed for business build, store and checkout, order and delivery, marketing, connections (reuse existing enums where they already cover them).
- [ ] (index in `contracts/README.md`; per-feature contract files not written yet) Shared contracts agreed before dependent screens: screen and feature ID, read model, mutation and permissions, workflow and event, fixtures and errors, test evidence.
- [x] Shared skills in the repo: `.claude/skills/amp-feature-contract`, `amp-design-handoff`, `amp-e2e` (added 14 Nov; not yet used on a task).
- [ ] First acceptance run: two test stores, real product, test storefront, Stripe test payment replayed, exactly one delivery; interrupted jobs, unpaid and delayed payment, wrong-store access, provider disconnect, opt-out.
- [ ] Design acceptance checklist (brief section 6) applied to every new screen: first flow, alternate screens, state coverage, mobile-first and accessible, release tier and feature IDs marked.

# AiMoneyPrinter — Page-by-page build specification

Source: `PAGE_BY_PAGE_BREAKDOWN.pdf` (owner upload, 14 Nov 2026), converted to markdown for engineering handoff.
43 screen groups · 115 feature implementations · 68 original feature IDs (A01–I12, matching `docs/aimp/FEATURE_CHECKLIST.md`).

A mobile-first route map and engineering handoff for the public product, founder workspace, customer storefront and internal operations.

**The first complete customer journey:** Sign up → enter budget and time → compare ideas → build a business → review the store → complete a test purchase → deliver the correct file → see the order in the owner dashboard.

**Mobile navigation:** Overview, Products, Website, Marketing and More. More opens Orders, Business Operator, Analytics, Integrations, Settings and Help as available. Keep the current business and urgent tasks visible. Discovery and launch use guided progress screens. Storefront navigation belongs to the shopper experience.

**Release labels:** First release, Next and Expansion are *proposed* build priorities. The earlier Build Brief supplies the feature IDs and scope. Route paths, selected providers and release ordering are planning decisions for the engineering team to confirm against the active repo (i.e. cross-check against `FEATURE_CHECKLIST.md` / `AIMP_FEATURE_MAP.json` before treating a route or release label here as final).

---

## Screen index

### 1 / Public product and account
01. Homepage
02. Pricing and plan comparison
03. Sign-up, sign-in and recovery

### 2 / Discover, build and launch
04. Onboarding and founder profile
05. Opportunity Finder
06. Opportunity detail and economics
07. Blueprint library
08. Build Room
09. Launch checklist and seller setup

### 3 / Owner home, brand and products
10. Business Overview
11. Brand kit
12. Products and bundles
13. Product editor and asset review
14. Files and asset library
15. Memberships and release packs

### 4 / Website, checkout and delivery
16. Website Studio
17. Domains and availability
18. Seller payments and payouts
19. Orders and fulfilment queue
20. Order detail and recovery
21. Public storefront and collection
22. Public product detail
23. Hosted checkout and order confirmation
24. Buyer downloads, recovery and support

### 5 / Growth and customer communication
25. Marketing overview and strategy
26. Creative Studio
27. Calendar, scheduling and organic publishing
28. SEO workspace
29. Lead capture and forms
30. Email and follow-up automation
31. CRM and contacts
32. Unified inbox and customer care
33. Ads, budgets and experiments

### 6 / Automation, reporting and account management
34. Business Operator and job detail
35. Approvals and activity
36. Analytics and attribution
37. Business Advisor and improvements
38. Business settings, team and data
39. Integrations and permissions
40. Account billing and usage
41. Portfolio and business switcher
42. Help and support cases

### 7 / Internal operations
43. Platform operations console

---

## Implementation contract — how the pages share one backend

| Shared service | Engineering contract |
|---|---|
| **Tenant and identity** | Resolve business membership on every private request. Store business ID on all business-owned rows and jobs. Use Postgres RLS plus server checks. Background workers use scoped tools and never trust a browser-supplied tenant ID. |
| **Read and write contracts** | Define route parameters, fields, authorisation, states and errors in existing shared schemas or TypeScript and Zod. Use paginated read models and stable IDs. Return an actionable error code and correlation ID for support. |
| **Durable jobs and events** | Persist requested action, payload version, dependency, status, retry time and output references. Dispatch work after the business transaction. Use stable logical keys for side effects. Persist provider receipts and reconcile uncertain responses before retrying. |
| **Money and delivery** | Use currency-safe minor units. Verify signed webhooks and deduplicate events. Keep payment, payout, fulfilment and email delivery separate. Preserve the purchased product version and check entitlement before minting a download link. |
| **Model boundaries** | Use AI for structured drafts, summaries and research synthesis. Validate outputs and treat retrieved content as data. Apply publishing, pricing, refunds and ad spend through typed, permissioned server actions. |
| **Mobile and accessibility** | Keep one primary action visible. Use readable white, lavender and peach surfaces, accessible contrast, focus and field errors. Provide progress, no-data, permission, failure and recovery states. Use static media for reduced motion. |
| **Integration verification** | Use the same fixtures and acceptance cases in frontend and backend. Run Playwright from browser to API, persistence and provider test events. Label results Local, Provider Test or Live. Use isolated test tenants. |

---

## 01 / Public product and account — Homepage

Route: `/` · Release: **First release** · Brief IDs: A01, B01

Turn a visitor into a signed-in founder who understands the product and can start discovery.
**Primary action:** Start my business

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Hero and primary CTA | Explain the product in one sentence and start the guided flow | Use the existing Next.js marketing shell. CTA opens onboarding for authenticated users or sign-up with a safe return path. Preserve permitted campaign tags. |
| Seed-to-tree experience | Show the transition from choosing an idea to running a store | Use the existing Blender render assets as an optional scroll-led media layer. Start with an optimised still, lazy-load motion and use a static image for reduced motion. Keep CTAs as accessible HTML. |
| Product walkthrough and trust | Show a sample opportunity card, store and download so visitors know what they receive | Render published examples from local content or approved CMS records. Label illustrative figures and sample stores. Link to pricing, help and policies. |
| Conversion signals | Measure visits and starts across public marketing | Send a small first-party event set to the existing analytics stack. Preserve attribution only where permitted. Validate attribution with a browser-to-onboarding test. |

**States:** Public, returning signed-in, media unavailable, reduced motion, authentication return failure.
**Acceptance:** Primary CTA reaches the correct next step with the scene media disabled.

---

## 02 / Public product and account — Pricing and plan comparison

Route: `/pricing` · Release: **First release** · Brief IDs: I01, G08, I12

Help a prospective customer understand allowances, billing frequency and what requires external costs.
**Primary action:** Choose plan

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Plan cards and comparison | Show what is included in each tier | Source display prices, currency and feature matrix from the versioned plan catalogue. Sync recurring price IDs with Stripe. Distinguish app fees from seller payment fees and any ad spend. |
| Usage and eligibility explanation | Show what generation, publishing and business limits mean | Read entitlement definitions from the same registry used by the API. Provide examples and link each feature to the relevant product preview. |
| Checkout handoff | Allow a signed-in customer to start their app subscription | Create a server-side Stripe Checkout session from a known price ID. Gate plan changes on webhook-confirmed subscription state. Show a return screen with pending or success status. |

**States:** Monthly/annual where offered, existing subscriber, expired price, pending activation, plan unavailable.
**Acceptance:** A displayed plan maps to the correct price and entitlement after Stripe test checkout.

---

## 03 / Public product and account — Sign-up, sign-in and recovery

Routes: `/sign-up` · `/sign-in` · `/verify` · `/reset-password` · Release: **First release** · Brief IDs: A01, I08, I09

Get founders securely into their workspace and help them recover access.
**Primary action:** Continue

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Entry and validation | Collect email and the configured sign-in method with minimal friction | Reuse Ventra auth if available. Use Supabase Auth for email verification, password reset and optional supported social sign-in. Keep field errors accessible and avoid revealing account existence on recovery. |
| Verification and recovery screens | Let users recover from expired or missing links | Use provider callback handling with safe redirect allowlists. Add resend cooldown, expiry handling and a contact-support path. |
| Session and workspace handoff | Return users to the right onboarding step or business | Resolve session and memberships on the server. Load the last accessible business from the database and route new users to onboarding. Protect sensitive changes with fresh verification where required. |

**States:** Pending email, expired link, signed out, network error, restricted account, multiple businesses.
**Acceptance:** An unauthenticated visitor cannot open a private business route.

---

## 04 / Discover, build and launch — Onboarding and founder profile

Route: `/onboarding` · Release: **First release** · Brief IDs: A02, A03, I11

Capture constraints so the app proposes businesses the customer can realistically operate.
**Primary action:** Find my ideas

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Goal and constraint wizard | Collect time per week, setup budget, interests, skills, country, currency, product preferences and exclusions | Use the existing React form system with shared validation. Save each step to a draft profile. Make optional questions skippable and show what changes recommendations. |
| Preferences and automation comfort | Ask what the user is willing to review, connect and maintain | Persist structured preferences and distinguish choices from defaults. Preview the impact of switching preferences before rerunning research. |
| Submit and resume | Start discovery once and allow the founder to return later | Submit to an idempotent API that creates a discovery run and links to the ideas screen. Persist answers independently of the run and reuse the existing queue or Trigger.dev. |

**States:** New, saved draft, no affordable path, duplicate submit, queued, failure.
**Acceptance:** Close and reopen mid-wizard without losing answers.

---

## 05 / Discover, build and launch — Opportunity Finder

Route: `/discover` · Release: **First release** · Brief IDs: B01, B02, B03

Show five feasible business ideas when the available evidence supports five candidates.
**Primary action:** Compare ideas

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Research progress and filters | Explain what is being checked and narrow by budget, time or model | Start a durable research job that gathers dated evidence from permitted web search and connectors. Store progress and source metadata. Make filters query the stored results. |
| Opportunity cards | Explain buyer, problem, product, price, cost, time, sales channel and what the founder still has to do | Use structured model output validated against a shared schema. Compute fit from explicit weighted signals. Display confidence, missing evidence and the reason behind rankings. Label financial assumptions. |
| Comparison drawer | Help compare two or three ideas side by side | Use the same scoring dimensions and currency formatting. Keep selected ideas in the URL or draft record. Add an evidence link and a clear empty state. |

**States:** Researching, partial results, low confidence, unsupported models, rerun required, no qualifying results.
**Acceptance:** Every evidence claim points to a dated source or an explicitly marked assumption.

---

## 06 / Discover, build and launch — Opportunity detail and economics

Route: `/discover/[ideaId]` · Release: **First release** · Brief IDs: B02, B03, B04, B05, C05

Let the founder inspect the idea, preview the likely store and decide whether to build it.
**Primary action:** Build this business

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Buyer, demand and competitor panel | Show why the idea fits, direct comparables, pricing, differentiators and evidence gaps | Render citations saved by the discovery job with retrieval dates. Give stale or weak signals their own labels. Use a web search API only for refresh or additional evidence. |
| Financial scenarios | Show price, fees, per-order cost, fixed cost, break-even and time requirements | Calculate locally from server-versioned assumptions using decimal-safe amounts. Let the founder edit units, conversion, costs and price. Show break-even only where contribution is positive. |
| Blueprint preview | Show the sample product, brand, store, channels and setup steps | Render a versioned blueprint preview using the in-house generator and sample assets. List prerequisites, estimated workload and approvals. Treat the preview as a draft until confirmed. |
| Build confirmation | Provision the business with the selected idea and fixed blueprint version | Create tenant membership and the first workflow run in one logical operation with a stable request key. Route to the Build Room. Keep the original idea snapshot attached. |

**States:** Insufficient evidence, unsupported blueprint, unavailable preview, zero contribution, repeated confirmation.
**Acceptance:** Repeat confirmation returns the same created business and build run.

---

## 07 / Discover, build and launch — Blueprint library

Route: `/blueprints` · Release: **Next** · Brief IDs: B04, I12

Explain which business models AiMoneyPrinter can generate and operate.
**Primary action:** View blueprint

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Blueprint cards and details | Show outputs, prerequisites, human tasks, channels and supported countries or plans | Use an internal blueprint registry keyed by model and version. Read deployment availability, required capabilities and plan flags from the server. |
| Reuse and version history | Set expectations for how an existing business upgrades | Record the blueprint version on each business. Show an upgrade preview, new steps and migration effects when supported. Keep compatibility rules in backend code. |

**States:** Available, waitlisted, plan restricted, unsupported region, upgrade available.
**Acceptance:** Disabled blueprints cannot be provisioned by calling the API directly.

---

## 08 / Discover, build and launch — Build Room

Route: `/app/[business]/build` · Release: **First release** · Brief IDs: A03, G01, G04, I04, I05, I06

Show what is being built, which work can proceed and where the owner is needed.
**Primary action:** Review my launch kit

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Live build timeline | Show brand, product, files, website, checkout setup and first marketing campaign with substeps | Persist step records, dependencies and attempt state in Postgres. Use polling or an existing realtime transport. Derive progress from required steps completed. |
| Output cards and previews | Open each generated asset as soon as it is ready | Link to private file previews, catalogue drafts and site preview routes. Show version, quality results, what is editable and the CTA to the relevant workspace. |
| Blockers, retries and approvals | Show the exact owner action and why it matters while independent work continues | Use workflow checkpoints, explicit approval records and task-scoped retries. On reconnect or restart reconcile persisted state. Use stable action keys for external effects. |

**States:** Queued, running, blocked, paused, retry scheduled, partial output, complete, cancelled.
**Acceptance:** A payment onboarding blocker leaves independent product and site draft steps running.

---

## 09 / Discover, build and launch — Launch checklist and seller setup

Route: `/app/[business]/launch` · Release: **First release** · Brief IDs: A03, A04, D03, E01, H04, I05, I06

Turn generated assets into a live business with visible readiness for store, checkout, delivery and marketing.
**Primary action:** Publish my store

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Business and seller details | Collect trading name, country, currency, support contact, seller details and policy inputs | Use schema-validated business records. Prefer Stripe-hosted identity collection. Keep curated links for business setup and show the owner where local requirements need confirmation. |
| Readiness checklist | Show product QA, site preview, payouts, checkout, delivery test and marketing permissions independently | Compute each readiness rule server-side from published version, valid product, payment capability, delivery result and integration scopes. Show fix actions linking to affected pages. |
| Publish and smoke check | Make a validated version public and immediately test the URL | Use in-house publisher with a version pointer, smoke check and rollback. Show whether checkout is enabled independently of site availability. Send a launch activity event. |

**States:** Draft, owner action, test only, store live and checkout pending, publish failed, paused.
**Acceptance:** A published store can show a useful product page while its buy button follows payment readiness.

---

## 10 / Owner home, brand and products — Business Overview

Route: `/app/[business]` · Release: **First release** · Brief IDs: H01, H04, G03, G06

Give the owner the next action, performance summary and operating status in one screen.
**Primary action:** Fix next issue

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Summary and operating status | Show visits, orders, gross sales, refunds, delivery, store URL and last update | Aggregate tenant-scoped order, delivery and analytics events. Use explicit empty states and correct date and currency formatting. Never infer that missing analytics means zero traffic. |
| Needs you and recent activity | Prioritise issues by effect on selling and delivering | Read a ranked list from health checks, approval records and workflow blockers. Show the exact action, its impact and the destination page. |
| Launch progress and daily brief | Summarise what happened and what to do next | Calculate completion from persisted build steps. Generate the brief from a bounded, structured business snapshot and link to underlying events. Cache and refresh on schedule. |

**States:** New setup, live, zero orders, data stale, degraded checkout, tenant switch.
**Acceptance:** Expired payment or delivery state shows a concrete action on the overview.

---

## 11 / Owner home, brand and products — Brand kit

Route: `/app/[business]/brand` · Release: **First release** · Brief IDs: C01, C06, I05, I06

Create and maintain the identity used across store, products and campaigns.
**Primary action:** Save brand version

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Name, audience, style and voice | Generate and edit names, positioning, palette, fonts and writing tone | Use a structured model call with the chosen idea as context. Store editable tokens and voice examples. Validate colours, type fallback and contrast in code. |
| Logo and creative assets | Manage approved logo, imagery, cover and exports | Use deterministic SVG or image generation for concepts, plus authorised uploads. Store originals privately and publish only approved variants. Maintain asset rights and provenance fields. |
| Impact preview | Show which site sections and products may use new brand values | Version brand records and compare generated output. Publish changes through explicit dependent jobs. Keep existing asset versions addressable for rollback. |

**States:** Generating, missing asset, invalid contrast, pending approval, saved, rendering failed.
**Acceptance:** An approved palette change is previewable without altering the current live store.

---

## 12 / Owner home, brand and products — Products and bundles

Route: `/app/[business]/products` · Release: **First release** · Brief IDs: C02, C03, C04, C05, C06, E07

Manage saleable products, samples and bundles from one catalogue.
**Primary action:** Create product

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Catalogue and filters | Find items by draft, QA, live, archived, type or category | Use a paginated product read model with preview thumbnail, price, version, sales, status and visibility. Keep mobile list compact and filters URL-backed. |
| Create and duplicate | Generate a new product from the business blueprint or duplicate an existing draft | Use an internal product schema and durable generation jobs. Allow duplication to create a new template ID. Run file and listing QA before availability changes. |
| Bundles and offers | Package products, set eligible coupons and preview savings | Store bundle relationships and price rules with versioned currency amounts. Resolve checkout eligibility on the server. Use Stripe discounts where supported by the chosen payment design. |

**States:** Empty, queued generation, QA failed, bundle component archived, draft versus live.
**Acceptance:** Archival preserves historical order and purchased-version references.

---

## 13 / Owner home, brand and products — Product editor and asset review

Route: `/app/[business]/products/[productId]` · Release: **First release** · Brief IDs: C02, C03, C05, C06, C07, I05, I10

Make a product ready to sell and see exactly which files the buyer receives.
**Primary action:** Approve product version

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Listing and options | Edit title, benefits, preview media, price, included files, tags and allowed custom inputs | Use shared schemas, validation and versioned save. Generate draft copy through the model. Calculate margins with actual fee and cost assumptions and display the inputs. |
| Product builder and preview | Create real planners, trackers, printable art and samples | Generate document structure with an AI model, render PDF via React PDF or the existing document pipeline, and create printables via a vetted image API plus crop and export workers. Use server-side template rendering for spreadsheets where supported. |
| Quality, versions and downloads | Spot missing files, unusable output or policy flags and restore a prior draft | Inspect MIME and dimensions, open rendered previews and validate file manifest, permission and ownership. Use private Storage and short-lived signed links. Record QA outcomes and approved published version. |
| Improvement suggestions | Show weak conversion, customer feedback and a possible variant | Calculate observed metrics first. Generate a proposal from recorded evidence, queue a new draft version and show a side-by-side diff. |

**States:** Generation, QA failed, preview only, approved, stale edit, version conflict.
**Acceptance:** A paid order still resolves the original purchased file after a new version is published.

---

## 14 / Owner home, brand and products — Files and asset library

Route: `/app/[business]/assets` · Release: **Next** · Brief IDs: C06, I05, I10, I11

Manage originals, public previews, generated exports and storage usage.
**Primary action:** Upload file

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Asset browser | Find brand assets, campaign assets, product masters and generated samples | Store business ID, content hash, MIME, file size, asset role and version in Postgres. Use object storage with public derivatives kept separate from protected masters. |
| Upload, review and replacement | Let users see what an asset is attached to before replacing it | Use signed upload URLs and content validation. Preserve existing published references by creating a new version and listing dependent products or posts. |

**States:** Uploading, invalid type, quarantined, orphaned, attached to live order, quota reached.
**Acceptance:** A private master URL cannot be retrieved without scoped access.

---

## 15 / Owner home, brand and products — Memberships and release packs

Route: `/app/[business]/memberships` · Release: **Expansion** · Brief IDs: C08, E07, G05

Sell recurring digital access and schedule new packs.
**Primary action:** Schedule a release

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Plan and pack calendar | Define recurring price, entitlement and release date | Use an internal membership product and versioned release schedule. Use Stripe recurring payment support where compatible with the connected seller setup. |
| Member access and renewal | Show who can download which pack and when | Project verified billing events into membership entitlements. Schedule release jobs, send notifications and keep membership archives scoped to active policy. |

**States:** Upcoming, active, past due, cancelled, pack failed, released.
**Acceptance:** Member access follows verified entitlement and release state across renewal and cancellation.

---

## 16 / Website, checkout and delivery — Website Studio

Route: `/app/[business]/website` · Release: **First release** · Brief IDs: D01, D02, D03, D04, D06, I10

Generate, edit, test and publish the founder's website using our in-house generator.
**Primary action:** Preview website

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Page tree and responsive preview | Show home, product, contact, policy, campaign and SEO routes in desktop and mobile | Render a versioned page schema with a shared component registry. Use the same renderer for authenticated previews and published stores. Link preview selection to the draft version. |
| Visual and natural-language editing | Change copy, layout, images or featured products with direct edits or a request | Map model responses to allowlisted patch operations validated in code. Show the proposed diff, validate links and render before save. Use optimistic concurrency for edits. |
| Publishing, history and rollback | Give the owner a stable public URL and recovery after a bad edit | Use an internal publish endpoint, version pointer, smoke checks and cache invalidation. Store publisher and release notes. Rollback updates the pointer and records an audit event. |
| Technical SEO checks | Show missing titles, social previews, invalid links and search visibility | Generate title, description, canonical, OG tags, structured data, sitemap and robots policy from published data. Exclude draft preview URLs from indexing. |

**States:** No site, generating, draft, preview, failed validation, publishing, live, paused, rollback.
**Acceptance:** Publish changes the live version once and rollback restores the prior output.

---

## 17 / Website, checkout and delivery — Domains and availability

Route: `/app/[business]/website/domains` · Release: **Managed URL first release · custom domain next** · Brief IDs: D05, H04, I03

Give the owner a shareable store URL and make optional domain setup understandable.
**Primary action:** Copy store link

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Managed store URL | Give every published business a stable slug | Use a unique reserved-word-aware slug and host-to-tenant mapping. Route canonical storefront URLs server-side. Provide redirect handling if a slug change is supported. |
| Custom domain setup | Show DNS instructions and verification status | Integrate the current hosting provider's domain API where supported. Use background DNS and certificate checks. Verify ownership before assigning a host to the tenant. |

**States:** Managed URL ready, slug unavailable, awaiting DNS, certificate pending, verified, broken mapping.
**Acceptance:** A domain cannot be attached to two tenants.

---

## 18 / Website, checkout and delivery — Seller payments and payouts

Route: `/app/[business]/payments` · Release: **First release** · Brief IDs: E01, E03, H02, H04, I03

Let a business accept shopper payments and understand payouts.
**Primary action:** Connect Stripe

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Hosted onboarding | Guide identity and payment capability verification | Create or reuse a Stripe Connect account using server-side APIs. Generate short-lived hosted onboarding links. Check account and capability status from Stripe events and server retrieval on return. |
| Payment readiness and reconciliation | Show what needs attention and which sales or payouts are delayed | Map provider states to app readiness. Separate charges from payouts. Reconcile payment, refund and fee records in a ledger. Deep-link to authorised Stripe tools when necessary. |
| Test checkout | Confirm the seller flow before treating the checkout as ready | Use separate test and production credentials and UI labels. Run a sandbox purchase with a known price and verify the resulting order and delivery. |

**States:** Disconnected, pending identity, additional action, charges active, payout hold, restricted.
**Acceptance:** Returning from hosted onboarding alone does not enable payment.

---

## 19 / Website, checkout and delivery — Orders and fulfilment queue

Route: `/app/[business]/orders` · Release: **First release** · Brief IDs: E03, E04, E05, E06, H02, G07

Find transactions and prioritise orders requiring action.
**Primary action:** Open order

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Order filters and totals | Search by order ID, product, date, payment state and delivery state | Query a scoped read model with pagination. Show amount, currency, source, buyer summary and two separate statuses. Restrict personal information by role. |
| Fulfilment queue | Surface delayed payment, failed email and personalised products being generated | Use durable workflow records and show next retry time. Route exceptional items to order detail, with no duplicate fulfilment on repeated provider events. |

**States:** Empty, processing, paid, failed delivery, refunded, disputed, provider delayed.
**Acceptance:** Payment pending and delivery pending are visually distinguishable.

---

## 20 / Website, checkout and delivery — Order detail and recovery

Route: `/app/[business]/orders/[orderId]` · Release: **First release** · Brief IDs: E03, E04, E05, E06, G07, I06

Give the owner one record for what was purchased, paid and delivered.
**Primary action:** Resolve order issue

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Order timeline and receipt | Show price, fees, discounts, tax if enabled, payment history and purchased version | Store immutable checkout and product snapshots. Validate signed Stripe events and deduplicate by provider event ID and by the logical fulfilment key. |
| Secure delivery and personalised files | Allow safe reissue and visibility into bespoke generation | Use verified entitlements and short-lived signed URLs. After payment, queue validated custom options for rendering. Keep buyer uploads private and scan as appropriate. Distinguish file ready from delivery email failed. |
| Refund or dispute action | Handle customer requests without losing an audit trail | Gate authorised actions by role, use Stripe API or dashboard handoff, record reason and reconcile webhook outcome. Show full, partial and disputed states. Apply the recorded entitlement policy. |

**States:** Unpaid, pending, delivered, failed, expired access, partly refunded, disputed.
**Acceptance:** A duplicate provider event cannot duplicate orders, delivery or refund records.

---

## 21 / Website, checkout and delivery — Public storefront and collection

Store host: `/` · `/collections/[slug]` · Release: **First release** · Brief IDs: D01, D02, D06, E07, F08

Help a shopper discover products from a lightweight, branded site.
**Primary action:** Shop products

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Home and product collection | Show hero, value proposition, featured items, search or categories and store identity | Use our shared storefront renderer backed by published tenant snapshots. Query only live products. Use responsive assets, accessible navigation and store-scoped caching. |
| Sample, policies and support | Capture shoppers who want a preview and make seller terms easy to find | Use the same public form and consent service as the marketing workspace. Link tenant policy, contact and support routes. Keep account-specific fields out of the public payload. |

**States:** Empty collection, unpublished host, unavailable product, paused store, checkout unavailable.
**Acceptance:** No draft product or private master appears in public page data.

---

## 22 / Website, checkout and delivery — Public product detail

Store host: `/products/[slug]` · Release: **First release** · Brief IDs: D02, D06, D07, E02, E05, E07

Explain exactly what a shopper receives before they buy.
**Primary action:** Buy now

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Product story, preview and specifics | Show what is included, file formats, sample, options, license and support | Read the published catalogue snapshot. Serve public preview derivatives and accurate structured data. Validate personalised inputs or uploads on the server. |
| Buy now and offer rules | Send a shopper to a correct checkout with minimal friction | Resolve price, version, bundle eligibility and currency from server-side data, then create a Stripe session. Add product-view and checkout-start events with campaign context. |

**States:** Available, disabled checkout, missing option, changed price, removed product.
**Acceptance:** Changing a client-side price never changes the charge.

---

## 23 / Website, checkout and delivery — Hosted checkout and order confirmation

Store host: `/checkout/return` · Release: **First release** · Brief IDs: E02, E03, E04, E07

Accept payment and show the buyer what happens next.
**Primary action:** View my order

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Stripe Checkout handoff | Collect payment through a mobile-ready provider surface | Create Checkout Sessions on the server using seller account, order intent and immutable purchase snapshot. Use Stripe-hosted payment UI and verify the return token or session access. |
| Pending, paid and failed return states | Handle asynchronous payments before the webhook arrives | Render status from the scoped order API. Reconcile signed webhooks and show pending progress until server-confirmed payment. Notify the buyer when delivery is ready. |

**States:** Abandoned, pending, failed, confirmed, link invalid.
**Acceptance:** Opening a success URL without verified payment never grants a download.

---

## 24 / Website, checkout and delivery — Buyer downloads, recovery and support

Store host: `/downloads/[token]` · `/recover-order` · `/contact` · `/policies/[slug]` · Release: **First release** · Brief IDs: E04, E05, E06, G07, I08, I11

Help the shopper get the purchased file or recover access safely.
**Primary action:** Download my files

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Entitlement and file picker | Show eligible files, order summary and link expiry | Verify a short-lived buyer token, tenant and order entitlement. Generate signed links for entitled objects only. Log delivery events without exposing secrets. |
| Order recovery and contact | Reissue access and route order questions or refunds | Use email verification or single-use recovery links with rate limits and neutral responses. Use Resend or the existing email provider for delivery and a ticket record for requests. |
| Seller policies | Show terms, refund information, privacy and contact for the correct business | Render versioned seller-approved policy content from our own published store records. Record the policy version linked to checkout when needed. |

**States:** Unpaid, generating, ready, expired, revoked, delivery delayed, request submitted.
**Acceptance:** One buyer cannot recover another buyer's entitlement by guessing an order identifier.

---

## 25 / Growth and customer communication — Marketing overview and strategy

Route: `/app/[business]/marketing` · Release: **First release** · Brief IDs: F01, F11, H03

Give the owner a plan to attract the first shoppers and see what is producing results.
**Primary action:** Review marketing plan

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Strategy and channel plan | Show buyer, positioning, offer, channels, expected effort, assets and suggested cadence | Use the business snapshot and dated evidence as input to a structured model. Render a versioned strategy with source links and explain prerequisites and assumptions. |
| Campaign goals and experiments | Connect planned marketing to measurable behaviour | Create an internal campaign record with channel, objective, target URL, UTMs, date range and success metric. Use first-party visit and order events to compare outcomes. |
| Priority actions | Surface disconnected channels, pending creative and low-volume results | Derive issue rank from readiness and metrics. Link to the specific asset, connection or campaign. Mark insufficient data before recommending major changes. |

**States:** Draft, reviewed, no connections, no traffic, data delayed, active campaign.
**Acceptance:** One campaign is traceable from creative to landing page and order where attribution is known.

---

## 26 / Growth and customer communication — Creative Studio

Route: `/app/[business]/marketing/creative` · Release: **First release** · Brief IDs: F02, F05, F06, F12, C06

Produce branded assets for a specific offer and channel.
**Primary action:** Generate creative

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Brief and format picker | Ask for campaign, channel, angle, asset type and offer | Use structured AI drafts for hooks, titles, copy and visual briefs. Use approved brand and product data. Store presets by channel and placement. |
| Image and video assets | Produce reusable Pins, static ads, carousels and later short clips | Compose branded text and layouts with in-house templates. Call an approved image API where needed. Add video rendering via Remotion or the existing media worker when warranted. |
| Version, QA and export | Review asset, copy, format, accessibility text and rights claims | Store versioned previews and source references. Validate dimensions, file size, URL and link. Download assets or hand them off to calendar. Keep provider publishing separate. |

**States:** Queued, generating, failed, flagged, draft, approved, exported.
**Acceptance:** An approved Pin package includes asset, title, description and tracked destination.

---

## 27 / Growth and customer communication — Calendar, scheduling and organic publishing

Route: `/app/[business]/marketing/calendar` · Release: **Draft and export first release · connected publishing next** · Brief IDs: F03, F04, F05, F06, G02, G05

Make a repeatable publishing schedule visible and recoverable.
**Primary action:** Schedule post

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Calendar and queue | See drafts, local time, channel, campaign, state and approval need | Persist post variants and scheduled UTC timestamps with timezone context. Use a durable scheduler and display list view on mobile. Check policy and connection at dispatch. |
| Pinterest workflow | Publish approved Pins and track clicks where available | Use Pinterest API on a reviewed and authorised integration, select an eligible board, store provider Pin ID, and reconcile published state. Offer manual export immediately. |
| Social channel adapters | Publish eligible Instagram, Facebook and TikTok assets | Use official platform APIs with account type and permission checks. Implement channel-specific validation, approval and response mapping. Track error, retry and reauthorisation without blindly duplicating a post. |

**States:** Draft, approved, scheduled, submitting, published, failed, permissions expired, disconnected.
**Acceptance:** Disconnecting a channel stops future sends and preserves the draft.

---

## 28 / Growth and customer communication — SEO workspace

Route: `/app/[business]/marketing/seo` · Release: **Technical checks first release · insights next** · Brief IDs: D06, D07, F07, H03

Improve search readiness and show what search traffic is doing.
**Primary action:** Fix SEO issue

| What is on the screen | Purpose | How to build it |
|---|---|---|
| SEO tasks and page briefs | Surface technical issues, missing copy and content opportunities | Run internal crawler against published URLs. Generate suggestions from tracked page content and evidence. Save proposed changes as page drafts. |
| Search Console dashboard | Show impressions, clicks and query/page trends for a connected property | Use Google Search Console API after appropriate property access. Store import time, date window and source. Clearly label low-volume or unavailable data. |

**States:** Site unpublished, scan running, property unverified, no data, stale data, task resolved.
**Acceptance:** Search Console failure leaves built-in metadata checks usable.

---

## 29 / Growth and customer communication — Lead capture and forms

Route: `/app/[business]/marketing/leads` · Release: **First release** · Brief IDs: F08, F09, I09, I11

Turn store interest into a permissioned audience.
**Primary action:** Create opt-in form

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Form and sample builder | Create a form, consent text and sample delivery tied to a campaign | Render in-house public form blocks with schema validation and rate limits. Use double opt-in where configured. Persist purpose, text version, source, timestamp and consent decision. |
| Subscriber capture and attribution | Show submissions, confirmed contacts and sample deliveries | Deduplicate by business and normalised contact, record UTMs, and queue confirmation or delivery by event. Keep transactional messages and marketing consent separately scoped. |

**States:** No submissions, confirmation pending, subscribed, suppressed, bounced, form disabled.
**Acceptance:** An unsubscribed contact does not enter a marketing sequence.

---

## 30 / Growth and customer communication — Email and follow-up automation

Route: `/app/[business]/marketing/email` · Release: **Sample delivery first release · sequences next** · Brief IDs: F09, G02, G05, I11

Send transactional emails and eligible opt-in campaigns with visible results.
**Primary action:** Create sequence

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Sequence builder | Create welcome, newsletter, launch and eligible reminder journeys | Store triggers, delays, stop conditions and versions in Postgres. Use durable jobs for waits, fetch current consent at send time, and cancel obsolete runs. |
| Sender and campaign health | Show verified sender, delivery, bounces, complaints and unsubscribes | Use Resend or the existing provider for sends and signed webhooks. Separate transactional and marketing templates and apply suppression and opt-out state. |

**States:** Sender unverified, scheduled, sending, completed, bounced, opted out, paused.
**Acceptance:** Withdrawing consent after scheduling cancels later marketing sends.

---

## 31 / Growth and customer communication — CRM and contacts

Routes: `/app/[business]/contacts` · `/contacts/[contactId]` · Release: **Next** · Brief IDs: F08, F09, F10, G07, H03, I11

Give the owner a scoped history of leads and buyers.
**Primary action:** Open contact

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Contacts, segments and consent | Filter by source, lifecycle, orders, tags or permission status | Use a tenant-scoped contact index and versioned segment queries. Store communication preferences by channel and purpose. Log who changed consent. |
| Contact history | See order, form, campaign, support and conversation context | Assemble read models from scoped order, event and ticket records. Restrict sensitive data by role. Provide export and deletion workflows with audit. |

**States:** No contacts, duplicate, opted out, deleted, forbidden, stale sync.
**Acceptance:** Tenant A contact search never returns tenant B contacts.

---

## 32 / Growth and customer communication — Unified inbox and customer care

Routes: `/app/[business]/inbox` · `/inbox/[threadId]` · Release: **Next** · Brief IDs: F10, G07, I08, I06

Reply to buyer questions using verified store and order context.
**Primary action:** Review reply

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Thread queue and case detail | Triage order, product, refund and support requests with status and ownership | Start with storefront support and authorised inbound email. Add supported DMs through provider adapters. Normalise sender, channel, provider ID and permissions. |
| AI drafts and human handoff | Prepare replies, order status and verified link recovery | Retrieve only approved FAQs and authorised order details. Produce a reviewable draft. Constrain automated actions to explicit rules. Send through the applicable channel adapter and record outcome. |
| Voice or bookings add-on | Offer phone handling for business types with genuine need | Reuse Ventra front-office components where verified. Connect Twilio Voice and a supported calendar adapter in expansion. Route requests without permissions or reliable context to the owner. |

**States:** New, assigned, waiting, failed reply, handoff, resolved, messaging window closed.
**Acceptance:** An order recovery action checks buyer entitlement before exposing the link.

---

## 33 / Growth and customer communication — Ads, budgets and experiments

Route: `/app/[business]/marketing/ads` · Release: **Expansion** · Brief IDs: F11, F12, G02, G08, H03, I06

Prepare and measure paid campaigns within the owner's approved budget.
**Primary action:** Review campaign draft

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Draft campaign and creative test | Show audience, objective, creative variations, destination, expected signals and limits | Build draft objects internally. Connect the chosen ad account using Meta Marketing API or Pinterest Ads API only when eligible. Validate each provider's required fields and permissions. |
| Budget, approval and pause controls | Let the owner approve scope and cap spend | Use a recorded approval for account, daily and lifetime limits and campaign duration. Reconcile provider spend, flag stale data and provide a pause action. Keep provider caps where available. |
| Experiments and results | Connect spend to visits, sales and contribution | Use provider campaign metrics plus first-party attribution. Display attribution windows and unknown conversion sources. Propose a next test from sufficient evidence. |

**States:** Draft, awaiting approval, review, active, paused, capped, provider rejected, spend delayed.
**Acceptance:** Campaign submission requires matching approval and a configured budget.

---

## 34 / Automation, reporting and account management — Business Operator and job detail

Routes: `/app/[business]/operator` · `/operator/[runId]` · Release: **First release** · Brief IDs: G01, G02, G04, G05, I04, I06

Show what is running, what is waiting and what can safely be retried.
**Primary action:** Open job

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Jobs and dependency view | Show build jobs, daily checks, scheduled tasks and affected outputs | Use the existing durable runner if adequate, otherwise Trigger.dev. Persist product-facing step status, next run, attempts and artefact IDs in Postgres. Display internal trace IDs only to authorised staff. |
| Run detail and recovery | Explain cause, affected step and recovery action | Classify transient and permanent errors, back off on transient failures and isolate retry to the relevant step. Use idempotency keys and provider reconciliation before retrying external effects. |
| Automation controls and schedule | Let the owner set channel, cadence, generation budget and permission level | Persist rules per business and recheck them at execution time. Show what pause affects, which jobs are in flight and when schedules will resume. |

**States:** Scheduled, running, retrying, blocked, paused, complete, cancelled.
**Acceptance:** Retry resumes work without publishing the same item twice.

---

## 35 / Automation, reporting and account management — Approvals and activity

Routes: `/app/[business]/activity` · `/approvals` · Release: **First release** · Brief IDs: G02, G03, I06

Give the owner a clear history and a single place to approve consequential changes.
**Primary action:** Review approval

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Activity feed | Show business events and explain what changed | Use an append-only event projection with actor, business, target, timestamp and result. Filter by jobs, publishing, payments, marketing and support. |
| Approval inbox | Review site releases, price changes, refunds and paid actions when required | Store a versioned action payload and approval scope. Show before and after, related business, expiry and effect. Revalidate permissions and payload version before execution. |
| Notifications | Show unread state and route to relevant tasks | Persist notification preferences and delivery status. Deduplicate each notification per event, audience and channel. Send email only when configured. |

**States:** Nothing pending, unread, approval stale, rejected, action completed.
**Acceptance:** Approving an old version never authorises the replacement version.

---

## 36 / Automation, reporting and account management — Analytics and attribution

Route: `/app/[business]/analytics` · Release: **Core metrics first release · advanced analysis next** · Brief IDs: D07, F11, H01, H02, H03, H04

Explain traffic, orders, refunds and costs using reconciled data.
**Primary action:** View performance

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Funnel and source reports | Show visits, product views, checkout starts, paid orders and refunds | Capture a versioned first-party event set and stitch with consent-aware campaign keys and authoritative order IDs. Distinguish unknown attribution and unavailable data. |
| Revenue, costs and margin | Show gross, discounts, refunds, platform fees, costs and estimated contribution | Use Postgres views or aggregates over currency-safe records. Read Stripe fee and payment records and import provider spend when connected. Label modelled and observed values. |
| Health and performance detail | Show data freshness, last sync and low-volume periods | Track ingestion watermarks per provider. Support date range, timezone and CSV export. Reconcile attribution sums to event definitions and never merge currencies silently. |

**States:** Zero activity, delayed data, stale provider, multi-currency, estimates only.
**Acceptance:** Refunded orders reconcile across order and analytics totals.

---

## 37 / Automation, reporting and account management — Business Advisor and improvements

Route: `/app/[business]/advisor` · Release: **Next** · Brief IDs: G06, C07, D07, F11

Explain an observed business issue and turn suggestions into reviewable changes.
**Primary action:** Review suggested change

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Daily brief and questions | Answer using current order, traffic, support and job context | Give the model a scoped, bounded business snapshot and source IDs. Show evidence, uncertainty and data timestamp. Cache historical briefs. |
| Draft change and experiment | Translate a recommendation into a product, site or campaign draft | Use typed action proposals with impact, diff and metrics. Send the draft to its owning workspace for review and record an experiment baseline. |

**States:** No history, insufficient data, stale metric, draft ready, rejected, applied.
**Acceptance:** The advisor cannot apply a spend change or publish without matching permissions.

---

## 38 / Automation, reporting and account management — Business settings, team and data

Route: `/app/[business]/settings` · Release: **Core settings first release · team access next** · Brief IDs: A01, A04, I02, I06, I10, I11, I12

Manage business identity, members, preferences, data and pause or closure.
**Primary action:** Save settings

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Business identity and preferences | Edit timezone, currency policy, seller profile and support contact | Update scoped business records through validated server mutations. Protect currency and legal fields that affect active checkout. Apply notification preference changes to future jobs. |
| Roles and invites | Allow the owner to grant the minimum necessary access | Use a membership table, explicit roles and server authorisation backed by RLS. Use expiring invite tokens and log role changes. |
| Export, backup and closure | Allow export, operational pause and recovery where available | Create a durable export and private download. Keep retention, deletion and audit policies explicit. Cancel new schedules on pause and surface unresolved orders before closure. |

**States:** Read-only, invitation pending, export queued, owner-only action, paused, closure pending.
**Acceptance:** Removing a role prevents the next protected request and job action.

---

## 39 / Automation, reporting and account management — Integrations and permissions

Route: `/app/[business]/integrations` · Release: **Stripe first release · additional providers next** · Brief IDs: F03, F06, E01, H04, I03, I06, I12

Connect provider accounts and show precisely what each connection permits.
**Primary action:** Connect account

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Connection cards | Show connected identity, permissions, expiry and recent health | Build adapters for Stripe, Pinterest, Meta, TikTok, Search Console and email as applicable. Use provider OAuth or hosted onboarding, with server-stored encrypted credentials and minimal scopes. |
| Test, reconnect and disconnect | Recover expired access and stop future actions where supported | Run scope and health checks, refresh credentials, and remove or revoke connection on disconnect. Disable affected schedules while retaining work history. |

**States:** Unconnected, authorising, scope missing, expired, provider review, revoked.
**Acceptance:** Disconnect affects the selected business only and queued publishing checks connection again.

---

## 40 / Automation, reporting and account management — Account billing and usage

Route: `/account/billing` · Release: **First release** · Brief IDs: G08, I01, I12

Let a founder manage their AiMoneyPrinter subscription and see usage.
**Primary action:** Manage plan

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Subscription and invoices | Show tier, renewal date, failed payment and invoice history | Use Stripe Billing and Customer Portal. Store plan entitlements from verified billing events. Keep the founder subscription distinct from the business's shopper payments. |
| Usage limits and reset date | Explain included jobs, remaining allowance and consequences of reaching limits | Maintain a server-side usage ledger by tenant and account. Reserve quota before expensive jobs, settle actual usage and expose a time-windowed read model. |

**States:** Trial, active, past due, cancelling, quota reached, usage delayed.
**Acceptance:** Provider billing changes reconcile without blocking unrelated order fulfilment according to configured policy.

---

## 41 / Automation, reporting and account management — Portfolio and business switcher

Route: `/app/businesses` · Release: **Switcher first release · portfolio next** · Brief IDs: H05, I02, I12

Navigate between business workspaces and compare their status when available.
**Primary action:** Open business

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Business picker and create | List accessible businesses with name, URL, build stage and issue count | Query server-authorised memberships. Store the last selected business per user. Launch a new discovery flow if the plan permits. |
| Portfolio performance | Compare business trends and operational issues across eligible stores | Aggregate permitted workspaces by period and currency. Show partial data and exclude inaccessible tenants from totals. |

**States:** No businesses, one business, quota reached, restricted, mixed currency.
**Acceptance:** Pasting a URL for an inaccessible tenant does not reveal its name or data.

---

## 42 / Automation, reporting and account management — Help and support cases

Routes: `/help` · `/account/support/[caseId]` · Release: **First release** · Brief IDs: A01, G07, I08, I11

Resolve account, product and technical issues without forcing a founder into email alone.
**Primary action:** Get help

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Help centre and troubleshooting | Guide users through common launch, payment, delivery and connection issues | Use curated documentation and context links from issue codes. Keep the public and signed-in help experiences distinct where they expose account data. |
| Submit and track a case | Let founders report an issue and see replies or requested information | Use an internal ticket system or an approved helpdesk API. Attach safe identifiers and consented files. Record case status, owner and notifications. |

**States:** Public help, signed-in case, attachment rejected, awaiting reply, closed, reopening.
**Acceptance:** A founder sees only their own cases or cases their role permits.

---

## 43 / Internal operations — Platform operations console

Route: `/internal/operations` · Release: **Minimum support tools first release · broader tools next** · Brief IDs: I04, I05, I06, I07, I08, I09, I10, I12

Give authorised staff a way to investigate failures, enforce limits and support customers.
**Primary action:** Open incident

| What is on the screen | Purpose | How to build it |
|---|---|---|
| Tenant and incident views | Find affected business, order, build run and provider health | Use staff-only server access with role checks, tightly scoped read models and masked customer fields. Link logs by trace ID using the current monitoring system. |
| Safe intervention and feature flags | Allow justified retries, restoration, rollout control and escalation | Use a dedicated service layer with logged operator identity, reason, target and before/after state. Store rollout rules and check entitlements at both server and UI. |

**States:** Restricted, degraded, incident open, retryable, suspended, restored.
**Acceptance:** A customer account cannot reach internal actions, and every staff mutation produces an audit record.

---

## Technology and provider references — API and plugin decisions

**Core platform:** Reuse the existing Next.js and React app, in-house website generator, auth and database. Supabase is the proposed default where Ventra already uses it. *Supabase RLS · Storage access*

**AI generation and research:** Use a server-side model adapter with schema validation. The existing provider can stay in place. A web search tool can supply evidence with retrievable sources. *OpenAI web search · Structured outputs*

**Async work:** Reuse the existing durable runner if it covers retries, scheduling and idempotency. Trigger.dev is a proposed replacement only if the existing runner cannot meet those needs. *Trigger.dev*

**Commerce:** Use Stripe Connect for seller onboarding and Stripe Checkout for the buyer flow. Confirm the connected-account and payment design in test mode. The app subscription uses a separate Stripe Billing flow. *Checkout fulfilment · Connect onboarding · Billing*

**Marketing:** Build drafts, calendar, consent and attribution internally. Use provider adapters only after account connection and applicable approval. Provider access is checked separately for posting, messages, analytics and ads. *Pinterest · Meta Instagram · Meta Marketing · TikTok · Search Console*

**Messages and voice:** Reuse the current email provider or evaluate Resend. Voice is an expansion option via Twilio. Keep actual platform permissions and consent in the app. *Resend webhook events · Twilio Voice*

**Build plugins:** Figma MCP helps Claude read design frames. Playwright Test verifies the product. Supabase MCP and Stripe test tools can aid development when configured. Production screens use application APIs and provider SDKs.

---

## Note for engineering

Route paths, selected providers and release ordering above are **proposed by this spec, not finalised**. Before treating any route, release label or provider choice here as binding:

1. Cross-check Brief IDs against `docs/aimp/FEATURE_CHECKLIST.md` and `docs/agents/AIMP_FEATURE_MAP.json` for the authoritative feature list, release tier and current build status.
2. Cross-check shared-service contracts above against `docs/aimp/contracts/README.md` and `docs/aimp/contracts/CANONICAL_STATES.md` for anything already decided or still open (5 open canonical-state decisions as of 14 Nov).
3. Where this spec's route differs from a route already live in the repo, the repo wins — flag the discrepancy rather than silently renaming a shipped route.

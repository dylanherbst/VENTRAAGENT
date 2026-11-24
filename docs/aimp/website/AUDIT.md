# Public website audit: /plant-lab and /plant-lab/build

Task AMP-068 (part 1 of 6). Date: 14 Nov 2026. Evidence level: **read from code only (Local)**. Nothing was run, rendered, measured or opened in a browser. Anything described as "seen in code, not measured" is exactly that. No code was changed.

Sources read: `apps/web/app/plant-lab/**`, `apps/web/lib/aimp/plant/timeline.ts`, `apps/web/lib/aimp/site-config.ts`, `apps/web/lib/aimp/analytics.ts`, `apps/web/public/plant/**` (file list only), `apps/web/test/aimp-plant-timeline.test.ts`, `docs/aimp/reference/text/Website_CTA_Strategy.txt`, `Frontend_Backend_Build_Brief.txt` (section 2 and section 6), `Page_By_Page_Build_Specification.md` (screens 01-03 and the shared contract), `docs/aimp/FEATURE_CHECKLIST.md`, `docs/aimp/README.md` (Website section). Read-only look at `apps/web/app/start/{page,flow,account/page}`, `apps/web/app/workspace/page.tsx`, `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`.

---

## 1. What exists today

### Routes under /plant-lab

| Route | File | What it renders (from code) | State |
| --- | --- | --- | --- |
| `/plant-lab` | `apps/web/app/plant-lab/page.tsx` | One long server-rendered page. Fixed header (logo, 4 anchor links, "Build My AI Business"). Pinned seed-to-tree story with four chapters (hero, foundation, creation, growth). Sections: Watch demo (`#watch`), Two clicks (`#how`) plus "After you launch" with Live now / In pilot / Coming soon labels, Businesses you can start (`#build`, from `lib/aimp/preview/blueprints`), Pricing (`#pricing`, from `site.plans`), "What we will never promise", FAQ (`#faq`, 5 items), final CTA, footer with support mailto. | Working. Copy has problems (section 4). |
| `/plant-lab#story` stills | `page.tsx` `Still()` | `<picture>` of `public/plant/stage-{seed,planted,sprout,tree}-{desktop,mobile}.webp`. Used for first paint, no-JS, no-WebGL, reduced motion. | Working (files exist; not opened). |
| 3D scene | `_scene/story-canvas.tsx`, `_scene/plant-scene.ts`, `lib/aimp/plant/timeline.ts`, `public/plant/plant.glb`, `branches.json` | Client component, dynamic `import('./plant-scene')`, bound to scroll progress, stops when offscreen or hidden. Falls back to stills on reduced motion, no WebGL, or load error. Fires `story_stage_view`. | Working in code; not run by me. |
| `/plant-lab` demo | `watch-demo.tsx` | Client tabs (Choose / Preview / Launch) that run the real `generatePreview()` for one fixed sample (`digital-templates`, `teacher-planners`). Play is user-started, never autoplays. Labelled with `previewLabel`. Link "Try it with your own answers" to `/plant-lab/build?model=digital-templates`. | Working. |
| `/plant-lab/build` | `build/page.tsx`, `build/build-flow.tsx`, `build/state.ts` | Server page reads `?model&niche&seed&step&plan` into state; client flow with history push/replace and back/forward. noindex. Header has "Sign in" link to `/workspace`. | Working. |
| Step 1 Choose | `build/choose-step.tsx` | 6 model cards from `blueprints`, plus "Choose for me" (3 taps: budget, hours, interest, via `recommend()`), then niche cards, then "Show my preview". Fires `model_select`, `recommend_request`, `preview_start`. | Working. |
| Step 2 Preview | `build/preview-step.tsx` | 5-stage progress list (300 ms each, instant under reduced motion), then name, tagline, offer, products and bundle, store config validated with `validateStoreConfig`, rendered storefront mock, pricing direction, profit calculator, 3 Pinterest pin drafts, "Save & Launch My Business". Labelled with `p.label`. Fires `preview_complete`. | Working. Output is a deterministic blueprint, not AI-personalised (the label says so). |
| Step 3 Launch | `build/launch-step.tsx` | Plan chooser from `site.plans`, "What you'll connect", "What needs your approval", honest-status note, `Save & Launch My Business` link to `/workspace?plan=<id>&from=build`, and a "Join the pilot" mailto. Fires `plan_select`, `signup_click`, `launch_view`. | Working, but the sign-up link goes to the wrong place and drops the preview (sections 2 and 6). |
| Profit calculator | `build/profit-calculator.tsx` | Inputs: price, sales per month (user estimate), plan, GST. Outputs fees and "you keep". No forecasts. | Working. |
| Support files | `tracked-link.tsx`, `fonts.ts`, `tokens.css`, `plant.css`, `build/build.css`, `build/icons.tsx` | Link wrapper that fires `cta_click`; fonts; styles. | Working. |

### Supporting code

- `apps/web/lib/aimp/site-config.ts`: `site.name = 'Seedline'` (working name), `workingName: true`, `domain` and `supportEmail` on `aiventra.com.au`, four draft plans (Discover free, Launch A$79, Autopilot A$149, Scale A$249).
- `apps/web/lib/aimp/analytics.ts`: `track()` pushes to `window.dataLayer` and dispatches `aimp:track`. No vendor, no server endpoint, no storage. Event names: `hero_view`, `cta_click`, `story_stage_view`, `model_select`, `recommend_request`, `preview_start`, `preview_complete`, `launch_view`, `signup_click`, `plan_select`, `skip_animation`.
- Tests: only `apps/web/test/aimp-plant-timeline.test.ts` (timeline stages, determinism, continuity, story beats). **No `aimp-website-*` test exists.** `aimp-preview.test.ts` and `aimp-profit.test.ts` exist for the preview and profit libraries (not read in depth, not mine).
- Not found: any page for privacy, terms, contact, pricing, FAQ, how-it-works or examples as their own routes; any `/start` reader of preview data; any headline variant code; any server-side event sink.

---

## 2. Screens and CTA rules: present / partial / missing

Feature IDs: the checklist has **no dedicated ID for the marketing site itself**. The IDs below are the ones the page-by-page spec attaches to each screen (A01, B01, I01, G08, I12, I08, I09) plus the product features the preview exercises (B04, B05, C05). Their checklist state is `[ ]` for all of them.

| # | Item | Status | Where | Feature ID | Note |
| --- | --- | --- | --- | --- | --- |
| R1 | Home and product demo (brief s2) | partial | `plant-lab/page.tsx` | B01 | Exists only as a lab route; headline differs from brief (R16). |
| R2 | Product demo "Watch AI Build a Business" | present | `plant-lab/watch-demo.tsx`, `#watch` | B05 | Uses the real generator; one fixed sample. |
| R3 | How it works | partial | `page.tsx:147-182` (`#how`) | none | A section, not a page. 3 steps plus after-launch list. |
| R4 | Examples | partial | `page.tsx:184-205` (`#build`) | B04 | Shows blueprints, not real or sample finished stores. No link to a sample store. |
| R5 | Pricing and plan comparison | partial | `page.tsx:207-227`, `site-config.ts` | I01, G08, I12 | Cards only: no comparison matrix, no billing-frequency state, no fees explainer beyond one line. Labelled "Pilot pricing, being tested", not "draft". |
| R6 | FAQ | partial | `page.tsx:41-47, 240-252` | none | 5 questions. No cancellation, data, refund or "what does not work yet" questions. |
| R7 | Sign-up | partial | `build/launch-step.tsx:27` | A01 | Link exists but targets `/workspace` (old VENTRA page), not `/start`. |
| R8 | Sign-in and recovery | missing | only `build/page.tsx:29` "Sign in" to `/workspace` | A01, I08, I09 | Recovery pages not found. Sign-in exists inside `/start/account?mode=login` (not mine). |
| R9 | Contact | partial | `page.tsx:267` footer mailto | none | Email only. No contact page or form. |
| R10 | Privacy | missing | none | I11 | Not found. No footer link. |
| R11 | Terms | missing | none | none | Not found. No footer link. |
| R12 | Two-click preview flow | present | `build/*` | B05, B04 | Choose model or "Choose for me" then preview, no long form. |
| R13 | "Save & Launch My Business" with real price, plan, connections, approvals | present | `launch-step.tsx` | C05, I01 | Prices are draft hypotheses. |
| R14 | Carry the preview into sign-up | missing | none | A01 | `signupHref` carries only `plan` and `from=build`. Model, niche, seed and brand name are dropped. Confirmed in README as open. |
| R15 | Eyebrow "THE NEXT WAVE OF ONLINE BUSINESS" | present | `page.tsx:83` | none | Written in sentence case; brief shows capitals. Whether CSS uppercases it was not checked (`.amp-eyebrow` is in `tokens.css`, not read). |
| R16 | Headline "The AI boom is here. Build a business from it." | missing | `page.tsx:84` | none | Page says "Your 6-figure business is just a few clicks away." The brief headline appears nowhere on the page. |
| R17 | Supporting line (AI builds offer, website, marketing, and helps automate) | partial | `page.tsx:85` | none | Different wording; adds "niche and product finder guided by our Profitability Calculator". The calculator in code only does arithmetic on the user's own estimates. |
| R18 | Primary CTA visible without scrolling | partial | `page.tsx:88`, header `:67` | none | Header CTA is always visible. Hero CTA position on a 320-390 px phone is **not measured** (hero copy has `padding-top: 33svh` plus lead, journey line, then actions; `plant.css:71`). |
| R19 | Secondary CTA subordinate | present | `page.tsx:89` | none | `amp-btn-secondary`, goes to `#watch`. |
| R20 | Reassurance line | present | `page.tsx:91` | none | Exact wording. |
| R21 | Large restrained type, charcoal primary button | present | `plant.css:35-38`, `tokens.css` | none | Charcoal primary seen in build.css (`--amp-charcoal`). Contrast not measured. |
| R22 | 3D seed beside hero (desktop) and above copy (mobile) | present | `plant.css:46-79` | none | Mobile pads the copy down 52svh to leave room for the plant. Not seen rendered by me. |
| R23 | Seed-to-tree stages: headline plus button each | partial | `page.tsx:79-135, 254-261` | none | Stage 1 headline wrong (R16). Stage 2 "See How It Works", stage 3 "Create My Business", stage 4 "Activate My Business", final "Your next business starts here." + "Get Started" all match the brief. |
| R24 | Choose a model or "Choose for me" | present | `choose-step.tsx:88-110` | B04 | |
| R25 | Real personalised preview: name, offer, design, pricing direction, marketing | present | `preview-step.tsx` | B05 | Real generator output, but deterministic from a blueprint; labelled as a sample. |
| R26 | Authentic proof (demos, verified results) | partial | `page.tsx:92-97` | none | No customer proof exists and none is invented (good). Third-party market statistics are used instead (section 4). |
| R27 | No fake urgency, guaranteed earnings, unsupported testimonials | partial | see section 4 | none | No timers, testimonials or scarcity found. Earnings-implying copy found at `page.tsx:84, 86`. |
| R28 | Honest Live / In pilot / Coming labels | partial | `page.tsx:34-39` | E02, E04 | Labels exist for four items. Some labels run ahead of the evidence and some body copy is in present tense (section 4). |
| R29 | Reduced motion, no-WebGL, no-JS fallbacks | present | `plant.css:81-92`, `story-canvas.tsx:20-23`, `build.css:244`, `preview-step.tsx:52` | none | Present in code. Not exercised by me. |
| R30 | Measurement: hero views, CTA clicks, selections, preview start and completion, sign-ups, purchases | partial | `analytics.ts` and call sites | none | `hero_view` and `skip_animation` are declared but **never fired** (grep found no call). No sign-up completion, no purchase event, no sink or vendor. |
| R31 | Headline A/B test (first test in brief) | missing | none | none | No variant assignment, no `variant` property on events. |
| R32 | Mobile vs desktop split | present | `analytics.ts:12` | none | `viewport` property on every event (width under 768). |
| R33 | Performance cost of the 3D hero measured | missing | none | none | No Lighthouse or timing capture in repo. README lists it as open. |
| R34 | Public site stays noindex | present | `page.tsx:15`, `build/page.tsx:13` | none | Metadata robots only (section 4). |
| R35 | Brand name read from `site-config.ts` | present | `page.tsx` uses `site.name` throughout | none | No hard-coded "Seedline" found (section 4). |
| R36 | Nav usable on mobile | partial | `plant.css:28-32` | none | Anchor nav is `display: none` below 900 px; only the header CTA remains. Seen in code, not measured. |

**Totals (36 rows): 14 present, 15 partial, 7 missing.**
Present: R2, R12, R13, R15, R19, R20, R21, R22, R24, R25, R29, R32, R34, R35. Partial: R1, R3, R4, R5, R6, R7, R9, R17, R18, R23, R26, R27, R28, R30, R36. Missing: R8, R10, R11, R14, R16, R31, R33.

---

## 3. Route mismatches against the page-by-page spec (flag only, nothing renamed)

| Spec (proposed) | Repo today | Flag |
| --- | --- | --- |
| Homepage at `/` (screen 01), primary action "Start my business" | `/plant-lab` (noindex lab route); `/` is the older VENTRA entry (not read). Primary CTA is "Build My AI Business" (the owner's strategy brief). | Keep `/plant-lab`. The strategy brief's CTA wording wins over the spec's. Homepage move is AMP-073 and needs owner approval. |
| `/pricing` (screen 02) | Pricing is the `#pricing` section on `/plant-lab`. No `/pricing` route. | Keep. Decide in AMP-070 whether pricing becomes a route under `/plant-lab/pricing`. |
| `/sign-up`, `/sign-in`, `/verify`, `/reset-password` (screen 03) | `/start` (welcome), `/start/account` (create, `?mode=login` for sign-in), `/workspace` (older VENTRA sign-in and workspace page). No verify or reset routes found. | Keep `/start/*`. The preview flow currently links to `/workspace`, which is the wrong product surface (section 6). |
| How it works, examples, FAQ, contact, privacy, terms | Not in the spec's 43-screen index (spec lists Homepage, Pricing, Sign-up only for the public site). They are in the owner brief section 2 only. | No spec route to compare. Route choice needed (open question 5). |
| "CTA opens onboarding for authenticated users or sign-up with a safe return path" | No session check in the public pages; CTA is a plain link. | Gap, see AMP-069. |
| Spec release labels ("First release") and provider picks (Supabase Auth, Stripe Checkout) | Used only as hints. Not relied on in this audit. | Proposed, not binding. |

---

## 4. Claims check (file:line)

Rules applied: no guaranteed earnings, no "effortless" or "passive income", no fake timers or urgency, no invented testimonials or numbers, pricing labelled draft, labels honest, brand from `site-config.ts`, noindex.

### Problems found

| # | Where | Text (short) | Problem | Severity |
| --- | --- | --- | --- | --- |
| C1 | `apps/web/app/plant-lab/page.tsx:84` | "Your 6-figure business is just a few clicks away." | Implies an earnings outcome. It is also not the owner's headline. | High |
| C2 | `page.tsx:86` | "Your journey from 9-5 to financial freedom starts here..." | Implies financial freedom as an outcome. | High |
| C3 | `page.tsx:93-95, 97` | "40% of side hustlers...", "Top 25% of established online stores bring in US$59,000+ a month", "On average ... US$258,000 a year" | Third-party figures (QuickBooks 2026 study; Flippa listings 2022-2024) shown directly under the hero CTA. They are labelled "market figures, not Seedline customer results" at `:97`, but the Flippa figure is revenue of stores that were listed for sale (survivorship), US dollars, and I could not verify the numbers in this audit. Likely to read as an income promise in an ad context. Needs the owner and a lawyer. | High |
| C4 | `page.tsx:85` | "...our niche and product finder guided by our Profitability Calculator" | The calculator (`profit-calculator.tsx`) only computes on the visitor's own sales estimate; it does not guide the finder. Overstates the feature. | Medium |
| C5 | `page.tsx:37` | "Exactly once, every time." (delivery) | Absolute reliability claim for a feature labelled In pilot; delivery is verified locally only (checklist E04 "implemented"). | Medium |
| C6 | `page.tsx:35` | Status "Live now" on "Your store goes live" | README and checklist show storefront verified on fixtures (Local); `checkoutBuilt=false`. "Live now" is not supported by Local evidence. | Medium |
| C7 | `page.tsx:129` | "Paid orders deliver themselves. Approved posts go out on schedule. A daily check tells you what needs your attention..." | Present tense for capabilities labelled In pilot and Coming soon at `:36-38`. The note at `:131` only covers checkout and delivery, not posting or the daily check. | Medium |
| C8 | `page.tsx:216` | Tag "Most people start here" on Launch plan | Implies usage data. None exists (no customers yet). | Medium |
| C9 | `page.tsx:211`, `launch-step.tsx:38`, `watch-demo.tsx:101` | "Pilot pricing, being tested" / "being validated" | Plans are a draft hypothesis (`site-config.ts:8`). The wording is close but never says "draft" or "subject to change" in the plan cards; `page.tsx:268` footer does say prices "may change". Low risk, confirm wording with owner. | Low |
| C10 | `page.tsx:44` | FAQ: "Stripe charges card fees per sale (about 1.65% + 30c for Australian cards)" | Third-party rate stated as fact; not verified here. `lib/aimp/preview/profit.ts` holds the number used by the calculator. Check against Stripe's current page. | Low |
| C11 | `watch-demo.tsx:53` | Quote "I have about four hours a week and I like getting organised." | A scripted first-person quote. It is the demo's input, and `:107` labels the output a sample, but the quote itself is not labelled illustrative. Could be read as a customer voice. | Low |
| C12 | `page.tsx:44, 211` | "Cancel any time" | Cancellation terms do not exist yet (no terms page). Promise without a policy behind it. | Low |

### Checked and clean

- No countdowns, scarcity, "limited spots" or fake timers found in `plant-lab/**` (read all `.tsx` files; CSS not searched for generated content).
- No testimonials, reviews, logos or customer counts found. `page.tsx:234` states the opposite promise.
- The words "passive income", "effortless", "guaranteed" appear nowhere except in the negative at `page.tsx:233`.
- `preview-step.tsx:190` says "starting prices to test, not a forecast of sales". `launch-step.tsx:84` states checkout and delivery are in final testing.
- Preview output is labelled by `previewLabel` (`lib/aimp/preview/generate.ts:7`) and by `p.label` (`preview-step.tsx:81`).

### Brand name

- No hard-coded "Seedline" or "AiMoneyPrinter" in any page or component. Pages use `site.name` (`page.tsx:13, 57-59, 97, 266`; `build/page.tsx:12, 28`; `profit-calculator.tsx:38`).
- Only occurrence: a comment at `app/plant-lab/tokens.css:1` ("AiMoneyPrinter website tokens"), which does not render.
- `site-config.ts:6-7`: `domain` and `supportEmail` use `aiventra.com.au`. That is a domain choice, not a brand string, but it is a third naming that must be confirmed (open question 4).

### Indexability

- `page.tsx:15` and `build/page.tsx:13`: `robots: { index: false, follow: false }`. Good.
- Gaps (seen in code): `app/robots.ts:12` is `allow: '/'` for all agents and disallows only `/api/` and `/tools/`, so `/plant-lab` is protected only by the page meta tag, not by robots.txt or an `X-Robots-Tag` header. Both pages are server-rendered, so the meta tag is in the first HTML. I found no `plant-lab` reference in `lib/aimp/hosts/seo.ts` (sitemap source), so the lab routes are probably not in the sitemap, but I did not read that whole file. Future pages (privacy, terms, pricing) must also set noindex until the owner approves.
- `site-config.ts` has no `indexable` flag; each new page would have to remember the rule.

---

## 5. Accessibility and mobile risks (seen in code, not measured)

| # | File:line | Risk |
| --- | --- | --- |
| A1 | `plant.css:15` | Header CTA `.amp-btn-sm` has `min-height: 40px` (under 44 px). |
| A2 | `plant.css:106` | Demo tabs use `all: unset` with `min-height: 24px`; padding gives roughly 35-40 px height (calculation, not measured). Under 44 px. |
| A3 | `watch-demo.tsx:38-43` | `role="tablist"` / `role="tab"` without arrow-key handling or roving tabindex. Every tab is a tab stop; the ARIA tab pattern is incomplete. Panels are also not focusable. |
| A4 | `plant.css:28, 32` | Anchor navigation hidden under 900 px, no menu replacement. Mobile visitors cannot jump to Pricing or FAQ except by scrolling a very long page. |
| A5 | `plant.css:23` (fixed header, 68 px) | No `scroll-margin-top` or `scroll-padding` found in any CSS under `plant-lab/` (grep returned nothing), so anchor targets `#how`, `#watch`, `#pricing`, `#faq` will land under the fixed header. |
| A6 | `plant.css:46, 54, 69, 71` | Story uses `100svh` chapters and `52svh` / `33svh` top padding on mobile. Short viewports (landscape phones, small browsers with large UI) could push the hero CTA below the fold or let copy run past a chapter. Not measured; this is the main risk to the "CTA without scrolling" rule. |
| A7 | `plant.css:235` | Hero stats and source text at `.85rem` and `.82rem` (`.amp-small`) on mobile. Small; contrast of `--amp-muted` on pearl not measured. |
| A8 | `build.css:171` | Pin list becomes a horizontal scroller on mobile (`overflow-x: auto`, snap). A scroll container is not keyboard-focusable unless it has `tabindex`; none is set. |
| A9 | `plant.css:19-20` | Two skip links ("Skip animation" first, then "Skip to content"). Working. Their order puts "Skip animation" before the more useful one. Minor. `skip_animation` event is never fired. |
| A10 | `plant.css:84-92`, `story-canvas.tsx:21`, `build.css:244`, `watch-demo.tsx` | Reduced-motion, no-WebGL and no-JS paths exist for the story, demo panel, build flow and scroll. **Not run by me.** `plant.css:13-14` button `transition` / `:active` scale is outside the reduced-motion block (small, 160 ms). |
| A11 | `build-flow.tsx:43-45`, `choose-step.tsx:66-67` | Programmatic smooth scroll respects reduced motion (checked `matchMedia`). Good. |
| A12 | `page.tsx:74, 80, 103` | Stage image is `aria-hidden` with `alt=""`; each chapter carries its own descriptive alt (`display: none` until static). Alt text present on all authored stills. The final-section still has `alt=""` (decorative). Fine. |
| A13 | `preview-step.tsx:94, 119`, `build-flow.tsx:93` | Step changes move focus to the new `h1` and announce progress with `aria-live`. Good. |
| A14 | `build.css:18, 29, 30, 39, 60, 82, 104` | Build flow controls are set to 44-48 px minimum. `.bp-site-cta` is 40 px (`build.css:156`) but it is a non-interactive span in the mock. OK. |
| A15 | `plant.css:46` `100vh` fallbacks | Old-Safari fallbacks exist (`100vh` then `100svh`). iPhone Safari behaviour is unverified (AMP-072). |
| A16 | `public/plant/plant.glb` | 760 KB GLB (per README) loaded only after dynamic import and WebGL probe. Cost on mid-range phones unmeasured. |

---

## 6. Carrying the two-click preview into /start sign-up (without editing `apps/web/app/start/**`)

### What the code shows today

- The Launch step links to `/workspace?plan=<id>&from=build` (`launch-step.tsx:27`). `/workspace` is the older VENTRA sign-in and workspace page (`app/workspace/page.tsx`: "Business profile", Education / Services pathways, browser-local import). It ignores `plan` and `from`. This is the wrong destination for the new product.
- `/start` (`start/page.tsx`) is the new Welcome; "Get started" goes to `/start/account`. `start/account/page.tsx` reads only `mode` from the query. Nothing under `/start` reads `model`, `niche`, `plan` or `from` (grep for `searchParams` in `app/start` found only `account/page.tsx` and a file route).
- `/start` stores goal answers in `localStorage` under `START_DRAFT_KEY` (`start/flow.ts:23`, via `lib/aimp/onboarding/store.ts`). The goals flow loads it (`goals-flow.tsx:36`) and the journey reads it (`journey-client.tsx:26`).

### Seam I would use (needs no edit to `/start/**` for my half)

1. **Write side (mine, `lib/aimp/plant/handoff.ts`, new):** on "Save & Launch My Business" click, serialise `{ v: 1, model, niche, seed, plan, brandName, createdAt }` (ids only, no PII, no price promises) and store it in `localStorage` under its own key (for example `aimp.website.preview.v1`) **and** carry the same ids in the URL as a fallback (`/start?from=build&model=...&niche=...&seed=...&plan=...`). Validate with the existing `parseFlowState` rules so only known models and niches are accepted. The link target changes from `/workspace` to `/start` (`startRoutes.welcome`, a constant I can read but not edit).
2. **Read side (needs the frontend agent):** `/start` must show "Your preview: <name>" and offer to continue from it. This is a small read in `start/page.tsx` or `start/layout.tsx`, or in `/start/goals`, that imports a pure helper `readPreviewHandoff()` from `lib/aimp/plant/handoff.ts` (my file, no browser APIs except an optional storage argument, unit-testable). It could then pre-fill nothing but show the chosen business and pass `model` and `niche` to the Opportunity Finder profile.

### Zero-edit partial option (verify before using)

Pre-seed `START_DRAFT_KEY` with budget, hours and interests taken from the "Choose for me" taps, using the same store (`createLocalStorageStore().save(START_DRAFT_KEY, step, answers)`), so the goals step opens already filled. This works only when the visitor used "Choose for me", only for budget, hours and interest (not the chosen model, niche or brand name), and it writes into another agent's storage schema (`lib/aimp/onboarding/store.ts`, not read in full). I would not use it as the main seam.

### What I need from the frontend agent

- A read of the handoff in `/start` (see above), or a stable query contract they will honour: `?from=build&model&niche&seed&plan`.
- Confirmation that the Launch step may link to `/start` rather than `/start/account`, so a signed-in visitor goes to the right place. The spec says the CTA should route authenticated users to onboarding and everyone else to sign-up; today `/start` does not do this check.
- A decision where the preview is stored after sign-up. `Launch-step.tsx:90` says "This sample is not stored yet", which stays true until the backend stores it. That is a backend question, not a website one.

---

## 7. Gap list ordered into next tasks

### AMP-069 Carry the preview into /start sign-up (size: medium)

Files to add or change (mine): `lib/aimp/plant/handoff.ts` (new: build, parse, validate, TTL), `app/plant-lab/build/launch-step.tsx` (link and write on click, change target from `/workspace` to `/start`), `app/plant-lab/build/page.tsx` ("Sign in" link to `/start/account?mode=login`), new `apps/web/test/aimp-website-handoff.test.ts`.
Needs the frontend agent: reader in `/start` (section 6).
Acceptance:
- Clicking "Save & Launch My Business" lands on `/start` with the model, niche, plan and brand name available (screen or test).
- A tampered or unknown value is ignored and the visitor lands on a clean `/start`.
- Works with JavaScript off (URL fallback) and with storage blocked.
- No PII stored. Storage entry expires.
- Typecheck, lint, tests pass with counts recorded.

### AMP-070 How it works, examples, pricing and plan comparison, FAQ, contact, privacy, terms (size: large)

Files to add (all `noindex`): `app/plant-lab/how-it-works/page.tsx`, `app/plant-lab/examples/page.tsx`, `app/plant-lab/pricing/page.tsx`, `app/plant-lab/faq/page.tsx`, `app/plant-lab/contact/page.tsx`, `app/plant-lab/privacy/page.tsx`, `app/plant-lab/terms/page.tsx` (route choice: open question 5), `lib/aimp/plant/content.ts` (FAQ, status labels in one place), footer links in `page.tsx`, a mobile menu for the header. Change `page.tsx` copy at C1-C8 (needs owner decisions first), add the brief headline.
Acceptance:
- Every screen in R1-R11 is reachable from the footer and header on mobile and desktop.
- Pricing page has a plan comparison, states "draft pricing, may change", shows card fees separately from app fees, reads from `site.plans` only.
- Privacy and terms are clearly marked as drafts pending legal review (I cannot write binding legal text).
- Every claim in section 4 is fixed or has an owner decision recorded.
- Status labels Live / In pilot / Coming match the checklist evidence (storefront and checkout must not read "Live now" on Local evidence).
- Every page `robots: noindex`; brand only from `site-config.ts`.
- New tests in `aimp-website-*.test.ts` (claims scan for banned phrases, noindex on every page, brand not hard-coded).

### AMP-071 Measurement events and first headline A/B test (size: medium)

Files: `lib/aimp/analytics.ts` is outside my paths, so I would add `lib/aimp/plant/measure.ts` wrapping `track()` (fires `hero_view` once, `skip_animation`, sign-up and purchase hand-off events, performance marks for the 3D scene), `lib/aimp/plant/experiment.ts` (headline A "The AI boom is here. Build a business from it." versus B "Your business. AI does the heavy lifting.", sticky assignment, same primary CTA, `variant` on every event), edits in `page.tsx`, `tracked-link.tsx`, `story-canvas.tsx`, `launch-step.tsx`. Backend or frontend agent decides the sink (a first-party endpoint or a vendor); until then events stay in `dataLayer`.
Acceptance:
- Every event named in the strategy's measurement plan is fired once at the right moment (test with a fake `window`).
- Variant is stable per visitor, never changes mid-visit, is present on all events, and a test proves the split logic and fallback when storage is blocked.
- Variant B text passes the claims scan (no income promise; "heavy lifting" wording needs owner sign-off, see open question 7).
- Mobile vs desktop and 3D load time and failure are recorded.
- No consent bypass: events are not sent to any third party without an owner-approved decision.

### AMP-072 Real-device iPhone Safari and Lighthouse checks (size: small to medium, mostly manual)

Files: results go in `docs/aimp/website/` (a new results note); code only if a defect is found (CSS in `plant.css`).
Acceptance:
- iPhone Safari (real device) walk-through of `/plant-lab` and `/plant-lab/build` with screenshots; hero CTA visible without scrolling at 320, 375, 390, 430 px (R18, A6).
- Lighthouse mobile and desktop numbers recorded (performance, accessibility), including 3D on and off (`?quality=low` exists, `story-canvas.tsx:34`).
- Reduced-motion, no-WebGL and no-JS checks run and recorded.
- Fix the findings in section 5 (A1-A8) or log each as accepted.
- Evidence level stated honestly (a Simulator is not a device).

### AMP-073 Homepage integration (size: medium; needs the owner's approval)

Files (after approval only): route switch for `/` (touches app root, outside my paths: a coordinated change), redirect or alias from `/plant-lab`, removal of `noindex` and addition of a sitemap entry, `robots.ts` review, canonical URLs, social metadata. Needs: brand decision (legal and Stripe review), approved copy, privacy and terms present, owner sign-off on every section 4 item, and the real "returning signed-in" state (spec screen 01 states).
Acceptance:
- Owner approval recorded in `HANDOFF.md`.
- `/` serves the site; old `/` content is reachable or deliberately retired (owner decision).
- Primary CTA reaches the right next step with the 3D scene disabled (spec acceptance).
- Indexing switched on only on the approved host.

---

## 8. Open questions for the owner

1. Should the hero headline be exactly "The AI boom is here. Build a business from it." as in the strategy, replacing "Your 6-figure business is just a few clicks away."?
2. May I remove the "9-5 to financial freedom" line and the three income statistics under the hero, or do you want any third-party figures kept (and if so, will you supply and verify the sources)?
3. Do you accept that "Live now", "Exactly once, every time" and "Most people start here" be removed or softened until real evidence exists?
4. Which domain and support email should the site show, given `site-config.ts` currently says `aiventra.com.au`?
5. Do you want the extra pages (pricing, FAQ, how it works, examples, contact, privacy, terms) as separate routes under `/plant-lab/` for now, and as top-level paths such as `/pricing` only after homepage approval?
6. Who writes the privacy policy and terms (a lawyer, or may I draft clearly labelled placeholders), and what cancellation terms apply to "cancel any time"?
7. Is the second headline "Your business. AI does the heavy lifting." approved for the A/B test, and where should events be sent (first-party only, or a named analytics vendor)?
8. Is it right that the preview hand-off goes to `/start` (new onboarding) instead of the older `/workspace` page?

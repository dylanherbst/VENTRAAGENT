# Website audit (W-0)

Cycle c-9edb821b, 2026-11-10. Source: read-only audit by `ventra-research` of the website worktree
`~/Developer/VENTRA-WEBSITE` (branch `frontend/website-ui`). Paths are relative to `apps/web` there.
Items marked *unverified* were not opened.

## Existing pages and components

| File | Verdict | Reason |
| --- | --- | --- |
| `app/site/layout.tsx` | KEEP + REPAIR | Has metadata, metadataBase, OG and the Journey/GetStarted providers. Header and footer are inside each page, not the layout. Canonical is hard-coded to `/`. |
| `app/site/page.tsx` | REPAIR | Working single-page homepage (10 inline sections, Organization JSON-LD). Split into section components (W-2). |
| `app/site/_ui/chrome.tsx` (Nav/Footer) | REPLACE | Links are `/site#…` anchors. No mobile menu, no multi-page nav, minimal footer. |
| `app/site/_ui/get-started.tsx` | KEEP + REPAIR | Sheet, sticky CTA, consent banner and PricingSeen work. Chat posts to `/api/front-office/chat` with a mailto fallback. The checkout box is an "Opens soon" stub (W-10). Move Sticky and Consent into the shell. |
| `app/site/_ui/journey.tsx`, `reveal.tsx`, `status.tsx`, `icons.tsx`, `demos.tsx` | KEEP | Live/Demo/Soon status pills are the honest-status pattern. Contents of `demos.tsx` and `journey.tsx` are *unverified*. |
| `app/site/_ui/track.ts` | KEEP + REPAIR | Pushes to `dataLayer` only, after consent. Add a `waitlist_submit` event and a UTM convention (W-13). |
| `app/site/site.css` | KEEP + REPAIR | Scoped to `.vs` with its own tokens. Does not use the shared glass kit. |
| `app/site/privacy`, `app/site/terms` | KEEP | Need a legal read before launch (*unverified*). |
| `lib/site/content.ts` | KEEP + EXTEND | Pillars, journeys, demos, FAQs and plans. Prices are `null`, which is correct until the owner supplies them. |
| `test/site-content.test.ts` | KEEP | The only site test. Nothing covers routes, SEO or checkout. |

## Pages: existing vs missing

- Exist: Home (`/site`), Privacy, Terms.
- Missing: `/site/course` (W-3), `/site/start` (W-4), `/site/grow` (W-5), `/site/ai-setter` (W-6),
  `/site/ai-receptionist` (W-7), `/site/pricing` (W-8), `/site/store` (W-9), `/site/login` and `/site/signup` (W-11),
  `/site/for/{beauty,fitness,trades}` (W-12).

## Design system

The shared glass kit (`components/glass/`, `components/ui/liquid-glass-card.tsx`) and `docs/design/UI_BIBLE.md` are
**not on `frontend/website-ui`**. They are still untracked in VENTRA-FEATURES. W-1 therefore builds the shell on the
site's own `.vs` tokens and wraps the kit once it is committed and merged. The site does not copy kit components.

W-1 plan:
- Build `app/site/_ui/shell.tsx` (Nav, MobileMenu, Footer, Sticky, Consent) and `app/site/_ui/sections.tsx`
  (Hero, Section, FeatureGrid, StatusList, CtaBand, PlanCard, FaqList), plus a page template that takes a title,
  description, JSON-LD and children.
- Move Nav and Footer into the layout.
- Reuse `status`, `reveal`, `icons`, `get-started`, `track` and the `site.css` tokens.

## Purchase journey (proposal)

The visitor needs two decisions: pick a plan on Pricing, then pay in Stripe test checkout.

- Use one typed catalog in `lib/site/pricing.ts`: id, name, AUD monthly price, includes, usage, `stripePriceId`,
  `checkoutReady`. Pricing, Store and `/api/checkout` all read it.
- The checkout route must look up the price on the server by product id. Today it accepts `amountMinor` from the
  client, which would let a visitor set their own price.
- Current blockers:
  - `app/api/checkout/route.ts` returns 423 because checkout is frozen (`lib/scope-freeze.ts`, shared with the main
    project).
  - `lib/stripe-checkout.ts` supports only one-off `mode: 'payment'`. Subscriptions need `mode: 'subscription'`,
    which is a change to shared code.
  - The success and cancel URLs point to `/tools/checkout`.
  - Whether `lib/stripe-webhook.ts` records entitlements is *unverified*.
- Auth: only `lib/supabase/client.ts` exists. Login and signup (W-11) have to be built.

## SEO baseline

- The layout has a title, description and OG tags. The homepage has JSON-LD.
- There is no per-page metadata, no `sitemap.ts` and no `robots.ts` (W-13).
- The canonical is wrong for every page except the homepage.
- The homepage lives at `/site`, not `/`. The root-route mapping needs a decision.

## Performance baseline

None yet, because no preview is running.

## Risks

1. Un-freezing checkout touches shared `scope-freeze.ts` and the checkout route. This needs a main-project task and
   the owner's decision.
2. Subscription mode and the server-side price lookup change `stripe-checkout.ts`, which `/tools/checkout` also uses.
3. The site chat uses `/api/front-office/chat`, which has uncommitted A-17 edits on `agent/develop`.
4. W-15 depends on the front-office contact contract for the website channel.
5. W-14 checkout tests will fail until the freeze is lifted.

## Needs the owner

- Stripe test keys, products and real prices.
- A decision to un-freeze checkout.
- Domain: `aiventra.com.au` and the contact email domain are inconsistent.
- An analytics account.
- A legal review of the privacy and terms pages.
- Copy facts, images and real proof for the niche pages.

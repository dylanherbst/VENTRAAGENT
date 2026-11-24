# AiMoneyPrinter shared contracts

Source: build brief sections 7 and 8 (`docs/aimp/reference/text/Frontend_Backend_Build_Brief.txt`). The frontend agent
owns the journey, responsive components, accessibility and display states. The backend agent owns validated data,
authorisation, jobs, integrations and persisted outcomes. Both use the same feature ID, screen, API and event
definitions. Written 14 Nov 2026 from a read of the repo; no code was changed. Evidence levels: **Local** (fixtures,
this machine), **Provider Test** (real provider in test mode), **Live**.

- States: `CANONICAL_STATES.md` (proposed; five decisions open).
- Typed operations: `apps/web/lib/aimp/contracts.ts` (`WorkflowContracts`, persisted status lists).
- Screen shapes used by `/start/*`: `apps/web/app/start/journey-types.ts` (`ActionReply`, `Connection`, per-step state).
- One contract file per feature goes in this folder as `<ID>-<slug>.md`, written with the `amp-feature-contract` skill.
- Per-feature status: `../FEATURE_CHECKLIST.md`.

## What a contract must state before dependent screens are built

| Part | Both agents agree on |
| --- | --- |
| Screen and feature ID | Name, route, app surface, Figma frame, actor, stage, primary action, accessibility needs |
| Read model | Stable record IDs, tenant context, status, last updated, what is available, required next action |
| Mutation and permissions | Valid input, role and business scope, result, retry behaviour, whether confirmation or an external account is needed. The backend checks permissions again before execution |
| Workflow and event | Producer, consumer, persisted event, schema version, business ID, trace ID, action key. Output references are saved before dependent work is scheduled |
| Fixtures and errors | Stable examples for success, no data, waiting, retry, expired access, forbidden. Safe customer messages; operational detail stays in restricted logs |
| Test evidence | Commit, test URL, acceptance steps, result and level. Both agents run the same scenario before a feature is marked verified |

## First-release journey: where each contract lives today

Start the app locally: `cd apps/web && npx next dev -p 3040 --hostname 127.0.0.1`. Everything below is Local evidence on
fixtures unless stated. "Needs" is the level required before the feature can be ticked.

| Feature | Screen route | Backend module / API | Tests (`apps/web/test/`) | Test route | Needs | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| A01 sign-in and workspace | `/start`, `/start/account` | existing workspace auth endpoint (see `docs/aimp/README.md`) | `aimp-glass-start-flow` | `/start/account` | Provider Test | real sign-up against Supabase not run |
| A02 goals and budget | `/start/goals` | `lib/aimp/onboarding/{model,store}` | `aimp-onboarding-model`, `aimp-onboarding-store` | `/tools/aimp-onboarding` | Local | none |
| A03 guided setup | `/start/*` (`journey.ts`, `flow.ts`) | server actions `app/start/actions.ts` | `aimp-glass-steps` | `/start` | Local | AMP-015 in progress |
| B01-B03 ideas, scoring, research | `/start/ideas`, `/start/ideas/[id]` | `lib/aimp/opportunities`, `opportunity-scoring.ts` | `aimp-opportunity-finder`, `aimp-opportunity-scoring` | `/start/ideas` | Local, then Provider Test with a live model | live research provider off |
| B04 blueprints | (inside idea preview) | `lib/aimp/blueprints` | `aimp-blueprint-library` | | Local | none |
| B05 preview and break-even | `/start/ideas/[id]` | `lib/aimp/preview`, `lib/aimp/selection` | `aimp-preview`, `aimp-profit`, `aimp-selection-select` | `/start/ideas/[id]` | Local | none |
| C01 brand | `/start/brand` | `lib/aimp/branding` | `aimp-branding-generate`, `aimp-branding-service` | `/tools/aimp-branding` | Local | none |
| C02, I05 product files and checks | `/start/products` | `lib/aimp/factory`, `lib/aimp/products` | `aimp-factory-pdf`, `aimp-factory-zip`, `aimp-factory-request`, `aimp-products-lifecycle` | `/start/products` | Local | none |
| C04, C05 catalogue and pricing | `/start/catalogue` | `lib/aimp/catalogue` | `aimp-catalogue-service`, `aimp-catalogue-pricing` | `/start/catalogue` | Local | none |
| C06 private files | (download link) | `lib/aimp/files`, `/api/aimp/files/[token]` | `aimp-files-delivery` | | Provider Test (real storage) | storage on fixtures |
| D01, D02 storefront | `/s/[store]/...` | `lib/aimp/storefront` | `aimp-storefront`, `aimp-storefront-multi` | `/tools/storefront` | Local | none |
| D03 publish and rollback | `/start/store` | `lib/aimp/site-versions` | `aimp-site-versions-lifecycle`, `-isolation`, `-rework` | `/start/store` | Local | none |
| D05, D06 hosts and SEO | (host routing, `proxy.ts`) | `lib/aimp/hosts` | `aimp-hosts-resolve`, `aimp-hosts-seo` | | Live for the real domain | AMP-033-D domain |
| E01 seller readiness | not built in `/start` yet | `lib/aimp/sellers` | `aimp-sellers-readiness` | | Provider Test | AMP-043-D Stripe test keys |
| E02, E03 checkout and orders | buy button on `/s/[store]/products/[product]` | `lib/aimp/checkout`, `lib/aimp/orders`, `/api/aimp/checkout`, `/api/aimp/webhooks/payments` | `aimp-checkout-service`, `aimp-orders-paid`, `aimp-providers-idempotency` | `/tools/aimp-checkout` | Provider Test | AMP-043-D Stripe test keys |
| E04, E06 delivery, reissue, refunds | buyer download and recovery; owner order timeline | `lib/aimp/fulfilment`, `/api/aimp/fulfilment/*` | `aimp-fulfilment-delivery`, `-once`, `-support`, `-hardening`, `-walk`, `aimp-release-first` | `/tools/aimp-fulfilment` | Provider Test (real email + storage) | follow-ups listed on AMP-042 |
| F01 launch campaign | not built in the app yet | `lib/aimp/campaigns` | `aimp-campaign-plan` | `/tools/aimp-campaign` | Local | AMP-050 in progress |
| G01, G04 jobs and retries | activity view not built | `lib/aimp/jobs` | `aimp-jobs-runner`, `aimp-jobs-handlers` | `/tools/aimp-jobs` | Local | none |
| I02 tenant isolation | all | `lib/aimp/data` and each store | `aimp-data-isolation`, `aimp-site-versions-isolation`, `aimp-storefront-multi` | | Local, then two-store run (AMP-064) | none |
| I12 feature flags and provider status | DEMO badges | `lib/aimp/flags.ts`, `lib/aimp/providers` | `aimp-providers-registry` | | Local | none |

Not started (no code yet): F02-F05, F08, G02, G03, G08, H01, I01, I03, I04 (support view), I06-I11. Their contracts are
written when their board task starts.

## First contracts to agree (brief section 8, step 1)

In this order, one contract file each, because later screens depend on them:
1. Onboarding and resume (A01-A03).
2. Business provisioning: selection to build job (B05, G01).
3. Products: version, checks, approval (C02, I05).
4. Store versions: draft, preview, publish, pause, rollback (D03).
5. Payment: seller readiness, checkout, order (E01-E03).
6. Fulfilment: delivery, reissue, refund (E04, E06).

## First acceptance run (brief section 8, step 5)

Two separate test stores. Render a real product, publish a test storefront, complete a Stripe test payment, replay it,
verify exactly one correct delivery, and confirm the customer sees the state change. Also: interrupted jobs, unpaid and
delayed payment, wrong-store access, provider disconnect, opt-out. Board tasks AMP-043 and AMP-064. Anything that needs
Dylan (verification, credentials, provider approval, spend) is flagged with the exact task, action, what it unlocks and
the next task; live verification stays pending until it is demonstrated.

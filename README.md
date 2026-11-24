# VENTRA

Recovered Next.js/React TypeScript workspace at `/Users/dylan/Developer/VENTRA-CLEAN`. This checkout has one code-writing developer. Older repositories are read-only recovery references.

The subtle teal glass workspace includes onboarding, Services, Create, local website/offer/course tools, customer contacts and pipeline, manual growth research/content/planning, invoice drafts, and manual Growth Audit. Original authoring tools and the labelled synthetic course/store demo remain at `/tools`.

Drafts use the existing browser-local storage contracts. Account authentication, API persistence and Supabase migrations are present, but require a separately configured backend. AI generation, workflow execution, calls, calendar, payments, publishing and real performance feeds are disconnected. Demo publication is simulated.

Use the pinned Node 24.21.0/npm 11.19.0 through the existing project wrapper:

```sh
./scripts/project npm --prefix apps/web ci --ignore-scripts --no-audit --no-fund
./scripts/project npm run build
./scripts/project npm run typecheck
./scripts/project npm run lint
./scripts/project npm test
./scripts/project npm --prefix apps/web run start -- --port 3100
```

Production preview: <http://127.0.0.1:3100>. For development, run `./scripts/project npm run dev` (loopback port 3000). Use the app-level command shown above when passing a custom port.

Live backend suites are separate from unit/fixture-database tests:

```sh
./scripts/project npm --prefix apps/web run test:integration
./scripts/project npm --prefix apps/web run test:api-integration
```

They refuse to run without isolated local Supabase test configuration. Never add credentials to source or use a production backend for tests.

To run both suites against this checkout’s dedicated Docker-backed Supabase stack:

```sh
supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
./scripts/project npm run test:local-integration
```

The `ventra-clean-integration` stack uses API port 55321 and database port 55322, separate from older local projects. The runner reads local CLI credentials into memory without writing environment files. The API suite builds and starts its own disposable Next server; it does not replace the preview on port 3100. Fixture users and workspaces remain in this development stack. Never run a linked-project reset or push for these checks.

The recovery browser check uses a fresh ephemeral Chromium context and synthetic records, without existing browser sessions. Supply an installed Playwright module path, or install Playwright separately and omit the argument:

```sh
./scripts/project node --experimental-strip-types scripts/recovery-browser.mjs /path/to/playwright/index.mjs
```

Screenshots and browser results are written under ignored `docs/recovery/verification/`. Dependencies, builds, environment files, logs and TypeScript caches are ignored. See `RECOVERY_AUDIT.md` for provenance, checks and limitations. No deployment is configured by this recovery.

# Test results (24 Nov 2026)

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | Pass |
| ESLint on every changed file | Pass |
| Node tests: full suite, 4 chunks (2,749 tests) | 2,739 pass, 0 fail, 10 marked todo in the original suite |
| New: `test/aimp-growth.test.ts` | Pass: route parking, tiers, shared profile and AI Sales sync, partial saves, website reader safety and extraction |
| Updated for the growth product | Workspace nav, entry, dashboard (links to parked pages), orders (parked) |
| Production build (`next build`) | Pass |
| Browser pass (desktop and mobile) | **Not yet**: start `Run Growth Test Lab.command`, then follow the Test Lab checklist |
| Live integrations (Zernio, Meta, Stripe live, OpenAI images, Creatomate) | **Not tested**: keys and accounts needed |

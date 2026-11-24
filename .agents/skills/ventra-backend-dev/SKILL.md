---
name: ventra-backend-dev
description: Run the VENTRA backend workflow (API contract, database, authentication, integration tests, security review). Use for API, Supabase schema, auth or integration work.
user-invocable: true
---

# Backend development workflow

Chief of Staff runs these in order. One writer; confirm `ventra-handoff status`.

1. **API contract.** `ventra-research` or `ventra-backend` writes request/response shapes and error cases first (`*-api-contract.ts`).
2. **Database.** `ventra-backend` writes migrations under `supabase/` and applies them to LOCAL data only. Any production migration, destructive change or live data change goes through `ventra-approval request`.
3. **Authentication and tenancy.** Every endpoint checks the user and tenant. Row-level security stays on. No service-role key in client code.
4. **Integration tests.** `npm run test:local-integration` plus unit tests for the new logic. Use Serena symbol lookups to find callers instead of reading whole files.
5. **Security review.** `ventra-review` checks auth, input validation, secrets, injection and error leakage; `ventra-qa` runs lint, typecheck, tests, build.
6. **Fix loop.** At most 3 repair attempts, then record BLOCKED in `HANDOFF.md`.
7. **Commit** with `ventra-git commit`. Supabase, GitHub, Vercel and Stripe plugins stay off until MCP deny rules exist (`docs/agents/PLUGINS.md`).

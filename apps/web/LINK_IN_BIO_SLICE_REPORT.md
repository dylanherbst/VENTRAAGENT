# Link-in-bio (Module 4) — repair report

**Date:** 2026-10-17

## Scope

Evidence-driven repair from coordinator tests (7/8) and product review: stale-tab concurrency test, fail-closed persist on corrupt stored raw, offer source-drift acknowledgement, and explicit replace-saved confirmation before blank new page overwrite. Link-in-bio lib, UI, and tests only.

## Changes

| Area | Fix |
|------|-----|
| `local-link-in-bio.test.ts` | Stale-tab test simulates another-tab storage write with stale `expectedRaw`; idempotent re-save with matching raw still allowed. |
| `local-link-in-bio.ts` | `persistLinkInBioDraft` validates non-null `expectedRaw` via `restoreLinkInBioDraft` before overwrite; replace-saved guard on persist. |
| `local-link-in-bio.ts` | `evaluateLinkInBioOfferSourceDrift`, save options for `acknowledgeSourceChange` / `acknowledgeReplaceSaved` / `editingExistingSavedPage`. |
| `link-in-bio-draft.tsx` | Source-drift and replace-saved checkboxes gate Save; editor copy clarifies two-step replace flow. |

## Coordinator checks

| Check | Result |
|-------|--------|
| `npm run test` (link-in-bio) | Run locally — see command below. |
| `npm run typecheck` | Run locally. |
| `npm run lint` | Run locally. |

```bash
cd apps/web && npm run test -- test/local-link-in-bio.test.ts && npm run typecheck && npm run lint
```

## Review findings addressed

- Persist could overwrite corrupt/oversize storage matching stale client raw without parsing first — now fail-closed.
- Save refreshed changed offer snapshots silently — blocked for offers already on saved page until explicit review checkbox; newly added offers still saveable once drift on existing rows is acknowledged.
- “Continue to new page editor” was not a final guard — Save disabled and domain/persist require `acknowledgeReplaceSaved` when replacing an existing saved page.

## Out of scope

- Trackers, other modules, public URL or checkout claims.

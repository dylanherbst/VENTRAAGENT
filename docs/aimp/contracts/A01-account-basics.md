# A01 Account basics (AMP-016 slice 1)

Code: `apps/web/lib/aimp/account/` (`types.ts`, `store.ts`, `service.ts`, `index.ts`). Tests: `apps/web/test/aimp-account-basics.test.ts`.
Server level on fixtures only: no route, server action, form, real email or Supabase call.

## What exists

Ids reuse the workspace code: `userId` (auth user id), `workspaceId`, roles `owner` | `staff`. The actor comes from the server session, never from user input.

- `requestPasswordReset(deps, email)`: always returns the same `{ ok: true, message }` for a known, unknown or malformed address and for a provider failure. A known address gets one email through `ResetMailer`; a newer request replaces older tokens. Token = 32 random bytes (hex), stored as a SHA-256 hash only, valid 1 hour (`RESET_TTL_MS`), never returned or logged.
- `confirmPasswordReset(deps, token, newPassword)`: password 12 to 128 characters (same as the sign-in route); token is consumed atomically (single use, expiry checked). Results: `ok`, or `bad_password`, `bad_token`, `failed`. A short password does not burn the token.
- `exportWorkspaceData(deps, actor, workspaceId)`: any active member (owner or staff) gets `{ workspaceId, exportedAt, sources, failedSources, droppedForeignRecords }` built from one `DataSourceReader` per source; a non-member gets `not_member` and no data. A failing reader is listed in `failedSources`.
- `deleteAccount(deps, actor, { workspaceId, typed })`: owner only, `typed` must equal `DELETE`. Runs every `DataSourceDeleter`; returns `{ ok: true, deleted }` only if all succeeded, otherwise `{ ok: false, code: 'partial', deleted, notDeleted }`. Re-running after a fault is safe.
- Seams (interfaces in `types.ts`): `AccountDirectory`, `ResetMailer`, `ResetTokenStore`, `MembershipReader`, `DataSourceReader`, `DataSourceDeleter`. Fixtures: `createFixtureDirectory`, `createFixtureMailer` (outbox), `createMemoryResetTokenStore`, `createFixtureMemberships`.

## Fix round (review)

- Export filters: every record has secret-looking keys removed at any depth (names matching `password`, `token`, `secret`, `hash`, `apiKey` / `api_key`, case-insensitive; this also drops harmless keys such as `contentHash`). A record whose `workspaceId` or `workspace_id` differs from the requested workspace is dropped and counted per source in `droppedForeignRecords`. These filters are a safety net; each reader must still filter by workspace itself.
- `roleOf` throwing (membership reader down): export and delete return `unavailable`; deletion fails closed and deletes nothing.
- Delete with no deleters: refused as `no_sources`, never `ok: true`.
- `confirmPasswordReset` when `setPassword` throws: typed `failed`. The token is already spent in that case and the person must request a new link. No restore is built.
- Deletion success relies on each deleter being honest (it throws if data remains) and idempotent (a re-run after a partial failure must be safe). The service cannot verify either.
- There is no response-time equalising and no rate limit on reset requests or confirmations yet. Both must be added before any route is wired.

## Fixture only

All stores, the mailer outbox, the directory and the membership reader are in memory. The fixture outbox is the only place a token is visible.

## NOT built

- No route, action or form; no rate limiting on reset requests; no timing equalisation between known and unknown addresses.
- No real email provider, no Supabase Auth adapter, no Supabase membership reader.
- No real data-source readers or deleters wired: the app has no workspace-wide read or delete for audience, site versions, orders or products yet, so the service takes them as injected lists (tests use fixtures). Export and deletion cover nothing real until each source supplies one.
- Deleting the auth user itself, sessions revoke, deletion of a user who owns several workspaces, grace period or undo, retention rules, audit log entry for the deletion.
- Google and Apple sign-in (needs owner credentials).

## Owner candidates (AMP-016-D)

Google and Apple sign-in credentials; email provider and sender address; retention and grace-period rules for deleted data.

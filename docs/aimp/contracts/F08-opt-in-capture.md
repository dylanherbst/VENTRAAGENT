# F08 Opt-in capture (AMP-053 slice 1)

Code: `apps/web/lib/aimp/audience/` (`types.ts`, `store.ts`, `service.ts`, `index.ts`). Tests: `apps/web/test/aimp-audience-*.test.ts`.
Server level on fixtures only: no page, route, server action or real email yet.

## Inputs

`createAudienceService({ store, email, now?, newId? })`, `store = createMemoryAudienceStore()`, `email` = any `EmailAdapter` (tests use `createFixtureEmail()`).
Every call takes `ctx = { workspaceId, businessId }` from the server, never from user input. Store key is `ws\0biz\0emailNorm`.

- `createForm(ctx, { id, storeSlug, wordingText, sampleProductId?, tags? })`, `updateForm(ctx, formId, patch)` (a changed wording starts a new `wordingVersion`), `getForm`.
- `captureOptIn(ctx, { formId, email, consentTicked, source?, sample? })`
- `unsubscribe(ctx, email)`, `suppress(ctx, email, reason)`, `tag` / `untag(ctx, email, tags)`
- `listSubscribers(ctx, { status?, tag? })`, `consentLog(ctx, email)`
- `canSendMarketing(ctx, email)`: the single gate any later sender must call.
- Helpers: `normaliseEmail` (trim, lowercase, shape check, 254 cap), `normaliseTags` (lowercase, at most 10, 1 to 30 characters).

## Result

- Capture: `{ ok: true, subscriber, created, resubscribed, sample }` or `{ ok: false, code: 'no_consent' | 'bad_email' | 'unknown_form', message }`. `sample`: `sent`, `not_requested`, `no_sample_product`, `not_sent` (contact not subscribed), `failed`.
- Unsubscribe, suppress, tag, untag: `{ ok: true, subscriber, changed }` or `{ ok: false, code: 'bad_email' | 'not_found', message }`.
- `ConsentRecord` is append-only and copies `wordingVersion`, `wordingText`, `at` and the source (channel, formId, pageSlug, UTMs, referrer; each at most 100 characters).

## Checks

1. Valid tick: one subscriber (single opt-in, `subscribed`) and one `granted` record. No tick or bad email: nothing stored, plain message.
2. Repeat capture: same record, no second grant. Same email in another business: separate subscriber and consent.
3. Every read and write filters on workspace and business. A form of another business or workspace is refused (`unknown_form`).
4. Unsubscribe appends `withdrawn` once (idempotent). Re-subscribing needs a new ticked capture and appends a new `granted`. A suppressed contact is never revived by capture, unsubscribe or tags.
5. `canSendMarketing` is true only for a known `subscribed` contact. `pending` exists in the type but nothing sets it yet (no double opt-in).
6. Sample: one message per `sample:<ws>:<biz>:<emailNorm>:<productId>` key, labelled as a test message, no link in it.
7. Old consent records keep the wording version and text they were granted under.

## Public path (AMP-153)

- **Public routes must return `toPublicReply(result)` and never echo the subscriber, its status or an id.** It gives `{ ok: true, message }` or `{ ok: false, message }`. The ok message (`PUBLIC_OK_MESSAGE`) is identical for a new, an already-subscribed and a suppressed address, so a reply never reveals list membership or suppression.
- `normaliseEmail` rejects any address with a control or format character (`\p{Cc}`, `\p{Cf}`: NUL, DEL, newline, zero-width, bidi).
- Sample email: no unsubscribe promise (no unsubscribe path exists); the "test message from a fixture setup" line shows while `sampleLabel` is on (default on; a real adapter must pass `sampleLabel: false`); `CaptureInput.sampleProductTitle` is shown, the raw product id never is (generic wording without a title).
- A `withdrawn` record has channel `manual`, the grant's form id only, and no UTMs or referrer. Form ids are capped at 100 characters like other fields.
- A ticked capture re-subscribes an unsubscribed address (single opt-in). Double opt-in is required before any real sending.
- Server entry: `app/s/[store]/_server/audience.ts` `submitOptIn(deps, storeAddress, input)`. Business comes from the runtime slug list, never the browser; built-in demo and unpublished stores are refused. Default form `optin-<businessId>` with DRAFT wording `DEFAULT_OPT_IN_WORDING`, version 1. Honeypot field `website` (filled: ok reply, nothing stored). Cap `MAX_SUBSCRIBERS_PER_BUSINESS` = 500. Posted fields: `email`, `consentTicked` (true, "on" or "true"), `website` (hidden, empty), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `referrer`, `pageSlug`. Deps from `audience-wiring.ts` `optInDeps()`.

## Limits and refusals (AMP-154)

- Caps (named constants): `MAX_SUBSCRIBERS_PER_BUSINESS` = 500 (server, passed as `CaptureInput.maxSubscribers`), `MAX_CONSENT_RECORDS_PER_SUBSCRIBER` = 50 and `MAX_FORMS_PER_BUSINESS` = 20 (both in `store.ts`). The store checks and writes in one synchronous step, so parallel posts cannot overshoot. Over the subscriber cap a NEW address gets code `full` (the server replies with its plain "not taking new sign-ups" message); an existing address is still let through. Over the form cap `createForm` returns `{ ok: false, message }`.
- Consent cap choice: when a subscriber already holds 50 records, the FIRST record (the original proof of consent) and the newest 49 are kept; the oldest record AFTER the first is dropped. The first record is never dropped.
- `submitOptIn` and `submitUnsubscribe` refuse a body that is an array, not an object, has an own `__proto__`, `constructor` or `prototype` key, a non-plain prototype, or an object/array in any posted field, with the plain "The sign-up could not be completed." reply. `precheckCapture` (consent tick, email shape) runs before the default form is created, so a refused submit leaves no form, subscriber or record.
- A throwing audience service gives the same plain failed reply; nothing about the address or the error is in it.
- Not built here: the shared built-in store registry between `audience-wiring.ts` and `wiring.ts` (AMP-152), a sign-up rate limit, signed unsubscribe links, real email. Consent wording is unchanged (open owner decision AMP-053-D).

## Review fixes (AMP-160)

- Full list, public path: `submitOptIn` counts the list first and refuses EVERY submit once it holds `MAX_SUBSCRIBERS_PER_BUSINESS`, so an existing (even unsubscribed) subscriber cannot re-subscribe through the public path on a full list, and the reply is the same for a new and an existing address. That is intended.
- Foot-gun, recorded (not changed in code): `CaptureInput.maxSubscribers` on its own only refuses a NEW address; an existing address is still let through. A caller that passes `maxSubscribers` WITHOUT that pre-count would answer `full` to a new address and ok to a known one, which reveals list membership. Any public route must keep the pre-count (or refuse every submit when full). The store-level behaviour stays because trusted server callers and the hardening test rely on "an existing address is still let through".
- `createForm`: the store re-checks the id in the same step as the write (`saveForm(form, { create: true })` throws `AudienceExistsError`), so of two parallel creates with the same id the second is refused ("A form with that id already exists.") and the first form is never overwritten. Not idempotent for identical input: the second always refuses; callers that want "create if missing" (`submitOptIn`) already treat the refusal as fine.
- Consent wording: `captureOptIn` reads the form ONCE and that single read supplies the wording version and text for the consent record, so the stored version and text always match each other and the form wording as read at submit time. A wording change between page render and submit records the NEW wording, which may differ from what the visitor saw on the page. Open item: the page posts the wording version it rendered, and the server refuses on mismatch.
- Open decision (withdrawals): `unsubscribe` and `suppress` copy the wording of the latest grant, read in a separate step before the store's atomic write. A re-subscribe landing between the read and the write could leave a `withdrawn` record that repeats the previous grant's wording. Fixing it needs `transact` to hand the callback the consent list (a store interface change); it is left for the database store, where it is one transaction. The withdrawal itself and its status are never wrong.
- A throwing store gives the plain failed reply and writes nothing (test: a store whose reads throw and whose writes are counted).

## Not real yet

- Memory store only; no migration. No route or page. No real email, no unsubscribe link or token.
- A sample request does not append a separate `purpose: 'sample'` record; the ticked marketing consent is the only record.

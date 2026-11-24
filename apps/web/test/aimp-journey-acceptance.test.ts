// FIRST-JOURNEY ACCEPTANCE RUN (AMP-067). Two separate test businesses (two workspaces, two owners, two stores) walk the REAL
// lib/aimp modules from intake to delivery on fixtures only: no network, no real Stripe, no .env. Evidence level: Local.
// Contract: docs/aimp/contracts/first-journey-acceptance.md. Run: node --experimental-strip-types --test test/aimp-journey-acceptance.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPaymentWebhookHandler } from '../lib/aimp/checkout/handlers.ts';
import { buildSessionCompletedBody } from '../lib/aimp/checkout/fixture-events.ts';
import type { SignedEvent } from '../lib/aimp/checkout/fixture-events.ts';
import { FIXTURE_WEBHOOK_SECRET, signPayload } from '../lib/aimp/checkout/signature.ts';
import { createDownloadHandler } from '../lib/aimp/files/handler.ts';
import { FilesError } from '../lib/aimp/files/types.ts';
import { JOURNEY_DOWNLOAD_PATH, JOURNEY_KEYS, JOURNEY_SEEDS, SAME_WORKSPACE_SEEDS } from '../lib/aimp/journey/fixtures.ts';
import type { JourneyKey } from '../lib/aimp/journey/fixtures.ts';
import { BUILD_JOB, BUILD_STEPS, createJourneyWorld } from '../lib/aimp/journey/world.ts';
import type { JourneyWorld } from '../lib/aimp/journey/world.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';
import { progress } from '../lib/aimp/onboarding/model.ts';
import { getApprovedBrand, listBrandVersions } from '../lib/aimp/branding/service.ts';
import { approveCampaign, getApprovedCampaign, getCampaign, regenerateCampaign } from '../lib/aimp/campaigns/index.ts';
import { findProduct, loadPublishedStore, purchaseState } from '../lib/aimp/storefront/load.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const other = (k: JourneyKey): JourneyKey => (k === 'a' ? 'b' : 'a');
const HOUR = 3_600_000;

/** Intake -> ideas -> choose -> build job (brand, product file, listing, seller, published storefront), for both businesses. */
async function built(): Promise<JourneyWorld> {
  const w = await createJourneyWorld();
  for (const k of JOURNEY_KEYS) {
    w.intake(k);
    w.rankIdeas(k);
    await w.chooseIdea(k);
    const job = await w.build(k);
    assert.equal(job.status, 'succeeded', `build for ${k}`);
  }
  return w;
}
const mails = (w: JourneyWorld, to: string) => w.email.outbox().filter((m) => m.to === to);
const open = (w: JourneyWorld, token: string | null) => createDownloadHandler(() => w.files)(new Request(`http://localhost${JOURNEY_DOWNLOAD_PATH}/${token}`), { params: Promise.resolve({ token: token ?? '' }) });

test('journey: two test businesses go from intake to a delivered file, each in its own workspace and store', async () => {
  const w = await createJourneyWorld();
  const seen: Record<JourneyKey, { niche: string; slug: string; productId: string; price: number; orderId: string; sha: string }> = {} as never;

  for (const k of JOURNEY_KEYS) {
    const b = w.biz[k];
    // 1. intake: goals, budget and time, one validated step at a time
    assert.equal(progress({}).next, 'budget', 'the first question is the budget');
    assert.deepEqual(w.intake(k), { complete: true, profileOk: true });
    assert.equal(progress(b.answers).percent, 100);

    // 2. five ranked ideas, labelled as fixture evidence
    const ranked = w.rankIdeas(k);
    assert.equal(ranked.mode, 'fixture');
    assert.equal(ranked.ideas.length, 5, 'five ideas');
    assert.deepEqual(ranked.ideas.map((i) => i.rank), [1, 2, 3, 4, 5]);
    for (let i = 1; i < 5; i++) assert.ok(ranked.ideas[i - 1]!.fitScore >= ranked.ideas[i]!.fitScore, 'ranked best first');
    assert.ok(ranked.ideas.every((i) => i.notice.length > 0 && i.fitScoreLabel === 'fit score'));

    // 3. choose one: one business record and one queued build record, and a double click changes nothing
    const chosen = await w.chooseIdea(k);
    assert.equal(chosen.created, true);
    assert.equal(chosen.selection.job.status, 'queued');
    assert.equal(chosen.selection.job.type, 'build_business');
    assert.equal((await w.chooseIdea(k)).created, false, 'choosing again returns the same business');
    assert.equal(b.businessId, chosen.selection.business.id);
    assert.equal((await w.selections.list(b.seed.workspaceId)).length, 1);

    // not for sale before the store is published
    assert.equal(await loadPublishedStore('no-such-store', w.storeRegistry), null);

    // 4-8. brand -> product file -> catalogue price -> seller -> published test storefront, as one durable job
    const job = await w.build(k);
    assert.equal(job.kind, BUILD_JOB);
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(job.steps.map((s) => [s.name, s.status, s.attempts]), BUILD_STEPS.map((s) => [s, 'succeeded', 1]));
    assert.deepEqual(Object.values(b.effects), [1, 1, 1, 1, 1], 'each real step ran exactly once');

    const brand = await getApprovedBrand({ store: w.brands }, { workspaceId: b.seed.workspaceId }, b.businessId as string);
    assert.equal(brand?.status, 'approved');
    assert.equal(brand?.slug, b.slug);

    // a real, downloadable product file: PDF bytes pinned to the approved version's hash
    assert.ok(b.master && b.master.bytes.length > 500);
    // the buyer file is the factory's bundle: a zip (magic "PK") holding the rendered PDF, or a bare PDF
    const magic = Buffer.from(b.master.bytes.subarray(0, 5)).toString('latin1');
    assert.ok((b.master.contentType === 'application/zip' && magic.startsWith('PK')) || (b.master.contentType === 'application/pdf' && magic === '%PDF-'), `${b.master.contentType} ${magic}`);
    assert.match(b.master.fileName, /\.(zip|pdf)$/);
    if (b.master.contentType === 'application/zip') assert.ok(Buffer.from(b.master.bytes).includes('.pdf'), 'the bundle lists a PDF file');
    const version = (await w.products.listVersions(b.seed.workspaceId, b.productId as string)).find((v) => v.version === b.productVersion);
    assert.equal(version?.status, 'approved');
    assert.equal(version?.approvedHash, sha(b.master.bytes));

    const listing = await w.listing(k);
    assert.equal(listing.status, 'approved');
    assert.equal(listing.productId, b.productId);
    assert.ok(Number.isInteger(listing.priceMinor) && listing.priceMinor >= 100, 'price is whole cents');
    assert.equal(listing.currency, 'AUD');

    const store = await loadPublishedStore(b.slug as string, w.storeRegistry);
    assert.ok(store, 'the published storefront resolves');
    assert.equal(store.demo, false);
    assert.equal(store.status, 'published');
    assert.equal(store.brand.name, brand?.name);
    assert.equal(store.products.length, 1);
    const shown = findProduct(store, store.products[0]!.slug);
    assert.equal(shown?.priceMinor, listing.priceMinor, 'the storefront shows the catalogue price');
    assert.equal(shown?.title, listing.title);
    // KNOWN GAP (see test.todo below): the storefront buy button is still switched off by `checkoutBuilt = false`.
    assert.equal(purchaseState(store).canBuy, false);
    assert.equal(purchaseState(store, true).canBuy, true, 'it would be buyable once the flag is on: charges are enabled and the store is not a demo');

    // 9-10. fixture checkout -> pending order -> paid order
    const started = await w.startOrder(k);
    const before = (await w.fulfilment.listStoreOrders(w.scope(k))).find((r) => r.orderId === started.orderId);
    assert.deepEqual([before?.orderStatus, before?.fulfilmentStatus], ['pending', 'none'], 'the owner sees a pending order and nothing delivered');
    assert.equal(mails(w, b.seed.buyerEmail).length, 0);
    const event = await w.payEvent(started.sessionId);
    assert.equal((await w.checkout.handlePaymentEvent(event)).outcome, 'paid');

    // 11. delivery of the correct file
    const sent = mails(w, b.seed.buyerEmail);
    assert.equal(sent.length, 1);
    const token = w.tokenIn(sent[0]!);
    assert.ok(token);
    const res = await open(w, token);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(b.master.bytes), 'the buyer gets this business\'s approved file');

    // 12. the owner's order and delivery status, and what the buyer sees
    const rows = await w.fulfilment.listStoreOrders(w.scope(k));
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.deepEqual([row.orderId, row.orderStatus, row.fulfilmentStatus, row.amountMinor, row.currency, row.title, row.needsOwner], [started.orderId, 'paid', 'delivered', listing.priceMinor, 'AUD', listing.title, false]);
    assert.ok(row.deliveredAt && row.paidAt);
    const buyerView = await w.fulfilment.lookupBuyerOrder({ storeSlug: b.slug as string, reference: started.orderId, email: b.seed.buyerEmail });
    assert.equal(buyerView?.delivery, 'sent');
    assert.equal(buyerView?.orderStatus, 'paid');
    seen[k] = { niche: b.idea!.niche, slug: b.slug as string, productId: b.productId as string, price: listing.priceMinor, orderId: started.orderId, sha: sha(b.master.bytes) };
  }

  // two separate businesses
  assert.notEqual(w.biz.a.seed.workspaceId, w.biz.b.seed.workspaceId);
  assert.notEqual(w.biz.a.businessId, w.biz.b.businessId);
  assert.notEqual(seen.a.niche, seen.b.niche);
  assert.notEqual(seen.a.slug, seen.b.slug);
  assert.notEqual(seen.a.productId, seen.b.productId);
  assert.notEqual(seen.a.sha, seen.b.sha, 'each business sells its own file');
  assert.notEqual(seen.a.orderId, seen.b.orderId);
  assert.equal(w.email.outbox().length, 2, 'one delivery email per business, nothing extra');
});

// ---- 1 ----
test('journey 1: an interrupted build job resumes from its checkpoint and each step ran its effect once (service idempotency is NOT exercised)', async () => {
  const w = await createJourneyWorld();
  const k: JourneyKey = 'a';
  w.intake(k); w.rankIdeas(k); await w.chooseIdea(k);
  const ctx = (id: string) => ({ workspaceId: w.biz[k].seed.workspaceId, businessId: w.biz[k].businessId as string, actorUserId: w.biz[k].seed.ownerId, idempotencyKey: id });
  const { job, created } = await w.enqueueBuild(k);
  assert.equal(created, true);
  assert.equal((await w.enqueueBuild(k)).created, false, 'one build job per business, however many times it is started');

  // the worker stops after the first step
  const r1 = await w.jobs.runner('runner-1').runDue();
  assert.deepEqual(r1.map((r) => [r.step, r.outcome]), [['brand', 'succeeded']]);
  assert.deepEqual(Object.values(w.biz[k].effects), [1, 0, 0, 0, 0]);

  // a second worker claims "product", does the real work, and is killed before it can save its checkpoint
  const claims = await w.jobs.store.claim({ now: w.clock.t, owner: 'runner-2', leaseMs: 60_000, limit: 10 });
  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.job.steps[claims[0]!.stepIndex]!.name, 'product');
  await w.runStep(k, 'product');
  assert.equal(w.biz[k].effects.product, 1);
  assert.equal((await w.jobs.service.get(ctx(`build:${w.biz[k].businessId}`), job.id)).status, 'running');
  assert.deepEqual(await w.jobs.runner('runner-3').runDue(), [], 'nothing can take the job while the dead worker\'s lease is valid');

  // after the lease runs out a new worker resumes from the checkpoint
  w.clock.t += 60_001;
  await w.jobs.runner('runner-3').drain();
  const done = await w.jobs.service.get(ctx(`build:${w.biz[k].businessId}`), job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.steps.map((s) => [s.name, s.status]), BUILD_STEPS.map((s) => [s, 'succeeded']));
  assert.equal(done.steps[0]!.attempts, 1, 'the finished brand step was not run again');
  assert.equal(done.steps[1]!.attempts, 2, 'the lost product step ran again once');

  // The harness steps skip work they already did (`if (b.brand) return reused`), so the counters below are the harness's own and
  // the real services were never called twice. What follows reads the REAL stores through the real services.
  const b = w.biz[k];
  assert.deepEqual(Object.values(b.effects), [1, 1, 1, 1, 1], 'every harness step ran its effect exactly once (harness counters)');
  assert.equal((await getApprovedBrand({ store: w.brands }, { workspaceId: b.seed.workspaceId }, b.businessId as string))?.id, b.brand?.id, 'the one approved brand');
  assert.equal((await w.products.getProduct(b.seed.workspaceId, b.productId as string))?.id, b.productId, 'the one product exists');
  assert.deepEqual((await w.products.listVersions(b.seed.workspaceId, b.productId as string)).map((v) => [v.version, v.status]), [[1, 'approved']], 'one approved product version');
  const master = await w.storage.getMaster({ workspaceId: b.seed.workspaceId, businessId: b.businessId as string, productId: b.productId as string, version: b.productVersion as number });
  assert.equal(master && sha(master.bytes), sha(b.master!.bytes), 'one stored product file for that version');
  const listed = await w.catalogue.listApprovedForBusiness(w.catalogueCtx(k), b.businessId as string);
  assert.deepEqual(listed.map((l) => l.listingId), [b.listingId], 'exactly one approved listing for the business');
  const siteList = await w.sites.listSites({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId });
  assert.ok(siteList.ok);
  assert.deepEqual(siteList.value, [b.slug], 'exactly one site for the business');
  assert.equal((await listBrandVersions({ store: w.brands }, { workspaceId: b.seed.workspaceId }, b.businessId as string)).length, 1, 'one brand version');
  assert.equal((await w.products.listVersions(b.seed.workspaceId, b.productId as string)).length, 1, 'one product version');
  assert.equal((await w.catalogue.listVersions(w.catalogueCtx(k), b.listingId as string)).length, 1, 'one listing version');
  const history = await w.sites.history({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId }, b.slug as string);
  assert.ok(history.ok);
  assert.equal(history.value.versions.length, 1, 'one published store version');
  assert.equal((await w.sites.listSites({ workspaceId: b.seed.workspaceId, userId: b.seed.ownerId })).ok, true);
  const again = await w.build(k);
  assert.equal(again.id, job.id, 'starting the build again returns the finished job');
  assert.deepEqual(Object.values(b.effects), [1, 1, 1, 1, 1]);
  // the other business was never touched
  assert.deepEqual(Object.values(w.biz.b.effects), [0, 0, 0, 0, 0]);
});

// ---- 2 ----
test('journey 2: a repeated payment event yields exactly one order, one delivery and one delivery email', async () => {
  const w = await built();
  const k: JourneyKey = 'a';
  const b = w.biz[k];
  const { orderId, event } = await w.buy(k);
  const burst = await Promise.all([1, 2, 3, 4].map(() => w.checkout.handlePaymentEvent(event)));
  assert.ok(burst.every((r) => r.outcome === 'duplicate_event'));
  // and through the real webhook route handler, the way the provider would replay it
  const hook = createPaymentWebhookHandler(() => w.checkout);
  for (let i = 0; i < 2; i++) {
    const res = await hook(new Request('http://localhost/api/aimp/webhooks/payments', { method: 'POST', body: event.rawBody, headers: { 'stripe-signature': event.signature } }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { outcome?: string }).outcome, 'duplicate_event');
  }
  assert.equal((await w.orders.list(b.seed.workspaceId)).length, 1, 'one order');
  assert.equal((await w.fulfilmentStore.list(b.seed.workspaceId)).length, 1, 'one delivery');
  assert.equal((await w.files.listGrants({ workspaceId: b.seed.workspaceId, businessId: b.businessId as string }, orderItemId(orderId))).length, 1, 'one download grant');
  assert.equal(mails(w, b.seed.buyerEmail).length, 1, 'one delivery email');
  assert.equal(w.email.attempts(), 1, 'the email provider was called once');
  const order = await w.orders.get(b.seed.workspaceId, orderId);
  assert.equal(order?.status, 'paid');
  assert.equal(order?.paidEventId, event.eventId);
  // a forged copy of the event with a bad signature does nothing either
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: event.rawBody, signature: 'v1=forged' })).outcome, 'bad_signature');
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.list(w.biz.b.seed.workspaceId)).length, 0, 'the other business saw nothing');
});

// ---- 2b ----
test('journey 2b: a second event id for the same session, and two concurrent first deliveries, still give one order, one delivery, one grant, one email', async () => {
  const check = async (w: JourneyWorld, k: JourneyKey, orderId: string) => {
    const b = w.biz[k];
    assert.equal((await w.orders.list(b.seed.workspaceId)).length, 1, 'one order');
    assert.equal((await w.orders.get(b.seed.workspaceId, orderId))?.status, 'paid');
    assert.equal((await w.fulfilmentStore.list(b.seed.workspaceId)).length, 1, 'one delivery');
    assert.equal((await w.files.listGrants({ workspaceId: b.seed.workspaceId, businessId: b.businessId as string }, orderItemId(orderId))).length, 1, 'one download grant');
    assert.equal(mails(w, b.seed.buyerEmail).length, 1, 'one delivery email');
    assert.equal(w.email.attempts(), 1, 'the email provider was called once');
  };
  const eventFor = async (w: JourneyWorld, k: JourneyKey, orderId: string, sessionId: string, eventId: string): Promise<SignedEvent> => {
    const order = await w.orders.get(w.biz[k].seed.workspaceId, orderId);
    const seconds = Math.floor(w.now().getTime() / 1000);
    const rawBody = buildSessionCompletedBody({ eventId, sessionId, amountMinor: order!.amountMinor, createdSeconds: seconds });
    return { rawBody, signature: signPayload(FIXTURE_WEBHOOK_SECRET, rawBody, seconds), eventId };
  };

  // (a) the same checkout session paid again under a DIFFERENT event id
  const w1 = await built();
  const s1 = await w1.startOrder('a');
  const first = await eventFor(w1, 'a', s1.orderId, s1.sessionId, 'evt_journey_first');
  assert.equal((await w1.checkout.handlePaymentEvent(first)).outcome, 'paid');
  const second = await eventFor(w1, 'a', s1.orderId, s1.sessionId, 'evt_journey_second');
  assert.notEqual(second.eventId, first.eventId);
  const r2 = await w1.checkout.handlePaymentEvent(second);
  assert.notEqual(r2.outcome, 'paid', `a second event id must not pay the order again (got ${r2.outcome})`);
  await check(w1, 'a', s1.orderId);
  assert.equal((await w1.orders.get(w1.biz.a.seed.workspaceId, s1.orderId))?.paidEventId, first.eventId, 'the order keeps the first event id');

  // (b) two concurrent FIRST deliveries of the same event
  const w2 = await built();
  const s2 = await w2.startOrder('a');
  const ev = await w2.payEvent(s2.sessionId);
  const both = await Promise.all([w2.checkout.handlePaymentEvent(ev), w2.checkout.handlePaymentEvent(ev)]);
  assert.ok(both.some((r) => r.outcome === 'paid'), `one delivery pays the order (got ${both.map((r) => r.outcome).join(', ')})`);
  await check(w2, 'a', s2.orderId);

  // (c) two concurrent first deliveries under two different event ids
  const w3 = await built();
  const s3 = await w3.startOrder('a');
  const e1 = await eventFor(w3, 'a', s3.orderId, s3.sessionId, 'evt_journey_c1');
  const e2 = await eventFor(w3, 'a', s3.orderId, s3.sessionId, 'evt_journey_c2');
  await Promise.all([w3.checkout.handlePaymentEvent(e1), w3.checkout.handlePaymentEvent(e2)]);
  await check(w3, 'a', s3.orderId);
});

// ---- 3 ----
test('journey 3: a pending or unpaid order cannot download, and delivery starts only when payment is confirmed', async () => {
  const w = await built();
  const k: JourneyKey = 'a';
  const b = w.biz[k];
  const { orderId, sessionId } = await w.startOrder(k);
  const item = orderItemId(orderId);
  const denied = (e: unknown) => e instanceof FilesError && e.code === 'order_not_paid';
  await assert.rejects(w.files.issueGrant({ workspaceId: b.seed.workspaceId, businessId: b.businessId as string }, item), denied, 'no link can be issued for an unpaid line');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: b.seed.workspaceId, orderId })).outcome, 'order_not_paid');
  const re = await w.fulfilment.reissueAccess(w.scope(k), { orderId, reason: 'Buyer says they paid' });
  assert.equal(re.ok === false && re.code, 'order_not_paid');
  assert.equal((await w.fulfilment.retryDelivery(w.scope(k), orderId)).outcome, 'order_not_paid');
  assert.deepEqual(await w.files.listGrants({ workspaceId: b.seed.workspaceId, businessId: b.businessId as string }, item), []);
  assert.equal(w.email.outbox().length, 0, 'nothing was emailed');
  // a made-up link and an empty link are refused
  assert.equal((await w.files.redeem('not-a-real-token')).ok, false);
  assert.ok((await open(w, 'not-a-real-token')).status >= 400);
  assert.ok((await open(w, null)).status >= 400);
  // the owner and the buyer both see "not sent"
  const row = (await w.fulfilment.listStoreOrders(w.scope(k))).find((r) => r.orderId === orderId);
  assert.deepEqual([row?.orderStatus, row?.fulfilmentStatus, row?.deliveredAt], ['pending', 'none', null]);
  const view = await w.fulfilment.lookupBuyerOrder({ storeSlug: b.slug as string, reference: orderId, email: b.seed.buyerEmail });
  assert.equal(view?.orderStatus, 'pending');
  assert.notEqual(view?.delivery, 'sent');
  // a cancelled checkout never becomes paid: the order stays unpaid and can never be downloaded
  const hook = await w.payEvent(sessionId);
  assert.equal((await w.checkout.handlePaymentEvent({ rawBody: hook.rawBody, signature: 'v1=wrong' })).outcome, 'bad_signature');
  assert.equal((await w.orders.get(b.seed.workspaceId, orderId))?.status, 'pending');
  assert.equal(w.email.outbox().length, 0);
  // when the real signed event arrives the order is paid and the file is delivered once
  assert.equal((await w.checkout.handlePaymentEvent(hook)).outcome, 'paid');
  assert.equal(mails(w, b.seed.buyerEmail).length, 1);
  assert.equal((await open(w, w.tokenIn(w.email.outbox()[0]!))).status, 200);
});

// ---- 4 ----
test('journey 4: an expired download link has a working recovery (reissue) path', async () => {
  const w = await built();
  const k: JourneyKey = 'a';
  const b = w.biz[k];
  const { orderId } = await w.buy(k);
  const first = w.tokenIn(w.email.outbox()[0]!);
  assert.ok(first);
  assert.equal((await open(w, first)).status, 200, 'works while it is fresh');

  w.clock.t += 73 * HOUR; // the default link lasts 72 hours
  assert.equal((await open(w, first)).status, 410, 'the browser gets a plain "gone" answer');
  const expired = await w.files.redeem(first);
  assert.equal(expired.ok === false && expired.reason, 'expired');
  // the owner can see the delivered order and recover it
  const row = (await w.fulfilment.listStoreOrders(w.scope(k))).find((r) => r.orderId === orderId);
  assert.equal(row?.fulfilmentStatus, 'delivered');
  const re = await w.fulfilment.reissueAccess(w.scope(k), { orderId, reason: 'The link expired before the buyer opened it' });
  assert.ok(re.ok, re.ok ? '' : re.message);
  assert.equal(mails(w, b.seed.buyerEmail).length, 2, 'a fresh email went to the buyer');
  const second = w.tokenIn(w.email.outbox()[1]!);
  assert.ok(second && second !== first);
  const got = await w.files.redeem(second);
  assert.ok(got.ok);
  assert.equal(sha(got.file.bytes), sha(b.master!.bytes), 'the recovered link gives the same approved file');
  assert.equal((await open(w, first)).status, 410, 'the old link stays dead');
  // the other business cannot use this recovery path for this order
  const wrong = await w.fulfilment.reissueAccess(w.scope('b'), { orderId, reason: 'Wrong store' });
  assert.equal(wrong.ok === false && wrong.code, 'order_not_found');
  assert.equal(w.email.outbox().length, 2);
});

// ---- 5 ----
test('journey 5: business A cannot read or download business B\'s data, orders or files, and the reverse', async () => {
  const w = await built();
  const bought = { a: await w.buy('a'), b: await w.buy('b') };
  const token: Record<JourneyKey, string> = { a: w.tokenIn(mails(w, w.biz.a.seed.buyerEmail)[0]!)!, b: w.tokenIn(mails(w, w.biz.b.seed.buyerEmail)[0]!)! };
  assert.ok(token.a && token.b);

  for (const meK of JOURNEY_KEYS) {
    const themK = other(meK);
    const me = w.biz[meK];
    const them = w.biz[themK];
    const mine = { workspaceId: me.seed.workspaceId, businessId: me.businessId as string, actorId: me.seed.ownerId };
    const wrongTenant = (e: unknown) => e instanceof FilesError && e.code === 'wrong_tenant';
    // orders and delivery records
    assert.equal(await w.orders.get(me.seed.workspaceId, bought[themK].orderId), null);
    assert.deepEqual((await w.orders.list(me.seed.workspaceId)).map((o) => o.id), [bought[meK].orderId]);
    assert.deepEqual((await w.fulfilment.listStoreOrders(w.scope(meK))).map((r) => r.orderId), [bought[meK].orderId]);
    assert.equal(await w.fulfilment.getStoreOrder(w.scope(meK), bought[themK].orderId), null);
    assert.equal(await w.fulfilment.lookupBuyerOrder({ storeSlug: me.slug as string, reference: bought[themK].orderId, email: them.seed.buyerEmail }), null);
    assert.equal(await w.fulfilmentStore.get(me.seed.workspaceId, bought[themK].orderId), null);
    assert.equal((await w.fulfilment.retryDelivery(w.scope(meK), bought[themK].orderId)).outcome, 'order_not_found');
    const re = await w.fulfilment.reissueAccess(w.scope(meK), { orderId: bought[themK].orderId, reason: 'Trying the other business' });
    assert.equal(re.ok === false && re.code, 'order_not_found');
    assert.equal(JSON.stringify(await w.fulfilment.audit(w.scope(meK))).includes(bought[themK].event.eventId), false);
    // files: grants, masters, tokens
    const theirItem = orderItemId(bought[themK].orderId);
    assert.deepEqual(await w.files.listGrants(mine, theirItem), []);
    await assert.rejects(w.files.issueGrant(mine, theirItem), wrongTenant);
    await assert.rejects(w.files.reissueGrant(mine, theirItem), wrongTenant);
    const crossed = await w.files.redeem(token[themK], { businessId: me.businessId as string });
    assert.equal(crossed.ok === false && crossed.reason, 'wrong_tenant');
    assert.equal(await w.storage.getMaster({ workspaceId: me.seed.workspaceId, businessId: me.businessId as string, productId: them.productId as string, version: them.productVersion as number }), null);
    // products, catalogue, brand, selection, campaign, store, checkout
    assert.equal(await w.products.getProduct(me.seed.workspaceId, them.productId as string), null);
    assert.deepEqual(await w.products.listVersions(me.seed.workspaceId, them.productId as string), []);
    assert.equal(await w.catalogue.getListing({ ...w.catalogueCtx(meK) }, them.listingId as string), null);
    assert.deepEqual(await w.catalogue.listApprovedForBusiness(w.catalogueCtx(meK), them.businessId as string), []);
    assert.equal(await getApprovedBrand({ store: w.brands }, { workspaceId: me.seed.workspaceId }, them.businessId as string), undefined);
    assert.deepEqual((await w.selections.list(me.seed.workspaceId)).map((s) => s.business.id), [me.businessId]);
    assert.equal(await getCampaign({ store: w.campaigns }, { workspaceId: me.seed.workspaceId, businessId: them.businessId as string }), undefined);
    const denied = await w.sites.getDraft({ workspaceId: me.seed.workspaceId, userId: me.seed.ownerId }, them.slug as string);
    assert.equal(denied.ok === false && denied.code, 'denied');
    const hijack = await w.sites.publish({ workspaceId: me.seed.workspaceId, userId: me.seed.ownerId }, them.slug as string);
    assert.equal(hijack.ok === false && hijack.code, 'denied');
    const sneaky = await w.checkout.startCheckout({ storeSlug: me.slug as string, listingId: them.listingId as string, buyerEmail: 'sneaky@example.test', idempotencyKey: `sneaky-${meK}` });
    assert.equal(sneaky.ok, false, 'a store cannot sell the other store\'s listing');
    assert.equal((await open(w, token[themK])).status, 200, 'their link works for them, wherever it is opened, and only returns their file');
  }
  // each link still returns its own business's file, and nothing extra was emailed or created
  for (const k of JOURNEY_KEYS) {
    const r = await w.files.redeem(token[k]);
    assert.ok(r.ok);
    assert.equal(sha(r.file.bytes), sha(w.biz[k].master!.bytes));
    assert.equal((await w.orders.list(w.biz[k].seed.workspaceId)).length, 1);
  }
  assert.equal(w.email.outbox().length, 2);
  assert.notEqual(sha(w.biz.a.master!.bytes), sha(w.biz.b.master!.bytes));
});

// ---- 5b ----
test('journey 5b: two businesses in the SAME workspace cannot read each other\'s orders, files or listings', async (t) => {
  const w = await createJourneyWorld({ seeds: SAME_WORKSPACE_SEEDS });
  for (const k of JOURNEY_KEYS) {
    w.intake(k); w.rankIdeas(k); await w.chooseIdea(k);
    assert.equal((await w.build(k)).status, 'succeeded', `build for ${k}`);
  }
  assert.equal(w.biz.a.seed.workspaceId, w.biz.b.seed.workspaceId, 'one shared workspace');
  assert.notEqual(w.biz.a.businessId, w.biz.b.businessId, 'two different businesses');
  const bought = { a: await w.buy('a'), b: await w.buy('b') };
  const token: Record<JourneyKey, string> = { a: w.tokenIn(mails(w, w.biz.a.seed.buyerEmail)[0]!)!, b: w.tokenIn(mails(w, w.biz.b.seed.buyerEmail)[0]!)! };

  for (const meK of JOURNEY_KEYS) {
    const them = w.biz[other(meK)];
    const me = w.biz[meK];
    const theirOrder = bought[other(meK)].orderId;
    // Each check is its own subtest so one gap cannot hide another.
    await t.test(`${meK} reads b-side orders through the owner's order history`, async () => {
      assert.deepEqual((await w.fulfilment.listStoreOrders(w.scope(meK))).map((r) => r.orderId), [bought[meK].orderId]);
      assert.equal(await w.fulfilment.getStoreOrder(w.scope(meK), theirOrder), null, 'same answer as an order that does not exist');
      assert.equal((await w.fulfilment.getStoreOrder(w.scope(meK), 'order-does-not-exist')), null);
      assert.equal((await w.fulfilment.retryDelivery(w.scope(meK), theirOrder)).outcome, 'order_not_found');
      const re = await w.fulfilment.reissueAccess(w.scope(meK), { orderId: theirOrder, reason: 'Other business, same workspace' });
      assert.equal(re.ok === false && re.code, 'order_not_found');
    });
    await t.test(`${meK} cannot find the other business's order by buyer lookup`, async () => {
      assert.equal(await w.fulfilment.lookupBuyerOrder({ storeSlug: me.slug as string, reference: theirOrder, email: them.seed.buyerEmail }), null);
    });
    await t.test(`${meK} cannot download the other business's file with this business's id`, async () => {
      const crossed = await w.files.redeem(token[other(meK)], { businessId: me.businessId as string });
      assert.equal(crossed.ok === false && crossed.reason, 'wrong_tenant');
    });
    await t.test(`${meK} cannot list, issue or reissue the other business's download links (AMP-046)`, async () => {
      const mine = { workspaceId: me.seed.workspaceId, businessId: me.businessId as string };
      const theirItem = orderItemId(theirOrder);
      const missing = orderItemId('order-does-not-exist');
      const notFound = (e: unknown) => e instanceof FilesError && e.code === 'order_not_found';
      assert.deepEqual(await w.files.listGrants(mine, theirItem), [], 'same answer as a line that does not exist');
      assert.deepEqual(await w.files.listGrants(mine, missing), []);
      await assert.rejects(w.files.issueGrant(mine, theirItem), notFound);
      await assert.rejects(w.files.reissueGrant(mine, theirItem), notFound);
      await assert.rejects(w.files.issueGrant(mine, missing), notFound);
      assert.equal((await w.files.listGrants(mine, orderItemId(bought[meK].orderId))).length, 1, 'its own link is still listed');
    });
    await t.test(`${meK} cannot read the other business's catalogue listing`, async () => {
      assert.equal(await w.catalogue.getListing(w.catalogueCtx(meK), them.listingId as string), null);
      assert.deepEqual(await w.catalogue.listApprovedForBusiness(w.catalogueCtx(meK), them.businessId as string), []);
    });
    await t.test(`${meK} cannot sell the other business's listing`, async () => {
      const sneaky = await w.checkout.startCheckout({ storeSlug: me.slug as string, listingId: them.listingId as string, buyerEmail: 'sneaky@example.test', idempotencyKey: `sneaky5b-${meK}` });
      assert.equal(sneaky.ok, false);
    });
  }
});

// ---- 6 ----
test('journey 6: the campaign draft is built from the real catalogue and approved with no social adapter in the pipeline', async () => {
  const w = await built();

  for (const k of JOURNEY_KEYS) {
    const b = w.biz[k];
    const ctx = await w.campaignContext(k);
    assert.equal(ctx.store.status, 'live', 'the store the campaign links to is the published one');
    const made = await regenerateCampaign({ store: w.campaigns, now: w.now }, { ...ctx, startDate: '2026-12-01' });
    assert.ok(made.ok, made.ok ? '' : JSON.stringify(made.errors));
    const c = made.campaign;
    assert.equal(c.status, 'draft');
    assert.equal(c.plan.source, 'deterministic');
    assert.equal(c.plan.brand.name, b.brand?.name);
    assert.equal(c.plan.store.slug, b.slug);
    assert.equal(c.plan.items.length >= 14, true, 'a launch window of posts');
    const listing = await w.listing(k);
    for (const item of c.plan.items) {
      assert.equal(item.listingId, b.listingId, 'every post sells this business\'s own catalogue listing');
      assert.equal(item.productTitle, listing.title);
      assert.equal(item.priceMinor, listing.priceMinor);
      assert.ok(item.targetUrl.startsWith(`https://${b.slug}.stores.example.test/products/`), item.targetUrl);
    }
    // the campaign is approved on its own: no social adapter or publishing account is passed to it anywhere
    const approved = await approveCampaign({ store: w.campaigns, now: w.now }, ctx, b.seed.ownerId, { expectedVersion: c.version });
    assert.ok(approved.ok, approved.ok ? '' : JSON.stringify(approved.errors));
    assert.equal(approved.campaign.status, 'approved');
    const stored = await getApprovedCampaign({ store: w.campaigns }, { workspaceId: b.seed.workspaceId, businessId: b.businessId as string });
    assert.equal(stored?.status, 'approved');
    assert.equal(stored?.id, c.id);
    const publicListing = (await w.catalogue.listApprovedForBusiness(w.catalogueCtx(k), b.businessId as string)).find((l) => l.listingId === b.listingId);
    assert.ok(publicListing, 'the real approved catalogue listing exists');
    const published = await loadPublishedStore(b.slug as string, w.storeRegistry);
    assert.ok(published);
    const productUrl = `https://${b.slug}.stores.example.test/products/${published.products[0]!.slug}`;
    assert.ok(stored && stored.plan.items.length > 0);
    for (const i of stored.plan.items) assert.equal(i.targetUrl, productUrl, 'every link is the published product page of the real listing');
    // the other business's plan never mentions this business
    const text = JSON.stringify(c.plan);
    assert.equal(text.includes(w.biz[other(k)].slug as string), false);
    assert.equal(text.includes(w.biz[other(k)].businessId as string), false);
  }
  assert.notEqual((await getCampaign({ store: w.campaigns }, { workspaceId: w.biz.a.seed.workspaceId, businessId: w.biz.a.businessId as string }))?.id, (await getCampaign({ store: w.campaigns }, { workspaceId: w.biz.b.seed.workspaceId, businessId: w.biz.b.businessId as string }))?.id);
});

// ---- Steps that cannot be driven with the modules as they are today. Each names the exact gap. ----
test.todo('GAP: no production job kind builds a business: selectIdea saves a queued `build_business` record that nothing consumes, and the registered `generate-product` / `publish-site` kinds are demo stubs (lib/aimp/jobs/handlers.ts). This run uses a harness job kind over the real services.');
test.todo('GAP: the published storefront cannot take a purchase: lib/aimp/storefront/load.ts `checkoutBuilt = false`, so purchaseState() says "Checkout is not available yet." for a published, non-demo, charges-enabled store, and no storefront route calls /api/aimp/checkout. The checkout service itself is driven directly here.');
test.todo('GAP: no seam turns a published site-version into the checkout StoreDirectory or the files OrderBook workspace list (createOrderBook takes a fixed list of workspace ids). The harness supplies both from its own records.');
test.todo('GAP: campaigns have no notion of a publishing account (no connected/disconnected input), so "usable with no account connected" can only be shown by the plan being built and approved with no social adapter involved; AMP-052 posting is not built.');
test.todo('GAP: idempotency of the real build services under a repeated call is not exercised: the harness steps (lib/aimp/journey/world.ts) skip work they already did, so createBrandDraft, createProduct, catalogue.createDraft and sites.createSite are never called twice for one business.');

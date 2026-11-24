// AMP-154 (F08): review fixes for the opt-in backend. Refused submits leave nothing behind, hostile bodies are refused, caps hold under
// parallel posts, returned records are copies, and the sample email goes out once. Real service, memory store, fixture email. No network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SUBSCRIBERS_PER_BUSINESS, optInFormId, submitOptIn, submitUnsubscribe, UNSUBSCRIBE_OK_MESSAGE } from '../app/s/[store]/_server/audience.ts';
import type { OptInDeps } from '../app/s/[store]/_server/audience.ts';
import {
  MAX_CONSENT_RECORDS_PER_SUBSCRIBER, MAX_FORMS_PER_BUSINESS, createAudienceService, createMemoryAudienceStore,
} from '../lib/aimp/audience/index.ts';
import type { AudienceService } from '../lib/aimp/audience/index.ts';
import { registryFromSiteVersions } from '../lib/aimp/hosts/registry.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';
import { createSiteVersionStore, seedDemoSites } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WORKSPACE = 'demo-workspace';
const ACTOR = { workspaceId: WORKSPACE, userId: 'demo-owner' };
const CA = { workspaceId: WORKSPACE, businessId: 'biz-a' };
const CB = { workspaceId: WORKSPACE, businessId: 'biz-b' };
const FAILED = 'The sign-up could not be completed.';
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });

async function world(audienceOverride?: AudienceService) {
  const sites = createSiteVersionStore();
  for (const slug of ['shop-a', 'shop-b']) {
    assert.ok((await sites.createSite(ACTOR, storeFor(slug))).ok);
    assert.ok((await sites.publish(ACTOR, slug)).ok);
  }
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  const slugs = new Map([['biz-a', 'shop-a'], ['biz-b', 'shop-b']]);
  const email = createFixtureEmail();
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email });
  const deps: OptInDeps = {
    availability: () => ({ available: true, reason: '' }),
    world: async () => ({ audience: audienceOverride ?? audience, workspaceId: WORKSPACE, slugs, origin: { primary, sites } }),
  };
  return { deps, audience, email };
}

test('AMP-154 F08: a refused submit creates no form, no subscriber and no consent record', async () => {
  const { deps, audience } = await world();
  const bodies: unknown[] = [
    { email: 'a@y.co' }, { email: 'a@y.co', consentTicked: false }, { email: 'nope', consentTicked: true },
    { email: 'a@y.co', consentTicked: true, website: 'spam' },
  ];
  for (const b of bodies) await submitOptIn(deps, 'shop-a', b);
  await submitOptIn(deps, 'unknown-shop', { email: 'a@y.co', consentTicked: true });
  assert.equal(await audience.getForm(CA, optInFormId('biz-a')), null);
  assert.equal((await audience.listSubscribers(CA)).length, 0);
  assert.equal((await audience.consentLog(CA, 'a@y.co')).length, 0);
});

test('AMP-154 F08: array, non-object, prototype-key and object-valued bodies get the plain refusal and store nothing', async () => {
  const { deps, audience } = await world();
  const bad: unknown[] = [
    [], [{ email: 'a@y.co', consentTicked: true }], 'x', 7, true, null, undefined,
    JSON.parse('{"__proto__":{"x":1},"email":"a@y.co","consentTicked":true}'),
    JSON.parse('{"constructor":{"x":1},"email":"a@y.co","consentTicked":true}'),
    { email: { toString: () => 'a@y.co' }, consentTicked: true },
    { email: ['a@y.co'], consentTicked: true },
    { email: 'a@y.co', consentTicked: { v: 1 } },
    { email: 'a@y.co', consentTicked: true, utm_source: { a: 1 } },
    Object.create({ email: 'a@y.co', consentTicked: true }),
  ];
  for (const b of bad) {
    assert.deepEqual(await submitOptIn(deps, 'shop-a', b), { ok: false, message: FAILED }, JSON.stringify(b));
    assert.deepEqual(await submitUnsubscribe(deps, 'shop-a', b), { ok: false, message: FAILED }, JSON.stringify(b));
  }
  assert.equal(await audience.getForm(CA, optInFormId('biz-a')), null);
  assert.equal((await audience.listSubscribers(CA)).length, 0);
  assert.equal(({} as Record<string, unknown>).email, undefined);
});

test('AMP-154 F08: parallel sign-ups never push the stored count past the cap', async () => {
  const { deps, audience } = await world();
  const total = MAX_SUBSCRIBERS_PER_BUSINESS + 40;
  const replies = await Promise.all(Array.from({ length: total }, (_, i) => submitOptIn(deps, 'shop-a', { email: `p${i}@y.co`, consentTicked: true })));
  assert.equal((await audience.listSubscribers(CA)).length, MAX_SUBSCRIBERS_PER_BUSINESS);
  assert.equal(replies.filter((r) => r.ok).length, MAX_SUBSCRIBERS_PER_BUSINESS);
  for (const r of replies) assert.deepEqual(Object.keys(r).sort(), ['message', 'ok']);
});

test('AMP-154 F08: the store-level cap holds for parallel service captures; an existing address is still let through', async () => {
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  assert.ok((await audience.createForm(CA, { id: 'f', storeSlug: 's', wordingText: 'ok' })).ok);
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => audience.captureOptIn(CA, { formId: 'f', email: `q${i}@y.co`, consentTicked: true, maxSubscribers: 5 })));
  assert.equal((await audience.listSubscribers(CA)).length, 5);
  assert.equal(rs.filter((r) => !r.ok && r.code === 'full').length, 25);
  const stored = (await audience.listSubscribers(CA))[0].emailNorm;
  assert.equal((await audience.captureOptIn(CA, { formId: 'f', email: stored, consentTicked: true, maxSubscribers: 5 })).ok, true);
  assert.equal((await audience.listSubscribers(CA)).length, 5);
});

test('AMP-154 F08: at the consent cap the first record and the newest are kept, the oldest after the first is dropped', async () => {
  let t = 1000;
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail(), now: () => (t += 1) });
  assert.ok((await audience.createForm(CA, { id: 'f', storeSlug: 's', wordingText: 'ok' })).ok);
  const cycles = MAX_CONSENT_RECORDS_PER_SUBSCRIBER;
  let first = '';
  for (let i = 0; i < cycles; i += 1) {
    assert.ok((await audience.captureOptIn(CA, { formId: 'f', email: 'c@y.co', consentTicked: true })).ok);
    if (i === 0) first = (await audience.consentLog(CA, 'c@y.co'))[0].id;
    assert.ok((await audience.unsubscribe(CA, 'c@y.co')).ok);
  }
  const log = await audience.consentLog(CA, 'c@y.co');
  assert.equal(log.length, MAX_CONSENT_RECORDS_PER_SUBSCRIBER);
  assert.equal(log[0].decision, 'granted');
  assert.equal(log[0].id, first, 'the original grant is still there');
  assert.equal(log[log.length - 1].decision, 'withdrawn');
  assert.ok(log.every((r, i) => i === 0 || r.at > log[i - 1].at), 'order kept');
});

test('AMP-154 F08: the forms per business cap refuses plainly and does not touch another business', async () => {
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  const results = await Promise.all(Array.from({ length: MAX_FORMS_PER_BUSINESS + 5 }, (_, i) => audience.createForm(CA, { id: `f${i}`, storeSlug: 's', wordingText: 'ok' })));
  assert.equal(results.filter((r) => r.ok).length, MAX_FORMS_PER_BUSINESS);
  assert.equal(results.filter((r) => !r.ok).length, 5);
  assert.ok((await audience.createForm(CB, { id: 'f0', storeSlug: 's', wordingText: 'ok' })).ok);
  // an update of an existing form is not a new form
  assert.ok((await audience.updateForm(CA, 'f0', { wordingText: 'new' })).ok);
});

test('AMP-154 F08: records returned by the service cannot be changed from outside', async () => {
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  const made = await audience.createForm(CA, { id: 'f', storeSlug: 's', wordingText: 'ok', tags: ['a'] });
  assert.ok(made.ok);
  if (made.ok) { made.form.wordingText = 'HACKED'; made.form.tags.push('x'); }
  const form = await audience.getForm(CA, 'f');
  assert.equal(form?.wordingText, 'ok');
  assert.deepEqual(form?.tags, ['a']);
  if (form) form.businessId = 'biz-b';
  assert.equal((await audience.getForm(CA, 'f'))?.businessId, 'biz-a');

  const cap = await audience.captureOptIn(CA, { formId: 'f', email: 'm@y.co', consentTicked: true });
  assert.ok(cap.ok);
  if (cap.ok) { cap.subscriber.status = 'suppressed'; cap.subscriber.tags.push('evil'); }
  const [sub] = await audience.listSubscribers(CA);
  assert.equal(sub.status, 'subscribed');
  assert.deepEqual(sub.tags, ['a']);
  sub.status = 'suppressed';
  assert.equal(await audience.canSendMarketing(CA, 'm@y.co'), true);
  const log = await audience.consentLog(CA, 'm@y.co');
  log[0].decision = 'withdrawn';
  log[0].source.formId = 'changed';
  log.push(log[0]);
  const again = await audience.consentLog(CA, 'm@y.co');
  assert.equal(again.length, 1);
  assert.equal(again[0].decision, 'granted');
  assert.equal(again[0].source.formId, 'f');
});

test('AMP-154 F08: stopping emails for one address in one store leaves the same address in another store alone', async () => {
  const { deps, audience } = await world();
  assert.equal((await submitOptIn(deps, 'shop-a', { email: 'same@y.co', consentTicked: true })).ok, true);
  assert.equal((await submitOptIn(deps, 'shop-b', { email: 'same@y.co', consentTicked: true })).ok, true);
  const r = await submitUnsubscribe(deps, 'shop-a', { email: 'SAME@y.co' });
  assert.deepEqual(r, { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
  assert.equal(await audience.canSendMarketing(CA, 'same@y.co'), false);
  assert.equal(await audience.canSendMarketing(CB, 'same@y.co'), true);
  assert.equal((await audience.consentLog(CB, 'same@y.co')).length, 1);
  assert.equal((await audience.consentLog(CA, 'same@y.co')).length, 2);
});

test('AMP-154 F08: a throwing audience service gives the plain failed message with nothing about the address or the error', async () => {
  const boom = (): never => { throw new Error('db exploded for secret@y.co at 10.0.0.1'); };
  const failing = {
    createForm: boom, updateForm: boom, getForm: boom, captureOptIn: boom, unsubscribe: boom, suppress: boom, tag: boom, untag: boom,
    listSubscribers: boom, canSendMarketing: boom, consentLog: boom,
  } as unknown as AudienceService;
  const rejecting = Object.fromEntries(Object.keys(failing).map((k) => [k, async () => { throw new Error('db exploded for secret@y.co'); }])) as unknown as AudienceService;
  for (const svc of [failing, rejecting]) {
    const { deps } = await world(svc);
    const a = await submitOptIn(deps, 'shop-a', { email: 'secret@y.co', consentTicked: true });
    const b = await submitUnsubscribe(deps, 'shop-a', { email: 'secret@y.co' });
    assert.deepEqual(a, { ok: false, message: FAILED });
    assert.deepEqual(b, { ok: false, message: FAILED });
    assert.doesNotMatch(JSON.stringify([a, b]), /secret|exploded|10\.0\.0\.1/);
  }
});

test('AMP-154 F08: a concurrent double sample request sends one sample email', async () => {
  const email = createFixtureEmail();
  const audience = createAudienceService({ store: createMemoryAudienceStore(), email });
  assert.ok((await audience.createForm(CA, { id: 'f', storeSlug: 'shop-a', wordingText: 'ok', sampleProductId: 'prod-1' })).ok);
  const input = { formId: 'f', email: 's@y.co', consentTicked: true, sample: true, sampleProductTitle: 'Planner' };
  const [x, y] = await Promise.all([audience.captureOptIn(CA, input), audience.captureOptIn(CA, input)]);
  assert.ok(x.ok && y.ok);
  assert.equal(email.outbox().length, 1);
  assert.equal(email.outbox()[0].to, 's@y.co');
  // a later request for the same sample sends no second message either
  assert.ok((await audience.captureOptIn(CA, input)).ok);
  assert.equal(email.outbox().length, 1);
});

// AMP-160 (F08 review fixes f, g, h)
test('AMP-160 F08 f: two parallel createForm calls with the same id: the second is refused and the first stays untouched', async () => {
  const store = createMemoryAudienceStore();
  const audience = createAudienceService({ store, email: createFixtureEmail() });
  const [x, y] = await Promise.all([
    audience.createForm(CA, { id: 'f', storeSlug: 'shop-a', wordingText: 'first wording' }),
    audience.createForm(CA, { id: 'f', storeSlug: 'shop-a', wordingText: 'second wording' }),
  ]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  const loser = [x, y].find((r) => !r.ok);
  assert.ok(loser && !loser.ok && /already exists/.test(loser.message));
  const winner = [x, y].find((r) => r.ok);
  assert.ok(winner && winner.ok);
  assert.equal((await audience.getForm(CA, 'f'))?.wordingText, winner.ok ? winner.form.wordingText : '');
  // The same id in another business is a separate form and is fine.
  assert.ok((await audience.createForm(CB, { id: 'f', storeSlug: 'shop-b', wordingText: 'b wording' })).ok);
});

test('AMP-160 F08 g: the consent record stores exactly the wording that was read for that submit, even if the wording changes at once', async () => {
  const inner = createMemoryAudienceStore();
  const audience = createAudienceService({ store: inner, email: createFixtureEmail() });
  assert.ok((await audience.createForm(CA, { id: 'f', storeSlug: 'shop-a', wordingText: 'wording one' })).ok);
  let changeAfterRead = true;
  // The form is read, then the wording is changed before the submit reaches the store.
  const racing = {
    ...inner,
    async getForm(ctx: typeof CA, id: string) {
      const read = await inner.getForm(ctx, id);
      if (changeAfterRead) { changeAfterRead = false; await audience.updateForm(ctx, id, { wordingText: 'wording two' }); }
      return read;
    },
  };
  const racy = createAudienceService({ store: racing, email: createFixtureEmail() });
  assert.ok((await racy.captureOptIn(CA, { formId: 'f', email: 'r@y.co', consentTicked: true })).ok);
  const log = await audience.consentLog(CA, 'r@y.co');
  assert.equal(log.length, 1);
  assert.equal(log[0]!.wordingVersion, 1);
  assert.equal(log[0]!.wordingText, 'wording one');
  // The next submit reads the new wording and records it.
  assert.ok((await racy.captureOptIn(CA, { formId: 'f', email: 'r2@y.co', consentTicked: true })).ok);
  const next = await audience.consentLog(CA, 'r2@y.co');
  assert.deepEqual([next[0]!.wordingVersion, next[0]!.wordingText], [2, 'wording two']);
});

test('AMP-160 F08 h: a throwing store gives the plain failed reply and nothing was written', async () => {
  const inner = createMemoryAudienceStore();
  let writeCalls = 0;
  const down = (): never => { throw new Error('db exploded for secret@y.co'); };
  const throwing: typeof inner = {
    ...inner,
    getForm: down, get: down, list: down, consents: down,
    saveForm: async (...a) => { writeCalls += 1; return inner.saveForm(...a); },
    transact: async (...a) => { writeCalls += 1; return inner.transact(...a); },
  };
  const { deps } = await world(createAudienceService({ store: throwing, email: createFixtureEmail() }));
  const a = await submitOptIn(deps, 'shop-a', { email: 'secret@y.co', consentTicked: true });
  const b = await submitUnsubscribe(deps, 'shop-a', { email: 'secret@y.co' });
  assert.deepEqual(a, { ok: false, message: FAILED });
  assert.deepEqual(b, { ok: false, message: FAILED });
  assert.equal(writeCalls, 0);
  const probe = createAudienceService({ store: inner, email: createFixtureEmail() });
  assert.deepEqual(await probe.listSubscribers(CA), []);
  assert.equal(await probe.getForm(CA, optInFormId('biz-a')), null);
  assert.deepEqual(await probe.consentLog(CA, 'secret@y.co'), []);
});

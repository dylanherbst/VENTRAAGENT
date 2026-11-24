// AMP-159: the public store's email sign-up shows the wording the store's own form stores, and both public submits are rate limited
// per store. Same functions the page and the server actions call; real audience service, memory store, fixture email. No network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_OPT_IN_WORDING, OPT_IN_LIMIT_MAX_KEYS, OPT_IN_LIMIT_PER_WINDOW, OPT_IN_LIMIT_WINDOW_MS, RATE_LIMITED_MESSAGE, UNSUBSCRIBE_OK_MESSAGE,
  createOptInLimiter, optInFormId, readOptInWording, submitOptIn, submitUnsubscribe,
} from '../app/s/[store]/_server/audience.ts';
import type { OptInDeps } from '../app/s/[store]/_server/audience.ts';
import { PUBLIC_OK_MESSAGE, createAudienceService, createMemoryAudienceStore } from '../lib/aimp/audience/index.ts';
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
const storeFor = (slug: string): StoreConfig => ({ ...structuredClone(demoStore), slug });

async function world(opts: { limiter?: OptInDeps['limiter']; worldThrows?: boolean; audience?: AudienceService } = {}) {
  const sites = createSiteVersionStore();
  for (const slug of ['shop-a', 'shop-b']) {
    assert.ok((await sites.createSite(ACTOR, storeFor(slug))).ok);
    assert.ok((await sites.publish(ACTOR, slug)).ok);
  }
  const fixtures = createSiteVersionStore();
  await seedDemoSites(fixtures);
  const primary = registryFromSiteVersions(fixtures, async () => []);
  const slugs = new Map([['biz-a', 'shop-a'], ['biz-b', 'shop-b']]);
  const audience = opts.audience ?? createAudienceService({ store: createMemoryAudienceStore(), email: createFixtureEmail() });
  let worldReads = 0;
  const deps: OptInDeps = {
    availability: () => ({ available: true, reason: '' }),
    limiter: opts.limiter,
    world: async () => {
      worldReads += 1;
      if (opts.worldThrows) throw new Error('store down');
      return { audience, workspaceId: WORKSPACE, slugs, origin: { primary, sites } };
    },
  };
  return { deps, audience, reads: () => worldReads };
}

test('the page wording is the default before the first sign-up, with no form created by reading it', async () => {
  const { deps, audience } = await world();
  assert.equal(await readOptInWording(deps, 'shop-a'), DEFAULT_OPT_IN_WORDING);
  assert.equal(await audience.getForm(CA, optInFormId('biz-a')), null);
});

test('the page wording follows the stored form and is exactly what the consent record keeps', async () => {
  const { deps, audience } = await world();
  assert.ok((await audience.createForm(CA, { id: optInFormId('biz-a'), storeSlug: 'shop-a', wordingText: 'Send me the monthly planner news.' })).ok);
  const shown = await readOptInWording(deps, 'shop-a');
  assert.equal(shown, 'Send me the monthly planner news.');
  assert.deepEqual(await submitOptIn(deps, 'shop-a', { email: 'jo@y.co', consentTicked: true }), { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.equal((await audience.consentLog(CA, 'jo@y.co'))[0].wordingText, shown);
  // an owner change shows on the page at once, with the new version
  assert.ok((await audience.updateForm(CA, optInFormId('biz-a'), { wordingText: 'New wording v2.' })).ok);
  assert.equal(await readOptInWording(deps, 'shop-a'), 'New wording v2.');
  await submitOptIn(deps, 'shop-a', { email: 'kay@y.co', consentTicked: true });
  const rec = (await audience.consentLog(CA, 'kay@y.co'))[0];
  assert.equal(rec.wordingText, 'New wording v2.');
  assert.equal(rec.wordingVersion, 2);
  // store B has its own wording and never shows A's
  assert.equal(await readOptInWording(deps, 'shop-b'), DEFAULT_OPT_IN_WORDING);
});

test('when the wording cannot be read there is no sign-up form (null), never a guess', async () => {
  const down = await world({ worldThrows: true });
  assert.equal(await readOptInWording(down.deps, 'shop-a'), null);
  const base = await world();
  const broken: AudienceService = { ...base.audience, getForm: async () => { throw new Error('read failed'); } };
  const failing = await world({ audience: broken });
  assert.equal(await readOptInWording(failing.deps, 'shop-a'), null);
  const blank: AudienceService = { ...base.audience, getForm: async () => ({ wordingText: '   ' }) as never };
  assert.equal(await readOptInWording((await world({ audience: blank })).deps, 'shop-a'), null);
  // not a guided-setup store, bad address, no runtime, storage off
  for (const address of ['nope', 'demo', '', 5, null, 'bad slug!']) assert.equal(await readOptInWording(base.deps, address), null, String(address));
  assert.equal(await readOptInWording({ ...base.deps, world: async () => null }, 'shop-a'), null);
  assert.equal(await readOptInWording({ ...base.deps, availability: () => ({ available: false, reason: 'off' }) }, 'shop-a'), null);
});

test('sign-up is limited per store: over the limit gives one plain reply and writes nothing; store B is not affected', async () => {
  let t = 1_000;
  const limiter = createOptInLimiter(() => t);
  const { deps, audience, reads } = await world({ limiter });
  for (let i = 0; i < OPT_IN_LIMIT_PER_WINDOW; i += 1) {
    assert.equal((await submitOptIn(deps, 'shop-a', { email: `p${i}@y.co`, consentTicked: true })).ok, true);
  }
  const readsBefore = reads();
  const over = await submitOptIn(deps, 'shop-a', { email: 'late@y.co', consentTicked: true });
  assert.deepEqual(over, { ok: false, message: RATE_LIMITED_MESSAGE });
  assert.deepEqual(Object.keys(over).sort(), ['message', 'ok']);
  assert.ok(reads() >= readsBefore, 'the store lookup is allowed before the limit');
  assert.equal((await audience.listSubscribers(CA)).length, OPT_IN_LIMIT_PER_WINDOW);
  assert.equal((await audience.consentLog(CA, 'late@y.co')).length, 0);
  // the reply is the same whatever the address, subscribed or not
  const again = await submitOptIn(deps, 'shop-a', { email: 'p0@y.co', consentTicked: true });
  assert.deepEqual(again, over);
  assert.ok(!over.message.includes('@') && !/subscri/i.test(over.message));
  // another store keeps its own counter
  assert.equal((await submitOptIn(deps, 'shop-b', { email: 'b@y.co', consentTicked: true })).ok, true);
  assert.equal((await audience.listSubscribers(CB)).length, 1);
  // a minute later store A takes sign-ups again
  t += OPT_IN_LIMIT_WINDOW_MS;
  assert.equal((await submitOptIn(deps, 'shop-a', { email: 'late@y.co', consentTicked: true })).ok, true);
});

test('Stop emails is limited per store with the same reply and no change to the list; it has its own counter', async () => {
  const limiter = createOptInLimiter(() => 5_000);
  const { deps, audience, reads } = await world({ limiter });
  await submitOptIn(deps, 'shop-a', { email: 'keep@y.co', consentTicked: true });
  for (let i = 0; i < OPT_IN_LIMIT_PER_WINDOW; i += 1) {
    assert.deepEqual(await submitUnsubscribe(deps, 'shop-a', { email: `nobody${i}@y.co` }), { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
  }
  const readsBefore = reads();
  const over = await submitUnsubscribe(deps, 'shop-a', { email: 'keep@y.co' });
  assert.deepEqual(over, { ok: false, message: RATE_LIMITED_MESSAGE });
  assert.ok(reads() >= readsBefore);
  assert.equal(await audience.canSendMarketing(CA, 'keep@y.co'), true, 'a limited request changed nothing');
  assert.deepEqual(await submitUnsubscribe(deps, 'shop-a', { email: 'never@y.co' }), over);
  // the sign-up counter is separate, and store B's Stop counter is separate
  assert.equal((await submitOptIn(deps, 'shop-a', { email: 'more@y.co', consentTicked: true })).ok, true);
  assert.deepEqual(await submitUnsubscribe(deps, 'shop-b', { email: 'x@y.co' }), { ok: true, message: UNSUBSCRIBE_OK_MESSAGE });
});

test('the limiter keeps a bounded number of counters', async () => {
  const limiter = createOptInLimiter(() => 1);
  for (let i = 0; i < OPT_IN_LIMIT_MAX_KEYS * 3; i += 1) limiter.check(`store-${i}`, 'opt-in');
  assert.ok(limiter.size() <= OPT_IN_LIMIT_MAX_KEYS);
});

test('no audience read or write happens when limited, and invented addresses create no counters or reset a real store', async () => {
  const limiter = createOptInLimiter(() => 9_000);
  const base = await world({ limiter });
  let touched = 0;
  const watched = new Proxy(base.audience, {
    get: (target, prop, receiver) => {
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (...args: unknown[]) => { touched += 1; return (v as (...a: unknown[]) => unknown).apply(target, args); } : v;
    },
  });
  const { deps } = await world({ limiter, audience: watched });
  for (let i = 0; i < OPT_IN_LIMIT_PER_WINDOW; i += 1) {
    assert.equal((await submitOptIn(deps, 'shop-a', { email: `q${i}@y.co`, consentTicked: true })).ok, true);
    assert.equal((await submitUnsubscribe(deps, 'shop-a', { email: `z${i}@y.co` })).ok, true);
  }
  const sizeAtLimit = limiter.size();
  assert.equal(sizeAtLimit, 2);
  // 600 submits to well-formed made-up addresses (both forms) leave the limiter untouched
  for (let i = 0; i < 600; i += 1) {
    const reply = i % 2 === 0
      ? await submitOptIn(deps, `invented-${i}`, { email: 'x@y.co', consentTicked: true })
      : await submitUnsubscribe(deps, `invented-${i}`, { email: 'x@y.co' });
    assert.equal(reply.ok, false);
    assert.notEqual(reply.message, RATE_LIMITED_MESSAGE);
  }
  assert.equal(limiter.size(), sizeAtLimit, 'no counter was created for an invented address');
  // the real store, already at its limit, is still limited, and a limited request touches no audience function
  touched = 0;
  assert.deepEqual(await submitOptIn(deps, 'shop-a', { email: 'late@y.co', consentTicked: true }), { ok: false, message: RATE_LIMITED_MESSAGE });
  assert.deepEqual(await submitUnsubscribe(deps, 'shop-a', { email: 'late@y.co' }), { ok: false, message: RATE_LIMITED_MESSAGE });
  assert.equal(touched, 0, 'no audience read or write when limited');
});

test('without a limiter nothing is limited (existing test worlds)', async () => {
  const { deps } = await world();
  for (let i = 0; i < OPT_IN_LIMIT_PER_WINDOW + 3; i += 1) assert.equal((await submitUnsubscribe(deps, 'shop-a', { email: `n${i}@y.co` })).ok, true);
});

// Website Studio (screen 16, AMP-087; AMP-031 site versions). The server read and the action guard run against the REAL in-memory
// site-version store (the same `createSiteVersionStore` app/start/_server/runtime.ts puts on the /start runtime). app/start/actions.ts
// imports lib modules without a `.ts` extension, so the node test runner cannot load `storeAction` or this page's `websiteAction`:
// `handOver` below repeats the exact store calls `storeAction` makes for the op the guard returns. What is proven here is the guard
// (including every refusal), the read model, and that the op the guard hands over publishes / restores correctly on the store.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAD_REQUEST, NO_ACCESS, NO_BUSINESS, NO_DRAFT, NO_VERSION, NOT_CONFIRMED, alreadyLive, guardWebsiteOp, readOp,
} from '../app/app/[business]/website/_server/website-guard.ts';
import type { WebsiteGuardInput } from '../app/app/[business]/website/_server/website-guard.ts';
import { loadWebsite } from '../app/app/[business]/website/_server/website.ts';
import {
  NOTHING_EARLIER, NOTHING_NEW, NOTHING_PUBLISHED, buildPreview, checkDraftForm, cleanNote, isDirty, publishConfirm, rollbackConfirm, whenLabel,
} from '../app/app/[business]/website/view-model.ts';
import type { StoreOp } from '../app/start/journey-types.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';

const actor: Actor = { workspaceId: 'demo-workspace', userId: 'demo-owner' };
const stranger: Actor = { workspaceId: 'other-workspace', userId: 'someone-else' };
const A = 'biz-a';
const B = 'biz-b';
const ON = { available: true, reason: '' };

function makeRt() {
  let tick = 0;
  const sites = createSiteVersionStore({ now: () => new Date(Date.UTC(2026, 10, 15, 9, 30 + tick++)) });
  return { sites, slugs: new Map<string, string>(), businesses: new Set<string>(), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>() };
}
type Rt = ReturnType<typeof makeRt>;
const input = (rt: Rt, who: Actor = actor): WebsiteGuardInput => ({ availability: ON, rt: () => rt, actor: who });

/** Business A with a store draft (the demo store config), as guided set-up's "create" leaves it. */
async function withSite(rt: Rt, businessId = A, config = demoStore, owner: Actor = actor) {
  rt.businesses.add(businessId);
  const r = await rt.sites.createSite(owner, config);
  assert.equal(r.ok, true);
  rt.slugs.set(businessId, config.slug);
  return config.slug;
}

/** The store calls `storeAction` (app/start/actions.ts) makes for these ops. */
async function handOver(rt: Rt, businessId: string, op: StoreOp) {
  const slug = rt.slugs.get(businessId)!;
  switch (op.kind) {
    case 'save': return rt.sites.editDraft(actor, slug, (d) => { d.hero.heading = op.heading; d.hero.subheading = op.subheading; d.brand.tagline = op.tagline; }, { expectedRevision: op.expectedRevision });
    case 'preview': return rt.sites.previewDraft(actor, slug);
    case 'publish': return rt.sites.publish(actor, slug, { note: op.note, expectedRevision: op.expectedRevision });
    case 'rollback': return rt.sites.rollback(actor, slug, Number(op.version));
    default: throw new Error(`the guard must never hand over "${op.kind}"`);
  }
}

async function act(rt: Rt, businessId: string, raw: unknown) {
  const g = await guardWebsiteOp(input(rt), businessId, raw);
  if (!g.ok) return { guard: g, result: null };
  return { guard: g, result: await handOver(rt, businessId, g.op) };
}
const model = async (rt: Rt, businessId = A) => {
  const r = await loadWebsite(rt, actor, businessId);
  assert.ok(r.found && r.state === 'ready');
  return r.model;
};
const publish = async (rt: Rt, note = '', businessId = A) => act(rt, businessId, { kind: 'publish', note, expectedRevision: (await model(rt, businessId)).draft.revision, confirmed: true });
const save = async (rt: Rt, heading: string) => {
  const m = await model(rt);
  return act(rt, A, { kind: 'save', heading, subheading: m.draft.subheading, tagline: m.draft.tagline, expectedRevision: m.draft.revision });
};

test('AMP-087 read: unknown business, business with no store, and a fresh draft', async () => {
  const rt = makeRt();
  assert.deepEqual(await loadWebsite(rt, actor, A), { found: false });
  rt.businesses.add(A);
  assert.deepEqual(await loadWebsite(rt, actor, A), { found: true, state: 'no_site' });
  await withSite(rt);
  const m = await model(rt);
  assert.equal(m.status, 'draft');
  assert.equal(m.liveVersion, null);
  assert.equal(m.slug, demoStore.slug);
  assert.equal(m.draft.heading, demoStore.hero.heading);
  assert.equal(m.draft.productCount, demoStore.products.length);
  assert.deepEqual(m.versions, []);
  assert.equal(m.publish.allowed, true);
  assert.equal(m.rollbackNote, NOTHING_PUBLISHED);
});

test('AMP-087 read: a site owned by another workspace is never shown', async () => {
  const rt = makeRt();
  await withSite(rt, A, demoStore, stranger);
  const r = await loadWebsite(rt, actor, A);
  assert.ok(r.found && r.state === 'unreadable');
  assert.ok(r.errors.length > 0);
});

test('AMP-087 publish: the first publish makes version 1 live, with who, when and the note', async () => {
  const rt = makeRt();
  await withSite(rt);
  const { guard, result } = await publish(rt, 'First go');
  assert.equal(guard.ok, true);
  assert.ok(result?.ok);
  const m = await model(rt);
  assert.equal(m.status, 'live');
  assert.equal(m.liveVersion, 1);
  assert.equal(m.versions.length, 1);
  assert.deepEqual({ ...m.versions[0], publishedAt: '', publishedLabel: '' }, { version: 1, isLive: true, how: 'Published', publishedAt: '', publishedLabel: '', by: 'You', note: 'First go', canRollBack: false });
  assert.match(m.versions[0].publishedLabel, /^15 Nov 2026, 09:\d\d UTC$/);
  assert.equal(m.publish.allowed, false);
  assert.equal(m.publish.reason, NOTHING_NEW);
  assert.equal(m.rollbackNote, NOTHING_EARLIER);
  assert.equal((await rt.sites.resolvePublished(demoStore.slug)).status, 'live');
});

test('AMP-087 edit: saving the draft never changes what is live; publishing it does', async () => {
  const rt = makeRt();
  await withSite(rt);
  await publish(rt);
  const s = await save(rt, 'A brand new headline');
  assert.ok(s.guard.ok && s.result?.ok);
  let m = await model(rt);
  assert.equal(m.draft.heading, 'A brand new headline');
  assert.equal(m.draft.hasUnpublishedChanges, true);
  assert.equal(m.publish.allowed, true);
  let pub = await rt.sites.resolvePublished(demoStore.slug);
  assert.ok(pub.status === 'live' && pub.version === 1 && pub.config.hero.heading === demoStore.hero.heading);

  const p = await publish(rt, 'New headline');
  assert.ok(p.guard.ok && p.result?.ok);
  m = await model(rt);
  assert.equal(m.liveVersion, 2);
  assert.deepEqual(m.versions.map((v) => [v.version, v.isLive, v.canRollBack]), [[2, true, false], [1, false, true]]);
  assert.equal(m.rollbackNote, '');
  pub = await rt.sites.resolvePublished(demoStore.slug);
  assert.ok(pub.status === 'live' && pub.config.hero.heading === 'A brand new headline');
});

test('AMP-087 edit: a save the store refuses changes nothing (too long, stale revision)', async () => {
  const rt = makeRt();
  await withSite(rt);
  const long = await save(rt, 'x'.repeat(91));
  assert.equal(long.guard.ok, true);
  assert.ok(long.result && !long.result.ok && long.result.code === 'invalid');
  const m = await model(rt);
  const stale = await act(rt, A, { kind: 'save', heading: 'Late edit', subheading: m.draft.subheading, tagline: m.draft.tagline, expectedRevision: m.draft.revision + 5 });
  assert.ok(stale.result && !stale.result.ok && stale.result.code === 'conflict');
  assert.equal((await model(rt)).draft.heading, demoStore.hero.heading);
});

test('AMP-087 rollback: going back republishes the old version as a new one and leaves the draft alone', async () => {
  const rt = makeRt();
  await withSite(rt);
  await publish(rt);
  await save(rt, 'Second headline');
  await publish(rt);
  const r = await act(rt, A, { kind: 'rollback', version: 1, confirmed: true });
  assert.ok(r.guard.ok && r.result?.ok);
  const m = await model(rt);
  assert.equal(m.liveVersion, 3);
  assert.equal(m.versions[0].how, 'Brought back from version 1');
  assert.deepEqual(m.versions.map((v) => v.isLive), [true, false, false]);
  assert.equal(m.draft.heading, 'Second headline');
  assert.equal(m.draft.hasUnpublishedChanges, true);
  const pub = await rt.sites.resolvePublished(demoStore.slug);
  assert.ok(pub.status === 'live' && pub.version === 3 && pub.config.hero.heading === demoStore.hero.heading);
});

test('AMP-087 refusals: demo storage off, bad id, unknown business, no draft, bad shape, not confirmed', async () => {
  const rt = makeRt();
  const pubOp = { kind: 'publish', note: '', expectedRevision: 1, confirmed: true };
  let touched = false;
  const off = await guardWebsiteOp({ availability: { available: false, reason: 'Off here.' }, rt: () => { touched = true; return rt; }, actor }, A, pubOp);
  assert.deepEqual(off, { ok: false, message: 'Off here.' });
  assert.equal(touched, false);
  assert.deepEqual(await guardWebsiteOp(input(rt), '../etc', pubOp), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(await guardWebsiteOp(input(rt), 42, pubOp), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, pubOp), { ok: false, message: NO_BUSINESS });

  // Publishing with no draft: the business exists but has no store.
  rt.businesses.add(A);
  assert.deepEqual(await guardWebsiteOp(input(rt), A, pubOp), { ok: false, message: NO_DRAFT });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'rollback', version: 1, confirmed: true }), { ok: false, message: NO_DRAFT });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'save', heading: 'a', subheading: 'b', tagline: 'c', expectedRevision: 1 }), { ok: false, message: NO_DRAFT });

  await withSite(rt);
  for (const bad of [null, 'publish', {}, { kind: 'pause' }, { kind: 'unpause' }, { kind: 'create' }, { kind: 'sync', expectedRevision: 1 }, { kind: 'publish', note: 5, expectedRevision: 1, confirmed: true },
    { kind: 'publish', note: 'x'.repeat(201), expectedRevision: 1, confirmed: true }, { kind: 'rollback', version: '1', confirmed: true }, { kind: 'rollback', version: 1.5, confirmed: true },
    { kind: 'save', heading: 'a', subheading: 'b', expectedRevision: 1 }, { kind: 'save', heading: 'a', subheading: 'b', tagline: 'c', expectedRevision: 0 }]) {
    assert.deepEqual(await guardWebsiteOp(input(rt), A, bad), { ok: false, message: BAD_REQUEST }, JSON.stringify(bad));
  }
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'publish', note: '', expectedRevision: 1 }), { ok: false, message: NOT_CONFIRMED });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'publish', note: '', expectedRevision: 1, confirmed: 'yes' }), { ok: false, message: NOT_CONFIRMED });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'rollback', version: 1 }), { ok: false, message: NOT_CONFIRMED });
  assert.equal((await model(rt)).liveVersion, null);
});

test('AMP-087 refusals: nothing new to publish, a stale publish, nothing to roll back to, unknown and live versions', async () => {
  const rt = makeRt();
  await withSite(rt);
  const back = (version: number) => guardWebsiteOp(input(rt), A, { kind: 'rollback', version, confirmed: true });
  assert.deepEqual(await back(1), { ok: false, message: NOTHING_PUBLISHED });

  await publish(rt);
  assert.deepEqual(await back(1), { ok: false, message: NOTHING_EARLIER });
  assert.deepEqual((await publish(rt)).guard, { ok: false, message: NOTHING_NEW });

  await save(rt, 'Second headline');
  const m = await model(rt);
  const stale = await act(rt, A, { kind: 'publish', note: '', expectedRevision: m.draft.revision - 1, confirmed: true });
  assert.equal(stale.guard.ok, true);
  assert.ok(stale.result && !stale.result.ok && stale.result.code === 'conflict');
  assert.equal((await model(rt)).liveVersion, 1);

  await publish(rt);
  assert.deepEqual(await back(9), { ok: false, message: NO_VERSION });
  assert.deepEqual(await back(2), { ok: false, message: alreadyLive(2) });
  assert.equal((await back(1)).ok, true);
  assert.equal((await model(rt)).versions.length, 2);
});

test('AMP-087 wrong business: one business can never publish or roll back another business\'s store', async () => {
  const rt = makeRt();
  await withSite(rt, A, demoStore);
  await withSite(rt, B, demoStoreB);
  await publish(rt, '', A);
  await save(rt, 'Only for A');
  await publish(rt, '', A);

  // B asks to roll back to "version 1": the guard looks at B's own store (nothing published), never at A's.
  assert.deepEqual(await guardWebsiteOp(input(rt), B, { kind: 'rollback', version: 1, confirmed: true }), { ok: false, message: NOTHING_PUBLISHED });
  // B publishes: only B's store changes.
  const p = await publish(rt, '', B);
  assert.ok(p.guard.ok && p.result?.ok);
  assert.equal((await model(rt, A)).liveVersion, 2);
  assert.equal((await model(rt, B)).liveVersion, 1);
  const pubA = await rt.sites.resolvePublished(demoStore.slug);
  assert.ok(pubA.status === 'live' && pubA.config.hero.heading === 'Only for A');

  // A caller from another workspace is refused by the store before anything is handed over.
  const rtX = makeRt();
  await withSite(rtX, A, demoStore, stranger);
  const denied = await guardWebsiteOp(input(rtX), A, { kind: 'publish', note: '', expectedRevision: 1, confirmed: true });
  assert.ok(!denied.ok && denied.message === NO_ACCESS && (denied.errors?.length ?? 0) > 0);
  const deniedBack = await guardWebsiteOp(input(rtX), A, { kind: 'rollback', version: 1, confirmed: true });
  assert.ok(!deniedBack.ok && deniedBack.message === NO_ACCESS);
  assert.equal((await rtX.sites.resolvePublished(demoStore.slug)).status, 'none');
});

test('AMP-087 guard hands over only the four ops this page offers, with trimmed text', async () => {
  const rt = makeRt();
  await withSite(rt);
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'preview', extra: 1 }), { ok: true, op: { kind: 'preview' } });
  assert.deepEqual(await guardWebsiteOp(input(rt), A, { kind: 'save', heading: '  Hi ', subheading: ' there ', tagline: ' tag ', expectedRevision: 1, slug: 'other' }),
    { ok: true, op: { kind: 'save', heading: 'Hi', subheading: 'there', tagline: 'tag', expectedRevision: 1 } });
  assert.deepEqual(readOp({ kind: 'rollback', version: 2, confirmed: true, slug: 'other' }), { kind: 'rollback', version: 2, confirmed: true });
  const prev = await act(rt, A, { kind: 'preview' });
  assert.ok(prev.result?.ok && 'render' in prev.result.value);
  const p = buildPreview(prev.result.value);
  assert.equal(p.heading, demoStore.hero.heading);
  assert.equal(p.products.length, demoStore.products.length);
  assert.match(p.products[0].price, /^\$\d/);
});

test('AMP-087 paused store: shown as paused, and the live row says so', async () => {
  const rt = makeRt();
  await withSite(rt);
  await publish(rt);
  await rt.sites.pause(actor, demoStore.slug);
  const m = await model(rt);
  assert.equal(m.status, 'paused');
  assert.match(m.statusText, /paused/);
  assert.match(publishConfirm(m).text, /paused/);
});

test('AMP-087 view-model helpers: form checks, labels and confirm copy', () => {
  const ok = { heading: 'Hello', subheading: 'World', tagline: 'Tag' };
  assert.deepEqual(checkDraftForm(ok), {});
  const bad = checkDraftForm({ heading: '   ', subheading: 'x'.repeat(221), tagline: 'a <b>' });
  assert.match(bad.heading!, /cannot be empty/);
  assert.match(bad.subheading!, /at most 220 characters\. It is 221\./);
  assert.match(bad.tagline!, /< or >/);
  assert.equal(isDirty(ok, { ...ok }), false);
  assert.equal(isDirty({ ...ok, tagline: 'New' }, ok), true);
  assert.equal(whenLabel('2026-11-05T07:04:00.000Z'), '5 Nov 2026, 07:04 UTC');
  assert.equal(whenLabel('nonsense'), 'Unknown time');
  assert.equal(cleanNote('New headline [publish-check]'), 'New headline');
  assert.equal(cleanNote('[publish-check]'), '');
  assert.match(publishConfirm({ liveVersion: null, status: 'draft' }).text, /version 1/);
  assert.match(publishConfirm({ liveVersion: 3, status: 'live' }).text, /replaces version 3/);
  assert.match(rollbackConfirm(1, 3).text, /Nothing is deleted/);
});

// Marketing overview (screen 25, AMP-129; AMP-050 campaigns; F01 F11 H03). The loader, the guard and `runMarketingOp` (the whole body
// of the page's server action) run here against the REAL campaign service on its memory store, with the real brand, catalogue and
// site-version services of the campaign demo fixtures (lib/aimp/campaigns/demo.ts `buildCampaignDemo`). Nothing is a copy of the logic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALREADY_APPROVED, BAD_REQUEST, NO_BUSINESS, NO_CAMPAIGN_STORE, NO_PLAN, NOT_APPROVED, NOT_CONFIRMED, NOT_DRAFTED, STALE, WENT_WRONG, approved, drafted,
  guardMarketingOp, readOp, runMarketingOp,
} from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import type { MarketingGuardInput } from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import { campaignStoreOf, loadMarketing } from '../app/app/[business]/marketing/_server/marketing.ts';
import type { MarketingContexts, MarketingRuntime } from '../app/app/[business]/marketing/_server/marketing.ts';
import { NOTHING_POSTED, NOT_IN_DEMO, SOON, approveConfirm, buildMarketingModel, dayLabel, redraftConfirm } from '../app/app/[business]/marketing/view-model.ts';
import { getApprovedBrand } from '../lib/aimp/branding/service.ts';
import { buildCampaignDemo } from '../lib/aimp/campaigns/demo.ts';
import { getApprovedCampaign, getCampaign } from '../lib/aimp/campaigns/service.ts';
import { DEMO_BUSINESS, DEMO_WORKSPACE, demoCtx } from '../lib/aimp/catalogue/demo.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

const A = DEMO_BUSINESS;
const ON = { available: true, reason: '' };
const actor: Actor = { workspaceId: DEMO_WORKSPACE, userId: 'demo-owner' };
const now = () => new Date(Date.UTC(2026, 10, 15, 9, 30));
const ctx: MarketingContexts = { workspaceId: DEMO_WORKSPACE, ownerId: 'demo-owner', catalogueCtx: (businessId) => ({ ...demoCtx, businessId }) };
const otherWorkspace: MarketingContexts = { ...ctx, workspaceId: 'other-workspace', catalogueCtx: (businessId) => ({ ...demoCtx, workspaceId: 'other-workspace', businessId }) };

/** The demo business (approved brand, two approved listings, one draft listing) with its store published at the brand's address. */
async function makeRt(opts: { campaigns?: boolean; publish?: boolean } = {}) {
  const demo = await buildCampaignDemo(now, {});
  const brand = await getApprovedBrand({ store: demo.d.brands }, { workspaceId: DEMO_WORKSPACE }, A);
  assert.ok(brand);
  const sites = createSiteVersionStore({ now });
  const slugs = new Map<string, string>();
  if (opts.publish !== false) {
    assert.equal((await sites.createSite(actor, { ...demoStore, slug: brand.slug })).ok, true);
    const d = await sites.getDraft(actor, brand.slug);
    assert.ok(d.ok);
    const p = await sites.publish(actor, brand.slug, { note: '', expectedRevision: d.value.revision });
    assert.equal(p.ok, true, JSON.stringify(p));
    slugs.set(A, brand.slug);
  }
  const rt: MarketingRuntime = {
    businesses: new Set([A]), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>(), slugs,
    brands: demo.d.brands, catalogue: demo.d.catalogue, sites,
    ...(opts.campaigns === false ? {} : { campaigns: demo.campaigns }),
  };
  return { rt, demo, sites, slug: brand.slug };
}
const input = (rt: MarketingRuntime, c: MarketingContexts = ctx): MarketingGuardInput => ({ availability: ON, rt: () => rt, ctx: c, now });
const DRAFT = { kind: 'draft', confirmed: true };
const approve = (expectedVersion: number) => ({ kind: 'approve', expectedVersion, confirmed: true });
const model = async (rt: MarketingRuntime, c: MarketingContexts = ctx, businessId: unknown = A) => {
  const r = await loadMarketing(rt, c, businessId);
  assert.ok(r.found && r.state === 'ready');
  return r.model;
};

test('AMP-129 states: no campaign, then a draft from the real catalogue, then approved', async () => {
  const { rt, demo, slug } = await makeRt();
  assert.deepEqual(await model(rt), { state: 'none' });

  assert.deepEqual(await runMarketingOp(input(rt), A, DRAFT), { ok: true, message: drafted(1), errors: [] });
  const m = await model(rt);
  assert.ok(m.state === 'draft');
  assert.equal(m.version, 1);
  assert.equal(m.statusLabel, 'Draft');
  assert.ok(m.audience.who.length > 0 && m.audience.problem.length > 0 && m.audience.whereTheyAre.length > 0);
  assert.deepEqual(m.channels.map((c) => [c.channel, c.role]), [['pinterest', 'Main channel'], ['instagram', 'Copy out and post by hand'], ['tiktok', 'Copy out and post by hand']]);
  assert.equal(m.channels.reduce((n, c) => n + c.pieces, 0), m.summary.pieces);
  assert.ok(m.summary.pieces > 0 && m.summary.activeDays > 0 && m.pillars.length > 0);
  assert.equal(m.summary.wording, 'Built-in plan (no AI call)');
  assert.match(m.summary.windowLabel, /^15 Nov 2026 to \d{1,2} \w{3} 202\d$/);
  // Product links: exactly the two approved listings (the draft listing is left out), each linking into this store.
  assert.deepEqual(m.products.map((p) => p.listingId).sort(), [...demo.listingIds.approved].sort());
  for (const p of m.products) { assert.ok(p.url.includes(slug), p.url); assert.match(p.priceLabel, /\d/); }
  assert.equal(m.approvedLabel, null);
  assert.equal(await getApprovedCampaign({ store: demo.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A }), undefined);

  assert.deepEqual(await runMarketingOp(input(rt), A, approve(1)), { ok: true, message: approved(1), errors: [] });
  const done = await model(rt);
  assert.ok(done.state === 'approved');
  assert.equal(done.approvedLabel, '15 Nov 2026');
  const saved = await getApprovedCampaign({ store: demo.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A });
  assert.equal(saved?.approvedBy, 'demo-owner');

  assert.deepEqual(await runMarketingOp(input(rt), A, approve(1)), { ok: false, message: ALREADY_APPROVED, errors: [] });
  // A new draft replaces the approved plan and needs a new yes.
  assert.deepEqual(await runMarketingOp(input(rt), A, DRAFT), { ok: true, message: drafted(2), errors: [] });
  assert.equal((await model(rt)).state, 'draft');
});

test('AMP-129 approve: a stale version is refused with a plain reload message and nothing changes', async () => {
  const { rt, demo } = await makeRt();
  assert.deepEqual(await runMarketingOp(input(rt), A, approve(1)), { ok: false, message: NO_PLAN, errors: [] });
  await runMarketingOp(input(rt), A, DRAFT);
  await runMarketingOp(input(rt), A, DRAFT);
  assert.deepEqual(await runMarketingOp(input(rt), A, approve(1)), { ok: false, message: STALE, errors: [] });
  assert.match(STALE, /changed since you opened it.*Reload/);
  assert.equal((await getCampaign({ store: demo.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A }))?.status, 'draft');
  assert.equal((await runMarketingOp(input(rt), A, approve(2))).ok, true);
});

test('AMP-129 refusals: demo storage off, bad ids, prototype keys, unknown business, bad shape, not confirmed', async () => {
  const { rt, demo } = await makeRt();
  let touched = false;
  const off = await runMarketingOp({ availability: { available: false, reason: 'Off here.' }, rt: () => { touched = true; return rt; }, ctx, now }, A, DRAFT);
  assert.deepEqual(off, { ok: false, message: 'Off here.', errors: [] });
  assert.equal(touched, false);

  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', '../etc', '', 42, null, undefined, {}, ['demo-business'], 'biz-unknown']) {
    assert.deepEqual(await runMarketingOp(input(rt), bad, DRAFT), { ok: false, message: NO_BUSINESS, errors: [] }, String(bad));
    assert.deepEqual(await runMarketingOp(input(rt), bad, approve(1)), { ok: false, message: NO_BUSINESS, errors: [] }, String(bad));
    assert.deepEqual(await loadMarketing(rt, ctx, bad), { found: false }, String(bad));
  }
  for (const bad of [null, 'draft', {}, { kind: 'publish' }, { kind: 'post' }, { kind: 'schedule' }, { kind: 'approve', confirmed: true }, { kind: 'approve', expectedVersion: '1', confirmed: true },
    { kind: 'approve', expectedVersion: 0, confirmed: true }, { kind: 'approve', expectedVersion: 1.5, confirmed: true }, JSON.parse('{"__proto__":{"kind":"draft","confirmed":true}}')]) {
    assert.deepEqual(await runMarketingOp(input(rt), A, bad), { ok: false, message: BAD_REQUEST, errors: [] }, JSON.stringify(bad));
  }
  assert.deepEqual(await runMarketingOp(input(rt), A, { kind: 'draft' }), { ok: false, message: NOT_CONFIRMED, errors: [] });
  assert.deepEqual(await runMarketingOp(input(rt), A, { kind: 'approve', expectedVersion: 1, confirmed: 'yes' }), { ok: false, message: NOT_CONFIRMED, errors: [] });
  assert.equal(await demo.campaigns.get(DEMO_WORKSPACE, A), null);
  // Only the shape the page offers survives; a workspace or business in the request body is dropped.
  assert.deepEqual(readOp({ kind: 'approve', expectedVersion: 3, confirmed: true, workspaceId: 'other-workspace', businessId: 'biz-b' }), { kind: 'approve', expectedVersion: 3, confirmed: true });
  assert.equal(guardMarketingOp(input(rt), A, DRAFT).ok, true);
});

test('AMP-129 another business: it never sees or approves this business\'s plan', async () => {
  const { rt, demo } = await makeRt();
  rt.businesses = new Set([A, 'biz-b']);
  await runMarketingOp(input(rt), A, DRAFT);
  assert.deepEqual(await model(rt, ctx, 'biz-b'), { state: 'none' });
  assert.deepEqual(await runMarketingOp(input(rt), 'biz-b', approve(1)), { ok: false, message: NO_PLAN, errors: [] });
  // B has no brand, listings or store of its own, so no plan can be written for it from A's catalogue.
  const b = await runMarketingOp(input(rt), 'biz-b', DRAFT);
  assert.ok(!b.ok && b.message === NOT_DRAFTED && b.errors.length > 0);
  assert.equal(await demo.campaigns.get(DEMO_WORKSPACE, 'biz-b'), null);
  // A request body that names business A while acting as B changes nothing for A.
  await runMarketingOp(input(rt), 'biz-b', { ...approve(1), businessId: A });
  assert.equal((await demo.campaigns.get(DEMO_WORKSPACE, A))?.status, 'draft');
});

test('AMP-129 another workspace: the same business id reads as no plan and can not approve or replace it', async () => {
  const { rt, demo } = await makeRt();
  await runMarketingOp(input(rt), A, DRAFT);
  assert.deepEqual(await model(rt, otherWorkspace), { state: 'none' });
  assert.deepEqual(await runMarketingOp(input(rt, otherWorkspace), A, approve(1)), { ok: false, message: NO_PLAN, errors: [] });
  const d = await runMarketingOp(input(rt, otherWorkspace), A, DRAFT);
  assert.ok(!d.ok && d.message === NOT_DRAFTED);
  assert.equal(await demo.campaigns.get('other-workspace', A), null);
  const mine = await demo.campaigns.get(DEMO_WORKSPACE, A);
  assert.ok(mine && mine.status === 'draft' && mine.version === 1);
});

test('AMP-129 missing campaign store: the page says so and both actions are refused', async () => {
  const { rt } = await makeRt({ campaigns: false });
  assert.equal(campaignStoreOf(rt), null);
  assert.deepEqual(await loadMarketing(rt, ctx, A), { found: true, state: 'unavailable' });
  assert.deepEqual(await loadMarketing(rt, ctx, 'biz-unknown'), { found: false });
  assert.deepEqual(await runMarketingOp(input(rt), A, DRAFT), { ok: false, message: NO_CAMPAIGN_STORE, errors: [] });
  assert.deepEqual(await runMarketingOp(input(rt), A, approve(1)), { ok: false, message: NO_CAMPAIGN_STORE, errors: [] });
  assert.match(NO_CAMPAIGN_STORE, /not available in the demo yet/);
});

test('AMP-129 real state: no published store means no draft; a paused store means no approval', async () => {
  const unpublished = await makeRt({ publish: false });
  const r = await runMarketingOp(input(unpublished.rt), A, DRAFT);
  assert.ok(!r.ok && r.message === NOT_DRAFTED && r.errors.length > 0);
  assert.deepEqual(await model(unpublished.rt), { state: 'none' });

  const { rt, sites, slug } = await makeRt();
  await runMarketingOp(input(rt), A, DRAFT);
  assert.equal((await sites.pause(actor, slug)).ok, true);
  const p = await runMarketingOp(input(rt), A, approve(1));
  assert.ok(!p.ok && p.message === NOT_APPROVED && p.errors.some((e) => /paused/.test(e)));
  assert.equal((await model(rt)).state, 'draft');
});

test('AMP-129: a read that throws becomes one plain reply that claims neither outcome; only the error name is logged', async () => {
  const { rt } = await makeRt();
  const boom = (Err: ErrorConstructor) => new Proxy({}, { get: () => () => { throw new Err('store down: secret-detail'); } }) as never;
  const broken: MarketingRuntime[] = [
    { ...rt, brands: boom(Error), catalogue: boom(Error), sites: boom(Error) },
    { ...rt, campaigns: boom(TypeError) },
  ];
  for (const bad of broken) {
    for (const op of [DRAFT, approve(1)]) {
      const logged: unknown[][] = [];
      const r = await runMarketingOp(input(bad), A, op, (...args) => { logged.push(args); });
      assert.deepEqual(r, { ok: false, message: WENT_WRONG, errors: [] });
      assert.equal(logged.length, 1);
      assert.match(String(logged[0][1]), /^(Error|TypeError)$/);
      assert.ok(!JSON.stringify(logged).includes('secret-detail'));
    }
  }
  assert.match(WENT_WRONG, /do not know if that went through/);
  assert.doesNotMatch(WENT_WRONG, /could not reach/i);
  // The working runtime is untouched by all of that: nothing was saved.
  assert.equal((await model(rt)).state, 'none');
  // A refusal from the guard is still the guard's own message, not the catch-all.
  assert.deepEqual(await runMarketingOp(input(rt), 'nope', DRAFT), { ok: false, message: NO_BUSINESS, errors: [] });
});

test('AMP-129 honesty: no copy claims anything was posted, scheduled or published', async () => {
  const { rt } = await makeRt();
  await runMarketingOp(input(rt), A, DRAFT);
  const m = await model(rt);
  assert.ok(m.state === 'draft');
  const copy = [NOTHING_POSTED, NOT_IN_DEMO, m.statusText, drafted(1), approved(1), approveConfirm(1).title, approveConfirm(1).text, redraftConfirm(m).text, redraftConfirm({ state: 'approved', version: 2 }).text, ...m.channels.map((c) => c.role)];
  for (const s of copy) assert.doesNotMatch(s, /(?<!nothing )\b(was|were|is|are|has been|have been) (posted|scheduled|published|sent)\b|\bwe (posted|scheduled|published)\b|guarantee/i, s);
  assert.match(NOTHING_POSTED, /^Nothing is posted, scheduled or sent from here/);
  assert.match(approved(1), /Nothing was posted/);
  // AMP-130 and AMP-131: Creative Studio and Calendar both exist, so each is a link to its page.
  assert.deepEqual([...SOON], [{ name: 'Creative Studio', path: '/marketing/creative' }, { name: 'Calendar', path: '/marketing/calendar' }, { name: 'Ad angles', path: '/marketing/angles' }]);
  assert.equal(dayLabel('2026-11-05'), '5 Nov 2026');
  assert.equal(dayLabel('2026-11-05T07:04:00.000Z'), '5 Nov 2026');
  assert.equal(dayLabel('nonsense'), 'Unknown date');
  assert.deepEqual(buildMarketingModel(undefined), { state: 'none' });
});

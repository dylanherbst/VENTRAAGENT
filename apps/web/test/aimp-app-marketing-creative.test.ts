// Creative Studio review queue (screen 26, AMP-130; AMP-051 campaign assets; F02 F05 F06 F12 C06). The loader, the guard and
// `runCreativeOp` (the whole body of the page's server action) run here against the REAL campaign and campaign-assets services on their
// memory stores, with the real brand, catalogue and site-version services of the campaign demo fixtures. The campaign is drafted and
// approved through the Marketing page's own `runMarketingOp`. Nothing is a copy of the logic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALREADY_GENERATED, APPROVED, BAD_REQUEST, CHANGED, EDITED, IS_APPROVED, NEEDS_FIXES, NEEDS_REASON, NO_ASSET, NO_ASSETS, NO_BUSINESS, NO_CAMPAIGN, NO_STORE,
  NOT_DONE, NOT_WRITTEN, OLD_PLAN, REGENERATED, REJECTED, generated, guardCreativeOp, readOp, runCreativeOp,
} from '../app/app/[business]/marketing/creative/_server/creative-guard.ts';
import type { CreativeGuardInput } from '../app/app/[business]/marketing/creative/_server/creative-guard.ts';
import { creativeStoresOf, loadCreative } from '../app/app/[business]/marketing/creative/_server/creative.ts';
import type { CreativeRuntime } from '../app/app/[business]/marketing/creative/_server/creative.ts';
import { NOTHING_POSTED, NOT_IN_DEMO, STATE_LABELS, buildPatch, countsLine, regenerateConfirm } from '../app/app/[business]/marketing/creative/view-model.ts';
import type { AssetView } from '../app/app/[business]/marketing/creative/view-model.ts';
import { WENT_WRONG, runMarketingOp } from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import type { MarketingContexts } from '../app/app/[business]/marketing/_server/marketing.ts';
import { getApprovedBrand } from '../lib/aimp/branding/service.ts';
import { createMemoryAssetStore } from '../lib/aimp/campaign-assets/store.ts';
import { MAX_REGENERATIONS } from '../lib/aimp/campaign-assets/types.ts';
import type { AssetGenerator, AssetRecord } from '../lib/aimp/campaign-assets/types.ts';
import { buildCampaignDemo } from '../lib/aimp/campaigns/demo.ts';
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

type Plan = 'none' | 'draft' | 'approved';

/** The demo business with a published store, its campaign taken to `plan` through the Marketing page's own action logic. */
async function makeRt(opts: { plan?: Plan; campaigns?: boolean; assets?: boolean; generator?: AssetGenerator } = {}) {
  const demo = await buildCampaignDemo(now, {});
  const brand = await getApprovedBrand({ store: demo.d.brands }, { workspaceId: DEMO_WORKSPACE }, A);
  assert.ok(brand);
  const sites = createSiteVersionStore({ now });
  assert.equal((await sites.createSite(actor, { ...demoStore, slug: brand.slug })).ok, true);
  const d = await sites.getDraft(actor, brand.slug);
  assert.ok(d.ok);
  assert.equal((await sites.publish(actor, brand.slug, { note: '', expectedRevision: d.value.revision })).ok, true);
  const assets = createMemoryAssetStore();
  const rt: CreativeRuntime = {
    businesses: new Set([A]), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>(), slugs: new Map([[A, brand.slug]]),
    brands: demo.d.brands, catalogue: demo.d.catalogue, sites,
    ...(opts.campaigns === false ? {} : { campaigns: demo.campaigns }),
    ...(opts.assets === false ? {} : { campaignAssets: assets }),
    ...(opts.generator ? { assetGenerator: opts.generator } : {}),
  };
  const plan = opts.plan ?? 'approved';
  if (plan !== 'none' && opts.campaigns !== false) await replan(rt, plan);
  const campaignId = (await demo.campaigns.get(DEMO_WORKSPACE, A))?.id ?? '';
  return { rt, demo, assets, campaignId };
}
const mInput = (rt: CreativeRuntime) => ({ availability: ON, rt: () => rt, ctx, now });
/** A new draft of the campaign (the next version) and, for 'approved', the owner's yes to it. */
async function replan(rt: CreativeRuntime, to: Exclude<Plan, 'none'>) {
  const r = await runMarketingOp(mInput(rt), A, { kind: 'draft', confirmed: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (to !== 'approved') return;
  const version = (await rt.campaigns!.get(DEMO_WORKSPACE, A))!.version;
  assert.equal((await runMarketingOp(mInput(rt), A, { kind: 'approve', expectedVersion: version, confirmed: true })).ok, true);
}
const input = (rt: CreativeRuntime, c: MarketingContexts = ctx): CreativeGuardInput => ({ availability: ON, rt: () => rt, ctx: c, now });
const no = (message: string) => ({ ok: false, message, errors: [] });
const yes = (message: string) => ({ ok: true, message, errors: [] });
const model = async (rt: CreativeRuntime, c: MarketingContexts = ctx, businessId: unknown = A) => {
  const r = await loadCreative(rt, c, businessId, now);
  assert.ok(r.found && r.state === 'ready');
  return r.model;
};
const queue = async (rt: CreativeRuntime) => {
  const m = await model(rt);
  assert.ok(m.state === 'assets');
  return m;
};
/** A generated queue and helpers that read it back through the page's loader. */
async function ready(opts: Parameters<typeof makeRt>[0] = {}) {
  const x = await makeRt(opts);
  const g = await runCreativeOp(input(x.rt), A, { kind: 'generate', campaignId: x.campaignId });
  assert.equal(g.ok, true, JSON.stringify(g));
  const view = async (id: string): Promise<AssetView> => (await queue(x.rt)).assets.find((a) => a.id === id)!;
  const saved = async (): Promise<AssetRecord[]> => (await x.assets.get(DEMO_WORKSPACE, A, x.campaignId))!.assets;
  const first = (await queue(x.rt)).assets;
  const pin = first.find((a) => a.kind === 'pin')!;
  const caption = first.find((a) => a.kind === 'caption')!;
  const op = (kind: string, a: Pick<AssetView, 'id' | 'revision'>, more: Record<string, unknown> = {}) => ({ kind, campaignId: x.campaignId, assetId: a.id, revision: a.revision, ...more });
  return { ...x, view, saved, pin, caption, op };
}

test('AMP-130 states: no plan, a draft plan, an approved plan with no drafts, then the review queue', async () => {
  const none = await makeRt({ plan: 'none' });
  assert.deepEqual(await model(none.rt), { state: 'no_campaign', plan: 'none' });
  const draft = await makeRt({ plan: 'draft' });
  assert.deepEqual(await model(draft.rt), { state: 'no_campaign', plan: 'draft' });
  // A draft plan gets no assets, whatever the request says.
  assert.deepEqual(await runCreativeOp(input(draft.rt), A, { kind: 'generate', campaignId: draft.campaignId }), no(NO_CAMPAIGN));
  assert.equal(await draft.assets.get(DEMO_WORKSPACE, A, draft.campaignId), null);

  const { rt, demo, campaignId, assets } = await makeRt();
  assert.deepEqual(await model(rt), { state: 'no_assets', campaignId, campaignVersion: 1 });
  const plan = (await demo.campaigns.get(DEMO_WORKSPACE, A))!.plan;
  const g = await runCreativeOp(input(rt), A, { kind: 'generate', campaignId });
  const set = await assets.get(DEMO_WORKSPACE, A, campaignId);
  assert.ok(set && set.assets.length >= plan.items.length);
  assert.deepEqual(g, yes(generated(set.assets.length)));
  const m = await queue(rt);
  assert.equal(m.current, true);
  assert.equal(m.madeFromVersion, 1);
  assert.deepEqual(m.counts, { draft: set.assets.length, approved: 0, rejected: 0 });
  assert.equal(m.assets.length, set.assets.length);
  const titles = new Set(plan.items.map((i) => i.productTitle));
  for (const a of m.assets) {
    assert.equal(a.state, 'draft');
    assert.equal(a.revision, 1);
    assert.ok(titles.has(a.productTitle), a.productTitle);
    assert.ok(a.fields.length > 0 && a.fields.every((f) => f.label !== f.name), a.id);
    assert.ok(a.facts.some((f) => f.label === 'Link it points to'), a.id);
    assert.equal(a.regenerationsLeft, MAX_REGENERATIONS);
  }
  // Asking again never replaces review work.
  assert.deepEqual(await runCreativeOp(input(rt), A, { kind: 'generate', campaignId }), yes(ALREADY_GENERATED));
});

test('AMP-130 actions: approve, reject with a reason, edit and write-again all go through the service and are recorded', async () => {
  const { rt, pin, caption, op, view, saved } = await ready();
  assert.deepEqual(await runCreativeOp(input(rt), A, op('approve', pin)), yes(APPROVED));
  const approved = (await saved()).find((a) => a.id === pin.id)!;
  assert.equal(approved.state, 'approved');
  assert.equal(approved.decidedBy, 'demo-owner');
  assert.equal((await view(pin.id)).stateLabel, STATE_LABELS.approved);

  // Reject needs a reason; the reason is kept and shown.
  assert.deepEqual(await runCreativeOp(input(rt), A, op('reject', caption, { reason: '   ' })), no(NEEDS_REASON));
  assert.deepEqual(await runCreativeOp(input(rt), A, op('reject', caption, { reason: 'x'.repeat(501) })), no(NEEDS_REASON));
  assert.equal((await view(caption.id)).state, 'draft');
  assert.deepEqual(await runCreativeOp(input(rt), A, op('reject', caption, { reason: 'Too salesy for us' })), yes(REJECTED));
  const rejected = await view(caption.id);
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.rejectionReason, 'Too salesy for us');

  // Editing the approved Pin puts it back to draft at a new revision; the old text stays in its history.
  const title = pin.fields.find((f) => f.name === 'title')!;
  const p = buildPatch(pin.fields, { title: `${title.value} (new)` });
  assert.ok(p.ok);
  assert.deepEqual(Object.keys(p.patch), ['title']);
  assert.deepEqual(await runCreativeOp(input(rt), A, op('edit', pin, { patch: p.patch })), yes(EDITED));
  const edited = await view(pin.id);
  assert.equal(edited.state, 'draft');
  assert.equal(edited.revision, 2);
  assert.equal(edited.fields.find((f) => f.name === 'title')!.value, `${title.value} (new)`);
  assert.deepEqual((await saved()).find((a) => a.id === pin.id)!.history.map((h) => h.action), ['generated', 'approved', 'edited']);

  // Write it again: a new draft; an approved one is only replaced when that was said out loud.
  assert.deepEqual(await runCreativeOp(input(rt), A, op('regenerate', rejected)), yes(REGENERATED));
  const again = await view(caption.id);
  assert.deepEqual([again.state, again.revision, again.regenerationsLeft, again.rejectionReason], ['draft', 2, MAX_REGENERATIONS - 1, null]);
  assert.equal((await runCreativeOp(input(rt), A, op('approve', again))).ok, true);
  assert.deepEqual(await runCreativeOp(input(rt), A, op('regenerate', again)), no(IS_APPROVED));
  assert.equal((await view(caption.id)).state, 'approved');
  assert.deepEqual(await runCreativeOp(input(rt), A, op('regenerate', again, { replaceApproved: true })), yes(REGENERATED));
  assert.deepEqual([(await view(caption.id)).state, (await view(caption.id)).revision], ['draft', 3]);
  // The queue lists what still needs a decision first.
  const order = (await queue(rt)).assets.map((a) => a.state);
  assert.deepEqual(order, [...order].sort((x, y) => ['draft', 'rejected', 'approved'].indexOf(x) - ['draft', 'rejected', 'approved'].indexOf(y)));
});

test('AMP-130 stale revision: every action is refused with a plain "changed since you opened it" message and nothing is overwritten', async () => {
  const { rt, pin, op, saved } = await ready();
  assert.deepEqual(await runCreativeOp(input(rt), A, op('edit', pin, { patch: { title: 'Changed in another tab' } })), yes(EDITED));
  const before = JSON.stringify(await saved());
  for (const stale of [op('approve', pin), op('reject', pin, { reason: 'No' }), op('edit', pin, { patch: { title: 'Mine wins?' } }), op('regenerate', pin), op('regenerate', pin, { replaceApproved: true })]) {
    assert.deepEqual(await runCreativeOp(input(rt), A, stale), no(CHANGED), stale.kind);
  }
  assert.deepEqual(await runCreativeOp(input(rt), A, { ...op('approve', pin), revision: 99 }), no(CHANGED));
  assert.equal(JSON.stringify(await saved()), before);
  assert.match(CHANGED, /^This changed since you opened it.*nothing was saved.*Reload/);
  // With the revision the page now shows, it goes through.
  assert.deepEqual(await runCreativeOp(input(rt), A, { ...op('approve', pin), revision: 2 }), yes(APPROVED));
});

test('AMP-130 rules: a draft that breaks a limit is shown with its problem and can not be approved', async () => {
  const { rt, pin, op, view } = await ready();
  assert.equal(pin.canApprove, true);
  assert.deepEqual(await runCreativeOp(input(rt), A, op('edit', pin, { patch: { title: 'Long title '.repeat(20) } })), yes(EDITED));
  const long = await view(pin.id);
  assert.ok(long.problems.length > 0);
  assert.equal(long.canApprove, false);
  assert.deepEqual(await runCreativeOp(input(rt), A, op('approve', long)), no(NEEDS_FIXES));
  assert.equal((await view(pin.id)).state, 'draft');
  // A runaway paste is refused by the service and nothing is stored.
  const huge = await runCreativeOp(input(rt), A, op('edit', long, { patch: { description: 'x'.repeat(5001) } }));
  assert.ok(!huge.ok && huge.message === NOT_DONE && huge.errors.length === 1);
  // A field of another kind of asset can not be set on a Pin.
  const wrongKind = await runCreativeOp(input(rt), A, op('edit', long, { patch: { hook: 'Not a Pin field' } }));
  assert.ok(!wrongKind.ok && wrongKind.message === NOT_DONE && /cannot be edited/.test(wrongKind.errors[0] ?? ''));
  assert.equal((await view(pin.id)).revision, long.revision);
});

test('AMP-130 refusals: demo storage off, bad business ids, prototype keys, unknown business, bad shapes', async () => {
  const { rt, pin, op, saved, campaignId } = await ready();
  const before = JSON.stringify(await saved());
  let touched = false;
  const off = await runCreativeOp({ availability: { available: false, reason: 'Off here.' }, rt: () => { touched = true; return rt; }, ctx, now }, A, op('approve', pin));
  assert.deepEqual(off, no('Off here.'));
  assert.equal(touched, false);

  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', '../etc', '', 42, null, undefined, {}, ['demo-business'], 'biz-unknown']) {
    assert.deepEqual(await runCreativeOp(input(rt), bad, op('approve', pin)), no(NO_BUSINESS), String(bad));
    assert.deepEqual(await runCreativeOp(input(rt), bad, { kind: 'generate', campaignId }), no(NO_BUSINESS), String(bad));
    assert.deepEqual(await loadCreative(rt, ctx, bad, now), { found: false }, String(bad));
  }
  const good = op('approve', pin);
  const shapes: unknown[] = [
    null, 'approve', {}, [good], { ...good, kind: 'publish' }, { ...good, kind: 'post' }, { ...good, kind: 'export' }, { ...good, kind: '__proto__' },
    { ...good, campaignId: '__proto__' }, { ...good, campaignId: '' }, { ...good, campaignId: 7 }, { ...good, campaignId: '../x' }, { kind: 'generate' }, { kind: 'generate', campaignId: '__proto__' },
    { ...good, assetId: '__proto__' }, { ...good, assetId: 'constructor' }, { ...good, assetId: 'prototype' }, { ...good, assetId: '__proto__:pin' }, { ...good, assetId: 'd1-pinterest' },
    { ...good, assetId: 'd1-pinterest:constructor' }, { ...good, assetId: 3 }, { ...good, assetId: undefined },
    { ...good, revision: 0 }, { ...good, revision: '1' }, { ...good, revision: 1.5 }, { ...good, revision: undefined },
    op('reject', pin), op('reject', pin, { reason: 5 }), op('reject', pin, { reason: 'x'.repeat(2001) }),
    op('edit', pin), op('edit', pin, { patch: {} }), op('edit', pin, { patch: ['title'] }), op('edit', pin, { patch: { title: { toString: 1 } } }), op('edit', pin, { patch: { keywords: [1] } }),
    op('edit', pin, { patch: { state: 'approved' } }), op('edit', pin, { patch: { destinationUrl: 'https://evil.example' } }), op('edit', pin, { patch: { revision: 1 } }),
    op('edit', pin, { patch: { constructor: ['x'] } }), op('edit', pin, { patch: { toString: 'x' } }), op('edit', pin, { patch: JSON.parse('{"__proto__":["x"]}') }),
    op('edit', pin, { patch: JSON.parse('{"title":"ok","__proto__":{"title":"x"}}') }), JSON.parse(`{"__proto__":${JSON.stringify(good)}}`),
  ];
  for (const bad of shapes) assert.deepEqual(await runCreativeOp(input(rt), A, bad), no(BAD_REQUEST), JSON.stringify(bad));
  assert.equal(JSON.stringify(await saved()), before);
  // Only the shape the page offers survives; a workspace, a business or a state in the request body is dropped.
  assert.deepEqual(readOp({ ...good, workspaceId: 'other-workspace', businessId: 'biz-b', state: 'approved', actor: 'someone-else' }), good);
  assert.deepEqual(readOp(op('regenerate', pin, { replaceApproved: 'yes' })), { ...op('regenerate', pin), replaceApproved: false });
  assert.equal(guardCreativeOp(input(rt), A, good).ok, true);
});

test('AMP-130 another business or workspace: it never sees, changes or generates this business\'s drafts', async () => {
  const { rt, pin, op, saved, campaignId, assets } = await ready();
  rt.businesses = new Set([A, 'biz-b']);
  const before = JSON.stringify(await saved());
  const ops = [op('approve', pin), op('reject', pin, { reason: 'No' }), op('edit', pin, { patch: { title: 'Hijacked' } }), op('regenerate', pin), { kind: 'generate', campaignId }];

  assert.deepEqual(await model(rt, ctx, 'biz-b'), { state: 'no_campaign', plan: 'none' });
  // Naming business A in the request body while acting as B changes nothing either.
  for (const o of ops) assert.deepEqual(await runCreativeOp(input(rt), 'biz-b', { ...o, businessId: A, workspaceId: DEMO_WORKSPACE }), no(NO_CAMPAIGN), o.kind);
  assert.equal(await assets.get(DEMO_WORKSPACE, 'biz-b', campaignId), null);

  assert.deepEqual(await model(rt, otherWorkspace), { state: 'no_campaign', plan: 'none' });
  for (const o of ops) assert.deepEqual(await runCreativeOp(input(rt, otherWorkspace), A, o), no(NO_CAMPAIGN), o.kind);
  assert.equal(await assets.get('other-workspace', A, campaignId), null);
  assert.equal(JSON.stringify(await saved()), before);
});

test('AMP-130 another campaign: a campaign id that is not this business\'s approved plan, or an asset that is not in it, is refused', async () => {
  const { rt, pin, op, saved, campaignId, assets } = await ready();
  const before = JSON.stringify(await saved());
  for (const other of ['some-other-campaign', 'constructor', 'toString', `${campaignId}x`]) {
    for (const o of [op('approve', pin), op('reject', pin, { reason: 'No' }), op('edit', pin, { patch: { title: 'x' } }), op('regenerate', pin), { kind: 'generate' }]) {
      assert.deepEqual(await runCreativeOp(input(rt), A, { ...o, campaignId: other }), no(NO_CAMPAIGN), `${other} ${o.kind}`);
    }
    assert.equal(await assets.get(DEMO_WORKSPACE, A, other), null);
  }
  // An asset id of the right shape that this campaign does not have.
  for (const assetId of ['d999-pinterest:pin', 'someone-elses-item:caption', pin.id.replace(/:pin$/, ':video_script')]) {
    for (const kind of ['approve', 'regenerate']) assert.deepEqual(await runCreativeOp(input(rt), A, { ...op(kind, pin), assetId }), no(NO_ASSET), assetId);
    assert.deepEqual(await runCreativeOp(input(rt), A, { ...op('reject', pin, { reason: 'No' }), assetId }), no(NO_ASSET), assetId);
    assert.deepEqual(await runCreativeOp(input(rt), A, { ...op('edit', pin, { patch: { title: 'x' } }), assetId }), no(NO_ASSET), assetId);
  }
  assert.equal(JSON.stringify(await saved()), before);

  // An approved plan whose drafts were never written.
  const fresh = await makeRt();
  assert.deepEqual(await runCreativeOp(input(fresh.rt), A, { ...op('approve', pin), campaignId: fresh.campaignId }), no(NO_ASSETS));
});

test('AMP-130 a newer plan: drafts made from the old version can be read but not changed, until drafts are written for the new one', async () => {
  const { rt, pin, op, saved, campaignId, assets } = await ready();
  assert.equal((await runCreativeOp(input(rt), A, op('approve', pin))).ok, true);
  // While the new plan is only a draft, nothing is listed and nothing can be changed.
  await replan(rt, 'draft');
  assert.deepEqual(await model(rt), { state: 'no_campaign', plan: 'draft' });
  assert.deepEqual(await runCreativeOp(input(rt), A, op('reject', pin, { reason: 'No' })), no(NO_CAMPAIGN));
  await replan(rt, 'approved'); // a further draft, approved: the plan is now version 3
  const old = await queue(rt);
  assert.deepEqual([old.current, old.madeFromVersion, old.campaignVersion], [false, 1, 3]);
  const before = JSON.stringify(await saved());
  for (const o of [op('reject', pin, { reason: 'No' }), op('edit', pin, { patch: { title: 'x' } }), op('regenerate', pin, { replaceApproved: true })]) {
    assert.deepEqual(await runCreativeOp(input(rt), A, o), no(OLD_PLAN), o.kind);
  }
  assert.equal(JSON.stringify(await saved()), before);

  const g = await runCreativeOp(input(rt), A, { kind: 'generate', campaignId });
  assert.equal(g.ok, true);
  const next = await queue(rt);
  assert.deepEqual([next.current, next.madeFromVersion, next.counts.approved], [true, 3, 0]);
  // The old set, with its approval, is kept as a read-only record.
  const archived = await assets.archived(DEMO_WORKSPACE, A, campaignId);
  assert.equal(archived.length, 1);
  assert.equal(archived[0]!.assets.find((a) => a.id === pin.id)?.state, 'approved');
});

test('AMP-130 missing stores: the page says "not available" and every action is refused', async () => {
  for (const missing of [{ campaigns: false, assets: false }, { assets: false }, { campaigns: false }]) {
    const { rt } = await makeRt(missing);
    assert.equal(creativeStoresOf(rt), null);
    assert.deepEqual(await loadCreative(rt, ctx, A, now), { found: true, state: 'unavailable' });
    assert.deepEqual(await loadCreative(rt, ctx, 'biz-unknown', now), { found: false });
    for (const o of [{ kind: 'generate', campaignId: 'c1' }, { kind: 'approve', campaignId: 'c1', assetId: 'd1-pinterest:pin', revision: 1 }, 'nonsense']) {
      assert.deepEqual(await runCreativeOp(input(rt), A, o), no(NO_STORE));
    }
  }
  assert.match(NO_STORE, /not available in the demo yet/);
  // A store-shaped object that is missing a method is not a store.
  const { rt } = await makeRt();
  assert.equal(creativeStoresOf({ campaigns: rt.campaigns, campaignAssets: { kind: 'memory', get: rt.campaignAssets!.get } as never }), null);
});

test('AMP-137 a throwing campaign or asset store gives the same "we do not know if that went through" reply and logs only the error name', async () => {
  const { rt, campaignId, assets } = await ready();
  const secret = 'store down: secret-detail asset text';
  const boom = () => { throw new TypeError(secret); };
  const broken: CreativeRuntime[] = [
    { ...rt, campaigns: { ...rt.campaigns!, get: boom } as never },
    { ...rt, campaignAssets: { ...rt.campaignAssets!, get: boom, mutate: boom } as never },
  ];
  const ops = [{ kind: 'generate', campaignId }, { kind: 'approve', campaignId, assetId: 'd1-pinterest:pin', revision: 1 }];
  for (const bad of broken) {
    for (const o of ops) {
      const logged: unknown[][] = [];
      const r = await runCreativeOp(input(bad), A, o, (...args) => { logged.push(args); });
      assert.deepEqual(r, no(WENT_WRONG));
      assert.equal(logged.length, 1);
      assert.equal(logged[0]![1], 'TypeError');
      assert.ok(!JSON.stringify(logged).includes('secret-detail'));
    }
  }
  // A thrown non-Error is logged as "unknown error", never its value.
  const logged: unknown[][] = [];
  const odd = { ...rt.campaigns!, get: () => { throw 'secret-detail raw string'; } } as never;
  assert.deepEqual(await runCreativeOp(input({ ...rt, campaigns: odd }), A, ops[0], (...a) => { logged.push(a); }), no(WENT_WRONG));
  assert.equal(logged[0]![1], 'unknown error');
  assert.ok(!JSON.stringify(logged).includes('secret-detail'));
  assert.match(WENT_WRONG, /do not know if that went through/);
  // The working runtime is untouched: the saved drafts are still there.
  assert.ok(await assets.get(DEMO_WORKSPACE, A, campaignId));
});

test('AMP-130 generator: a failure saves nothing and its internal error text is not shown; the write-again limit is enforced', async () => {
  let fail = true;
  const real = (await import('../lib/aimp/campaign-assets/generate.ts')).createTemplateGenerator();
  const flaky: AssetGenerator = { id: 'flaky', generate: (i) => { if (fail) throw new Error('secret-key-123 upstream 500'); return real.generate(i); } };
  const x = await makeRt({ generator: flaky });
  assert.deepEqual(await runCreativeOp(input(x.rt), A, { kind: 'generate', campaignId: x.campaignId }), no(NOT_WRITTEN));
  assert.equal(await x.assets.get(DEMO_WORKSPACE, A, x.campaignId), null);
  fail = false;
  assert.equal((await runCreativeOp(input(x.rt), A, { kind: 'generate', campaignId: x.campaignId })).ok, true);
  const pin = (await queue(x.rt)).assets.find((a) => a.kind === 'pin')!;
  const target = { campaignId: x.campaignId, assetId: pin.id };
  fail = true;
  assert.deepEqual(await runCreativeOp(input(x.rt), A, { kind: 'regenerate', ...target, revision: 1 }), no(NOT_WRITTEN));
  assert.equal((await queue(x.rt)).assets.find((a) => a.id === pin.id)!.revision, 1);
  fail = false;
  for (let i = 1; i <= MAX_REGENERATIONS; i++) assert.deepEqual(await runCreativeOp(input(x.rt), A, { kind: 'regenerate', ...target, revision: i }), yes(REGENERATED));
  const spent = (await queue(x.rt)).assets.find((a) => a.id === pin.id)!;
  assert.equal(spent.regenerationsLeft, 0);
  const over = await runCreativeOp(input(x.rt), A, { kind: 'regenerate', ...target, revision: spent.revision });
  assert.ok(!over.ok && over.message === NOT_DONE && /Edit the text by hand/.test(over.errors[0] ?? ''));
});

test('AMP-130 edit form: only real changes are sent; lists are one per line; a bad number is reported, not guessed', async () => {
  const { rt } = await ready();
  const all = (await queue(rt)).assets;
  const pin = all.find((a) => a.kind === 'pin')!;
  const same = Object.fromEntries(pin.fields.map((f) => [f.name, f.value]));
  assert.deepEqual(buildPatch(pin.fields, same), { ok: true, patch: {} });
  assert.deepEqual(buildPatch(pin.fields, { ...same, keywords: ' one \n\n two\n', notAField: 'x', constructor: 'x' }), { ok: true, patch: { keywords: ['one', 'two'] } });
  const video = all.find((a) => a.kind === 'video_script');
  if (video) {
    const v = Object.fromEntries(video.fields.map((f) => [f.name, f.value]));
    assert.deepEqual(buildPatch(video.fields, { ...v, targetLengthSeconds: '25' }).ok && buildPatch(video.fields, { ...v, targetLengthSeconds: '25' }), { ok: true, patch: { targetLengthSeconds: 25 } });
    for (const bad of ['', 'abc', '12.5']) assert.deepEqual(buildPatch(video.fields, { ...v, targetLengthSeconds: bad }), { ok: false, field: 'targetLengthSeconds', message: 'Length in seconds needs a whole number.' });
  }
});

test('AMP-130 honesty: no copy claims anything was posted, scheduled or published', async () => {
  const { pin } = await ready();
  const copy = [
    NOTHING_POSTED, NOT_IN_DEMO, NO_STORE, BAD_REQUEST, CHANGED, OLD_PLAN, NO_CAMPAIGN, NO_ASSETS, NO_ASSET, NEEDS_REASON, NEEDS_FIXES, IS_APPROVED, NOT_WRITTEN, NOT_DONE,
    generated(1), generated(4), ALREADY_GENERATED, APPROVED, REJECTED, EDITED, REGENERATED, countsLine({ draft: 1, approved: 2, rejected: 0 }),
    regenerateConfirm(pin).text, regenerateConfirm({ state: 'approved', kindLabel: pin.kindLabel }).text, ...Object.values(STATE_LABELS),
  ];
  for (const s of copy) assert.doesNotMatch(s, /(?<!nothing )\b(was|were|is|are|has been|have been) (posted|scheduled|published|sent)\b|\bwe (posted|scheduled|published)\b|guarantee/i, s);
  for (const s of [generated(3), ALREADY_GENERATED, APPROVED, REJECTED, EDITED, REGENERATED]) assert.match(s, /Nothing was posted\.$/, s);
  assert.match(NOTHING_POSTED, /^Nothing is posted, scheduled or sent from here/);
  assert.equal(generated(1), '1 draft ready to read. Nothing was posted.');
});

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { automationExtras, isKnownBusiness, loadBusinessOverview, OVERVIEW_SOURCES, readBuildSteps, readStore } from '../app/app/[business]/_server/overview.ts';
import type { OverviewContexts, OverviewRuntime } from '../app/app/[business]/_server/overview.ts';
import {
  BUILT_APP_PAGES, buildOverviewViewModel, COMING_SOON, FIX_NEXT_ISSUE, isBuiltHref, NOT_MEASURED, NOTHING_NEEDS_YOU, OPEN_GUIDED_SETUP, START_STEP_ROUTES, TIME_NOT_RECORDED,
} from '../app/app/[business]/view-model.ts';
import { buildBusinessOverview, overviewStates } from '../lib/aimp/overview/index.ts';
import type { OverviewState } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoNotConnected, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const WS = 'demo-workspace';
interface Spec { brand?: boolean; productApproved?: boolean; listings?: number; site?: 'live' | 'paused' | 'draft'; name?: string }

/** A runtime-shaped fake: every read checks it was asked for the right workspace AND business. */
function fakeRuntime(spec: Record<string, Spec>) {
  const reads: string[] = [];
  const ids = Object.keys(spec);
  const rt: OverviewRuntime = {
    products: { listVersions: async (ctx, productId) => {
      reads.push(`products:${productId}`);
      assert.equal(ctx.workspaceId, WS);
      const biz = productId.replace(/^p-/, '');
      return [{ id: `v-${biz}`, status: spec[biz]?.productApproved ? 'approved' : 'draft' }] as never;
    } },
    brands: { kind: 'memory', list: async (ws: string, biz: string) => {
      reads.push(`brand:${biz}`);
      return ws === WS && spec[biz]?.brand ? ([{ status: 'approved', name: spec[biz].name ?? 'Calm Planner', businessId: biz }] as never) : [];
    } } as never,
    catalogue: { listApprovedForBusiness: async (ctx, biz) => {
      reads.push(`catalogue:${biz}`);
      assert.equal(ctx.workspaceId, WS);
      assert.equal(ctx.businessId, biz);
      return Array.from({ length: spec[biz]?.listings ?? 0 }, (_, n) => ({ id: `l${n}` })) as never;
    } },
    sites: { resolvePublished: async (slug) => {
      const biz = slug.replace(/^s-/, '');
      const st = spec[biz]?.site;
      return st === 'live' ? { status: 'live', version: 1, publishedAt: '2026-11-14T09:00:00.000Z', config: {} as never } : st === 'paused' ? { status: 'paused' } : { status: 'none' };
    } },
    seeds: { has: (b) => Boolean(spec[b]) },
    productIds: { get: (b) => (spec[b]?.productApproved !== undefined ? [`p-${b}`] : undefined) },
    slugs: { get: (b) => (spec[b]?.site ? `s-${b}` : undefined) },
    businesses: { has: (b) => ids.includes(b) },
  };
  return { rt, reads };
}

const ctx: OverviewContexts = {
  workspaceId: WS,
  productCtx: { workspaceId: WS, actorId: 'demo-owner' },
  brandCtx: { workspaceId: WS },
  siteActor: { workspaceId: WS, userId: 'demo-owner' },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: 'demo-owner', idempotencyKey: `start:${businessId}` }),
};
const NOW = new Date('2026-11-14T10:00:00.000Z');

test('a business built through /start shows its real setup steps, a live store and its next payments action', async () => {
  const { rt } = fakeRuntime({ 'biz-a': { brand: true, productApproved: true, listings: 2, site: 'live', name: 'Calm Planner' } });
  const r = await loadBusinessOverview(rt, ctx, {}, 'biz-a', () => NOW);
  assert.ok(r.found);
  if (!r.found) return;
  assert.equal(r.businessName, 'Calm Planner');
  assert.equal(r.storeStatus, 'live');
  const o = r.overview;
  assert.deepEqual(o.launchProgress.steps.filter((s) => s.done).map((s) => s.id), ['idea', 'brand', 'product', 'catalogue', 'store']);
  assert.equal(o.launchProgress.nextStep?.id, 'payments');
  // Published but nobody can pay: the checkout state, with the payments action first.
  assert.equal(o.state, 'degraded_checkout');
  assert.equal(o.needsYou[0].category, 'checkout');
  assert.equal(o.needsYou[0].href, '/app/biz-a/payments');
  assert.equal(o.summary.storeUrl, null);
  assert.equal(o.summary.visits.known, false);
});

test('a business with only a saved brand is a new setup and points at the next build step', async () => {
  const { rt } = fakeRuntime({ 'biz-a': { brand: true } });
  const r = await loadBusinessOverview(rt, ctx, {}, 'biz-a', () => NOW);
  assert.ok(r.found);
  if (!r.found) return;
  assert.equal(r.overview.state, 'new_setup');
  assert.equal(r.overview.launchProgress.done, 2);
  assert.equal(r.overview.launchProgress.nextStep?.id, 'product');
  assert.ok(r.overview.needsYou.some((i) => i.id === 'setup:product' && i.href === '/app/biz-a/products'));
});

test('a paused store is not reported as published and says so', async () => {
  const { rt } = fakeRuntime({ 'biz-a': { site: 'paused' } });
  const s = await readStore(rt, { workspaceId: WS, businessId: 'biz-a' });
  assert.deepEqual(s, { store: { published: false, url: null, publishedAt: null, lastPublishFailed: false }, status: 'paused' });
  const r = await loadBusinessOverview(rt, ctx, {}, 'biz-a', () => NOW);
  assert.ok(r.found);
  if (!r.found) return;
  assert.equal(r.storeStatus, 'paused');
  assert.match(buildOverviewViewModel({ overview: r.overview, storeStatus: r.storeStatus }).storeLine.text, /Paused/);
});

test('a second business sees nothing of the first, even when the order source lists the whole workspace', async () => {
  const { rt } = fakeRuntime({ 'biz-a': { brand: true, productApproved: true, listings: 1, site: 'live' }, 'biz-b': {} });
  const order = (id: string, businessId: string) => ({
    id, workspaceId: WS, businessId, title: 'Planner', status: 'paid', amountMinor: 1200, currency: 'AUD', createdAt: '2026-11-14T09:00:00.000Z', paidAt: '2026-11-14T09:01:00.000Z',
  }) as never;
  const extras = {
    orders: async (workspaceId: string) => (workspaceId === WS ? [order('o1', 'biz-a'), order('o2', 'biz-b'), order('o3', 'biz-a')] : []),
    approvals: async (s: { workspaceId: string; businessId: string }) => { assert.equal(s.workspaceId, WS); return []; },
  };
  const a = await loadBusinessOverview(rt, ctx, extras, 'biz-a', () => NOW);
  const b = await loadBusinessOverview(rt, ctx, extras, 'biz-b', () => NOW);
  assert.ok(a.found && b.found);
  if (!a.found || !b.found) return;
  assert.equal(a.overview.summary.orders, 2);
  assert.equal(b.overview.summary.orders, 1); // its own order (o2) only, not the two from biz-a
  // Only "idea" (it exists) and "first order" (its own paid order) are done; nothing of biz-a's brand, product or store shows here.
  assert.deepEqual(b.overview.launchProgress.steps.filter((s) => s.done).map((s) => s.id), ['idea', 'first_order']);
  assert.equal(b.overview.state, 'new_setup');
  assert.equal(b.businessName, null);
  const steps = await readBuildSteps(rt, ctx, { workspaceId: WS, businessId: 'biz-b' });
  assert.deepEqual(steps, { ideaChosen: true, brandSaved: false, productApproved: false, catalogueApproved: false });
});

test('an unknown business is not found, and nothing is read for it', async () => {
  const { rt, reads } = fakeRuntime({ 'biz-a': { brand: true } });
  assert.equal(isKnownBusiness(rt, 'nope'), false);
  assert.deepEqual(await loadBusinessOverview(rt, ctx, {}, 'nope', () => NOW), { found: false });
  assert.deepEqual(reads, []);
});

test('sources that do not exist are recorded as absent, so visits stay unknown', () => {
  assert.equal(OVERVIEW_SOURCES.analytics, 'absent');
  assert.equal(OVERVIEW_SOURCES.fulfilment, 'absent');
});

// --- view model, one check per state, built from the AMP-080 fixtures ---

const fixtureVm = (state: OverviewState, label: string | null = null) =>
  buildOverviewViewModel({ overview: buildBusinessOverview({ ...demoSnapshot(state), businessId: 'biz-x' }, DEMO_OVERVIEW_NOW), businessName: 'Example', fixtureLabel: label });

test('the allow-list of built pages holds only the overview, the brand kit, products and orders, and each one is a real page', () => {
  // AMP-083: the Products page now exists, so '/products' is built and its /start link row is gone.
  // AMP-086: the Orders queue exists, so '/orders' is built (the order detail page is under it and is not its own allow-list entry).
  assert.deepEqual([...BUILT_APP_PAGES], ['', '/brand', '/products', '/orders']);
  assert.equal(isBuiltHref('/app/biz-x/products', 'biz-x'), true);
  assert.equal(isBuiltHref('/app/biz-x/products?status=draft', 'biz-x'), true);
  assert.equal(START_STEP_ROUTES.product, undefined);
  for (const p of BUILT_APP_PAGES) assert.ok(existsSync(new URL(`../app/app/[business]${p}/page.tsx`, import.meta.url)), p || 'overview');
  assert.equal(isBuiltHref('/app/biz-x', 'biz-x'), true);
  assert.equal(isBuiltHref('/app/biz-x/brand', 'biz-x'), true);
  assert.equal(isBuiltHref('/app/other/brand', 'biz-x'), false);
  assert.equal(isBuiltHref('/app/biz-x/brand/extra', 'biz-x'), false);
  assert.equal(START_STEP_ROUTES.brand, undefined);
  assert.equal(isBuiltHref('/app/biz-x/orders', 'biz-x'), true);
  assert.equal(isBuiltHref('/app/biz-x/orders/ord_1', 'biz-x'), false);
  assert.equal(isBuiltHref('/app/biz-x/website', 'biz-x'), false);
  assert.equal(isBuiltHref('/app/other', 'biz-x'), false);
  assert.equal(isBuiltHref('/app/biz-xy', 'biz-x'), false);
});

test('every state shows visits as not measured, never zero', () => {
  for (const s of overviewStates) {
    const t = fixtureVm(s).tiles.find((x) => x.id === 'visits');
    assert.equal(t?.value, NOT_MEASURED, s);
    assert.equal(t?.unknown, true, s);
    assert.doesNotMatch(t?.value ?? '', /^0/, s);
  }
  assert.deepEqual(fixtureVm('live').tiles.map((t) => t.id), ['visits', 'orders', 'gross', 'refunds', 'delivery']);
});

test('new setup: no banners, the primary card is the true top item, and the next doable step is a separate secondary link', () => {
  const vm = fixtureVm('new_setup');
  assert.equal(vm.state, 'new_setup');
  assert.deepEqual(vm.banners, []);
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') {
    assert.equal(vm.primary.label, FIX_NEXT_ISSUE);
    // Payments rank first but have no page: the primary card still names that item (never a substitute) and its control is unavailable.
    assert.equal(vm.needsYou[0].built, false);
    assert.equal(vm.primary.destination, vm.needsYou[0].destination);
    assert.equal(vm.primary.title, vm.needsYou[0].title);
    assert.equal(vm.primary.href, null);
    assert.equal(vm.primary.control, 'disabled');
    // A new setup still has a real way forward: the first later item that has a page, offered as a labelled secondary link.
    const next = vm.needsYou.slice(1).find((i) => i.href !== null);
    assert.ok(next);
    assert.ok(vm.primary.secondary);
    assert.equal(vm.primary.secondary?.href, next?.href);
    assert.equal(vm.primary.secondary?.title, next?.title);
    assert.notEqual(vm.primary.secondary?.title, vm.primary.title);
    assert.match(vm.primary.secondary?.href ?? '', /^(\/app\/biz-x\/(brand|products)|\/start\/(ideas|catalogue|store))$/);
  }
  assert.equal(vm.storeLine.text, 'Not published yet');
  assert.equal(vm.progress.nextLabel !== null, true);
});

test('live: the primary action is the top needs-you item and the numbers are real', () => {
  const vm = fixtureVm('live');
  assert.equal(vm.banners.length, 0);
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') assert.equal(vm.primary.destination, vm.needsYou[0].destination);
  assert.equal(vm.tiles.find((t) => t.id === 'orders')?.value, '4');
  assert.equal(vm.tiles.find((t) => t.id === 'gross')?.value, 'A$55');
  assert.match(vm.tiles.find((t) => t.id === 'delivery')?.value ?? '', /3 delivered/);
  assert.ok(vm.needsYou.every((i) => i.rank > 0 && i.action && i.impact && i.destination));
});

test('zero orders: orders are zero, honestly labelled, and nothing needs the owner', () => {
  const vm = fixtureVm('zero_orders');
  assert.equal(vm.tiles.find((t) => t.id === 'orders')?.value, '0');
  assert.equal(vm.tiles.find((t) => t.id === 'orders')?.note, 'No paid orders yet.');
  assert.equal(vm.tiles.find((t) => t.id === 'delivery')?.value, 'Nothing to deliver yet');
  assert.equal(vm.primary.kind, 'calm');
  if (vm.primary.kind === 'calm') assert.equal(vm.primary.label, NOTHING_NEEDS_YOU);
  assert.equal(vm.needsYou.length, 0);
});

test('stale data: a banner says the numbers may be out of date and every tile repeats it', () => {
  const vm = fixtureVm('data_stale');
  assert.deepEqual(vm.banners.map((b) => b.id), ['stale']);
  // The top action is still offered (the numbers are stale, the next step is not hidden).
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') {
    assert.equal(vm.primary.label, FIX_NEXT_ISSUE);
    assert.equal(vm.primary.destination, vm.needsYou[0].destination);
  }
  assert.match(vm.banners[0].text, /Last updated 2026-11-14 08:00 UTC/);
  for (const t of vm.tiles.filter((x) => !x.unknown)) assert.match(t.note, /May be out of date/, t.id);
});

test('degraded checkout: a banner with the payments action, and that action is the primary one', () => {
  const vm = fixtureVm('degraded_checkout');
  assert.deepEqual(vm.banners.map((b) => b.id), ['degraded_checkout']);
  assert.equal(vm.banners[0].tone, 'error');
  assert.equal(vm.banners[0].link?.destination, '/app/biz-x/payments');
  assert.equal(vm.banners[0].link?.href, null);
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') assert.equal(vm.primary.destination, '/app/biz-x/payments');
  assert.equal(vm.needsYou[0].categoryLabel, 'Payments');
  assert.ok(vm.needsYou.some((i) => i.categoryLabel === 'Delivery'));
});

test('stale and degraded together keep both banners', () => {
  const snap = { ...demoSnapshot('degraded_checkout'), businessId: 'biz-x', collectedAt: '2026-11-14T07:00:00.000Z' };
  const vm = buildOverviewViewModel({ overview: buildBusinessOverview(snap, DEMO_OVERVIEW_NOW) });
  assert.equal(vm.state, 'data_stale');
  assert.deepEqual(vm.banners.map((b) => b.id), ['stale', 'degraded_checkout']);
});

test('a fixture is labelled as example data, and real data is labelled DEMO memory', () => {
  assert.match(fixtureVm('live', 'live').demoText, /Example data/);
  assert.match(fixtureVm('live').demoText, /^DEMO: .*in memory.*lost when it restarts/);
});

test('payments never connected is a calm warning with "Connect payments", not an outage', () => {
  const snap = { ...demoSnapshot('live'), businessId: 'biz-x', seller: demoNotConnected(), approvals: [] };
  const vm = buildOverviewViewModel({ overview: buildBusinessOverview(snap, new Date(snap.collectedAt)) });
  assert.equal(vm.state, 'degraded_checkout');
  assert.deepEqual(vm.banners.map((b) => b.id), ['payments_not_ready']);
  const b = vm.banners[0];
  assert.equal(b.tone, 'warn');
  assert.equal(b.title, 'Payments are not connected yet');
  assert.equal(b.link?.label, 'Connect payments');
  const words = JSON.stringify(vm);
  for (const bad of ['cannot pay right now', 'not working', 'Fix this first', 'stopped working']) assert.ok(!words.includes(bad), bad);
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') assert.equal(vm.primary.action, 'Connect payments');
  assert.equal(vm.needsYou[0].action, 'Connect payments');
  assert.doesNotMatch(vm.lede, /stopped|Fix this first/);
});

test('a seller that was ready and is now restricted keeps the red outage treatment', () => {
  const vm = fixtureVm('degraded_checkout');
  assert.deepEqual(vm.banners.map((b) => b.id), ['degraded_checkout']);
  assert.equal(vm.banners[0].tone, 'error');
  assert.match(vm.banners[0].title, /cannot pay/);
  assert.match(vm.lede, /Fix this first/);
});

test('nothing in the view model links to a page that is not built, and the exact action words stay visible', () => {
  for (const s of overviewStates) {
    const vm = fixtureVm(s);
    const all = [
      ...(vm.primary.kind === 'fix' ? [vm.primary] : []), ...vm.needsYou, ...vm.progress.steps, ...vm.brief, ...vm.banners.flatMap((b) => (b.link ? [b.link] : [])),
    ];
    for (const l of all) {
      assert.equal(l.href === null, !l.built, s);
      if (l.href !== null) assert.ok(l.href === '/app/biz-x' || l.href === '/app/biz-x/brand' || l.href === '/app/biz-x/products' || l.href === '/app/biz-x/orders' || Object.values(START_STEP_ROUTES).includes(l.href), `${s}: ${l.href}`);
      assert.equal(l.guided, l.href !== null && l.href.startsWith('/start'), `${s}: ${l.href}`);
    }
    if (vm.primary.kind === 'fix') {
      assert.ok(vm.primary.action.length > 0 && vm.primary.title.length > 0, s);
      assert.equal(vm.primary.label, vm.primary.guided ? OPEN_GUIDED_SETUP : FIX_NEXT_ISSUE, s);
      assert.equal(vm.primary.destination, vm.needsYou[0].destination, s);
    }
  }
});

test('only an https store address becomes a link', () => {
  const withUrl = (url: string) => {
    const snap = { ...demoSnapshot('live'), businessId: 'biz-x', store: { ...demoSnapshot('live').store, url } };
    return buildOverviewViewModel({ overview: buildBusinessOverview(snap, DEMO_OVERVIEW_NOW) }).storeLine;
  };
  assert.equal(withUrl('https://calm-planner.example-stores.test').url, 'https://calm-planner.example-stores.test');
  assert.equal(withUrl('http://calm-planner.test').url, null);
  assert.equal(withUrl('javascript:alert(1)').url, null);
  assert.equal(withUrl('not a url').url, null);
  assert.equal(withUrl('javascript:alert(1)').text, 'javascript:alert(1)'); // shown as text only
});

test('business B never receives business A\'s approvals or activity', async () => {
  const seen: { workspaceId: string; businessId: string }[] = [];
  const a = { approvals: [{ id: 'apr_a' }], entries: [{ id: 'act_a' }] };
  const automation = {
    approvals: async (c: { workspaceId: string; businessId: string }) => { seen.push(c); return (c.businessId === 'biz-a' ? a.approvals : []) as never; },
    activity: async (c: { workspaceId: string; businessId: string }, o?: { limit?: number }) => {
      seen.push(c);
      assert.equal(o?.limit, 10);
      return { entries: (c.businessId === 'biz-a' ? a.entries : []) as never };
    },
  };
  const ex = automationExtras(() => automation as never, (s) => ({ workspaceId: s.workspaceId, businessId: s.businessId, actorUserId: 'u', idempotencyKey: 'overview' }));
  assert.equal((await ex.approvals!({ workspaceId: WS, businessId: 'biz-a' })).length, 1);
  assert.equal((await ex.activity!({ workspaceId: WS, businessId: 'biz-a' })).length, 1);
  assert.deepEqual(await ex.approvals!({ workspaceId: WS, businessId: 'biz-b' }), []);
  assert.deepEqual(await ex.activity!({ workspaceId: WS, businessId: 'biz-b' }), []);
  assert.deepEqual(seen.map((s) => s.businessId), ['biz-a', 'biz-a', 'biz-b', 'biz-b']);
  assert.ok(seen.every((s) => s.workspaceId === WS));
});

test('setup steps link to the existing /start routes; destinations with no page stay not clickable', () => {
  const vm = fixtureVm('new_setup');
  const byId = Object.fromEntries(vm.progress.steps.map((s) => [s.id, s]));
  // The catalogue step keeps its guided route even though its destination is /products: that page cannot write or approve a listing.
  for (const id of ['idea', 'catalogue', 'store']) {
    assert.equal(byId[id].href, START_STEP_ROUTES[id], id);
    assert.equal(byId[id].built, true, id);
    assert.equal(byId[id].guided, true, id);
  }
  assert.equal(byId.catalogue.href, '/start/catalogue');
  // AMP-083: the product step has no /start row, so it goes to its own built page for THIS business.
  assert.equal(byId.product.href, '/app/biz-x/products');
  assert.equal(byId.product.built, true);
  assert.equal(byId.product.guided, false);
  // The brand kit has its own page for THIS business, so it no longer goes through /start.
  assert.equal(byId.brand.href, '/app/biz-x/brand');
  assert.equal(byId.brand.built, true);
  assert.equal(byId.brand.guided, false);
  assert.equal(byId.store.href, '/start/store');
  // No /start step exists for payments or the first order: Coming soon, not clickable.
  for (const id of ['payments', 'first_order']) {
    assert.equal(byId[id].href, null, id);
    assert.equal(byId[id].built, false, id);
  }
  // Every mapped route is a real page in the guided journey.
  for (const r of Object.values(START_STEP_ROUTES)) assert.ok(existsSync(new URL(`../app${r}/page.tsx`, import.meta.url)), r);
});

test('a payments or approval destination is never sent to a /start page', () => {
  const vm = fixtureVm('degraded_checkout');
  assert.equal(vm.primary.kind === 'fix' ? vm.primary.href : 'x', null);
  assert.equal(vm.banners[0].link?.href, null);
  for (const i of vm.needsYou.filter((x) => x.categoryLabel !== 'Setup')) assert.equal(i.href, null, i.id);
});

test('no-destination primary action: view model keeps the words and explains why it is not clickable', () => {
  const vm = fixtureVm('degraded_checkout');
  assert.equal(vm.primary.kind, 'fix');
  if (vm.primary.kind === 'fix') {
    assert.equal(vm.primary.href, null);
    assert.equal(vm.primary.built, false);
    assert.ok(vm.primary.action.length > 0 && vm.primary.label === FIX_NEXT_ISSUE);
  }
});

test('an activity with an invalid time shows "Time not recorded" and the page still builds', () => {
  const snap = demoSnapshot('live');
  const base = buildBusinessOverview({ ...snap, businessId: 'biz-x' }, DEMO_OVERVIEW_NOW);
  assert.ok(base.recentActivity.length > 0);
  const bad = { ...base, recentActivity: base.recentActivity.map((a, n) => ({ ...a, at: n === 0 ? Number.NaN : n === 1 ? 8.64e15 + 1 : a.at })) };
  const vm = buildOverviewViewModel({ overview: bad });
  assert.equal(vm.activity[0].when, TIME_NOT_RECORDED);
  if (vm.activity.length > 1) assert.equal(vm.activity[1].when, TIME_NOT_RECORDED);
  assert.equal(vm.activity.length, base.recentActivity.length);
  assert.match(vm.activity[vm.activity.length - 1].when, vm.activity.length > 2 ? /UTC/ : /./);
});

test('links to pages that do not exist yet are marked, links to the overview are not', () => {
  const vm = fixtureVm('degraded_checkout');
  assert.ok(vm.needsYou.every((i) => i.built === false || i.categoryLabel === 'Setup'));
  assert.equal(COMING_SOON, 'Coming soon');
  const brief = vm.brief.find((l) => l.href === '/app/biz-x');
  assert.ok(brief === undefined || brief.built === true);
});

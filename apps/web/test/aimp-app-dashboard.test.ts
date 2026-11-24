// Merchant dashboard (AMP-062, `/app/[business]/dashboard`). The server read runs on the overview read model through the page's own
// loader; the view model is pure. AUD orders go through the REAL in-memory order store (create, pay, refund). The order type only
// allows AUD today, so the JPY and USD orders are rows of the same shape handed to the same orders source; fulfilment records and
// money events are rows in the shape the fulfilment store lists. What this does not prove: the Next page itself and the browser layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MISSING_WIRING, countPostApprovals, dashboardSources, loadDashboard } from '../app/app/[business]/dashboard/_server/dashboard.ts';
import {
  APPROVALS_NOT_READ, ATTENTION_APPROVALS_NOT_READ, COMING_SOON, ESTIMATE, NOTHING_NEEDS_YOU, NOT_IN_DEMO, NOT_MEASURED, NOT_SUMMED_NOTE, NO_COST_DATA, attentionLink, buildDashboard, dashboardHref, headingOutline,
} from '../app/app/[business]/dashboard/view-model.ts';
import type { DashboardVM, SectionId, StatVM } from '../app/app/[business]/dashboard/view-model.ts';
import { loadBusinessOverview, loadCachedBusinessOverview, sharedOverviewCache } from '../app/app/[business]/_server/overview.ts';
import type { OverviewContexts, OverviewExtras, OverviewRuntime } from '../app/app/[business]/_server/overview.ts';
import { buildOverviewViewModel } from '../app/app/[business]/view-model.ts';
import type { ApprovalView } from '../lib/aimp/automation/types.ts';
import { createMemoryOrderStore } from '../lib/aimp/orders/store.ts';
import type { Order } from '../lib/aimp/orders/types.ts';

const WS = 'demo-workspace';
const NOW = () => new Date('2026-11-14T10:00:00.000Z');
const PAID_AT = '2026-11-14T09:55:00.000Z';
const ctx: OverviewContexts = {
  workspaceId: WS,
  productCtx: { workspaceId: WS, actorId: 'demo-owner' },
  brandCtx: { workspaceId: WS },
  siteActor: { workspaceId: WS, userId: 'demo-owner' },
  catalogueCtx: (businessId) => ({ workspaceId: WS, businessId, actorUserId: 'demo-owner', idempotencyKey: `start:${businessId}` }),
};

/** A runtime-shaped fake (the same shape the overview source tests use): every `live` business has a brand, a product and a live site. */
function fakeRuntime(live: string[]): OverviewRuntime {
  return {
    products: { listVersions: async (_c, productId) => [{ id: `v-${productId}`, status: 'approved' }] as never },
    brands: { kind: 'memory', list: async (ws: string, biz: string) => (ws === WS && live.includes(biz) ? ([{ status: 'approved', name: `Name ${biz}`, businessId: biz }] as never) : []) } as never,
    catalogue: { listApprovedForBusiness: async (_c, biz) => (live.includes(biz) ? [{ id: 'l1' }] : []) as never },
    sites: { resolvePublished: async () => ({ status: 'live', version: 1, publishedAt: '2026-11-14T09:00:00.000Z', config: {} as never }) },
    seeds: { has: (b) => live.includes(b) },
    productIds: { get: (b) => (live.includes(b) ? [`p-${b}`] : undefined) },
    slugs: { get: (b) => (live.includes(b) ? `s-${b}` : undefined) },
    businesses: { has: (b) => live.includes(b) },
  };
}

interface Row { id: string; businessId: string; workspaceId?: string; amountMinor: number; currency: string; status: 'pending' | 'paid' | 'refunded' }
const ROWS: Row[] = [
  { id: 'a1', businessId: 'biz-a', amountMinor: 1900, currency: 'AUD', status: 'paid' },
  { id: 'a2', businessId: 'biz-a', amountMinor: 2500, currency: 'AUD', status: 'refunded' },
  { id: 'a3', businessId: 'biz-a', amountMinor: 1200, currency: 'AUD', status: 'paid' },
  { id: 'a4', businessId: 'biz-a', amountMinor: 800, currency: 'AUD', status: 'paid' },
  { id: 'a5', businessId: 'biz-a', amountMinor: 5000, currency: 'AUD', status: 'pending' },
  { id: 'b1', businessId: 'biz-b', amountMinor: 9999, currency: 'AUD', status: 'paid' },
  // The order type is AUD only today, so these two currencies are rows of the same shape (JPY has no minor unit: 500 is 500 yen).
  { id: 'j1', businessId: 'biz-a', amountMinor: 500, currency: 'JPY', status: 'paid' },
  { id: 'j2', businessId: 'biz-a', amountMinor: 1200, currency: 'JPY', status: 'refunded' },
  { id: 'u1', businessId: 'biz-a', amountMinor: 1050, currency: 'USD', status: 'paid' },
  { id: 'x1', businessId: 'biz-a', workspaceId: 'other-workspace', amountMinor: 7777, currency: 'AUD', status: 'paid' },
];
const PARTIAL_REFUND = { orderId: 'a1', amountMinor: 400 };

const newOrder = (r: Row) => ({
  id: r.id, workspaceId: r.workspaceId ?? WS, businessId: r.businessId, storeSlug: `s-${r.businessId}`, listingId: `l-${r.id}`, listingVersion: 1,
  productId: `p-${r.businessId}`, productVersion: 1, title: `Planner ${r.id}`, amountMinor: r.amountMinor, currency: 'AUD' as const,
  sellerAccountId: 'acct_test', buyerEmail: 'buyer@example.test', idempotencyKey: `k-${r.id}`, createdAt: '2026-11-14T09:50:00.000Z',
});

/** The orders source: AUD rows of this workspace through the real memory store (pending -> paid -> refunded), the rest as plain rows. */
async function ordersWorld() {
  const store = createMemoryOrderStore();
  const plain: Order[] = [];
  for (const r of ROWS) {
    if (r.currency === 'AUD' && !r.workspaceId) {
      await store.createPending(newOrder(r));
      if (r.status === 'pending') continue;
      await store.attachSession(r.id, { id: `cs_${r.id}`, url: 'https://checkout.example.test/x' });
      const paid = await store.applyPaid({ eventId: `evt_${r.id}`, sessionId: `cs_${r.id}`, amountMinor: r.amountMinor, currency: 'AUD', at: PAID_AT });
      assert.equal(paid.outcome, 'paid', r.id);
      if (r.status === 'refunded') assert.equal((await store.markRefunded(WS, r.id))?.changed, true, r.id);
    } else {
      plain.push({ ...newOrder(r), currency: r.currency, status: r.status, checkoutSessionId: null, checkoutUrl: null, paidEventId: null, failureReason: null, paidAt: PAID_AT } as unknown as Order);
    }
  }
  let reads = 0;
  const orders: NonNullable<OverviewExtras['orders']> = async (workspaceId) => { reads += 1; return [...(await store.list(workspaceId)), ...plain]; };
  return { orders, reads: () => reads };
}

const delivery = (orderId: string, status: string, businessId = 'biz-a', workspaceId = WS) => ({
  orderId, status, attempts: 1, maxAttempts: 3, delivery: { lastError: status === 'failed' ? 'email_failed' : null }, updatedAt: PAID_AT, workspaceId, businessId,
});
const fulfilment: NonNullable<OverviewRuntime['fulfilment']> = {
  list: async () => [
    delivery('a1', 'delivered'), delivery('a2', 'revoked'), delivery('a3', 'failed'), delivery('j1', 'delivered'), delivery('u1', 'queued'),
    delivery('b1', 'delivered', 'biz-b'), delivery('x1', 'failed', 'biz-a', 'other-workspace'),
  ] as never,
  listMoneyEvents: async () => [
    { eventId: 'e-partial', kind: 'partial_refund', orderId: PARTIAL_REFUND.orderId, amountMinor: PARTIAL_REFUND.amountMinor, needsOwner: true, at: PAID_AT, workspaceId: WS, businessId: 'biz-a' },
    { eventId: 'e-other', kind: 'partial_refund', orderId: 'b1', amountMinor: 900, needsOwner: true, at: PAID_AT, workspaceId: WS, businessId: 'biz-b' },
  ] as never,
};

/** The expected totals, worked out from the test rows alone (not from the code under test). */
function expected(businessId: string) {
  const mine = ROWS.filter((r) => r.businessId === businessId && !r.workspaceId && r.status !== 'pending');
  const sum = (rows: Row[]) => {
    const by = new Map<string, number>();
    for (const c of [...new Set(mine.map((r) => r.currency))].sort()) by.set(c, 0);
    for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amountMinor);
    return [...by.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor }));
  };
  const sales = sum(mine);
  const refunds = sum(mine.filter((r) => r.status === 'refunded'));
  return { paidOrders: mine.length, sales, refunds };
}

const sectionOf = (vm: DashboardVM, id: SectionId) => { const s = vm.sections.find((x) => x.id === id); assert.ok(s, id); return s; };
const statOf = (vm: DashboardVM, section: SectionId, id: string): StatVM => { const s = sectionOf(vm, section).stats.find((x) => x.id === id); assert.ok(s, `${section}/${id}`); return s; };

async function fullDashboard() {
  const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
  const world = await ordersWorld();
  const found = await loadDashboard(rt, ctx, { orders: world.orders }, 'biz-a', { now: NOW });
  assert.ok(found.found);
  if (!found.found) throw new Error('unreachable');
  return { rt, world, found, vm: buildDashboard(found) };
}

// ---- acceptance 1: the figures reconcile with the test orders ----
test('sales, refunds and deliveries equal the test orders, per currency, for this business only', async () => {
  const { vm } = await fullDashboard();
  const want = expected('biz-a');
  assert.equal(want.paidOrders, 7);
  assert.equal(vm.totals.paidOrders, want.paidOrders);
  assert.deepEqual(vm.totals.sales, want.sales);
  assert.deepEqual(vm.totals.sales, [{ currency: 'AUD', amountMinor: 6400 }, { currency: 'JPY', amountMinor: 1700 }, { currency: 'USD', amountMinor: 1050 }]);
  // Refunds: the fully refunded orders, plus the one partial refund against a paid order of the same currency.
  const refunds = want.refunds.map((m) => (m.currency === 'AUD' ? { ...m, amountMinor: m.amountMinor + PARTIAL_REFUND.amountMinor } : m));
  assert.deepEqual(vm.totals.refunds, refunds);
  assert.deepEqual(vm.totals.refunds, [{ currency: 'AUD', amountMinor: 2900 }, { currency: 'JPY', amountMinor: 1200 }, { currency: 'USD', amountMinor: 0 }]);
  assert.deepEqual(vm.totals.afterRefunds, [{ currency: 'AUD', amountMinor: 3500 }, { currency: 'JPY', amountMinor: 500 }, { currency: 'USD', amountMinor: 1050 }]);
  // a1 and j1 delivered; a4 has no record and u1 is queued; a3 failed; the refunded a2 and j2 are not counted.
  assert.deepEqual(vm.totals.deliveries, { delivered: 2, waiting: 2, failed: 1 });
});

test('what is drawn is the same figures: JPY has no decimals, and two currencies are never added together', async () => {
  const { vm } = await fullDashboard();
  assert.equal(statOf(vm, 'sales', 'paid-orders').value, '7');
  assert.equal(statOf(vm, 'sales', 'sales-AUD').value, 'A$64');
  assert.equal(statOf(vm, 'sales', 'sales-JPY').value, 'JPY 1700'); // 1700 yen, not 17.00
  assert.equal(statOf(vm, 'sales', 'sales-USD').value, 'US$10.50');
  assert.equal(statOf(vm, 'sales', 'after-refunds-AUD').value, 'A$35');
  assert.equal(statOf(vm, 'sales', 'after-refunds-JPY').value, 'JPY 500');
  assert.equal(statOf(vm, 'refunds', 'refunds-AUD').value, 'A$29');
  assert.equal(statOf(vm, 'refunds', 'refunds-JPY').value, 'JPY 1200');
  assert.equal(statOf(vm, 'refunds', 'refunds-USD').value, 'US$0');
  assert.equal(statOf(vm, 'deliveries', 'delivered').value, '2');
  assert.equal(statOf(vm, 'deliveries', 'waiting').value, '2');
  assert.equal(statOf(vm, 'deliveries', 'failed').value, '1');
  // One stat per currency and no stat anywhere that holds a cross-currency sum (6400 + 1700 + 1050 = 9150 minor units).
  const sales = sectionOf(vm, 'sales');
  assert.equal(sales.stats.filter((s) => s.id.startsWith('sales-')).length, 3);
  assert.ok(sales.notes.includes(NOT_SUMMED_NOTE));
  const everything = JSON.stringify(vm);
  for (const wrong of ['9150', '91.50', '81.50', '8150', 'A$74.50', 'A$91']) assert.ok(!everything.includes(wrong), wrong);
  for (const s of vm.sections.flatMap((x) => x.stats)) if (s.kind === 'figure') assert.equal(s.estimate, false, `${s.id} is a counted figure, not an estimate`);
});

test('another business and another workspace never reach the totals', async () => {
  const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
  const world = await ordersWorld();
  const b = await loadDashboard(rt, ctx, { orders: world.orders }, 'biz-b', { now: NOW });
  assert.ok(b.found);
  if (!b.found) return;
  const vm = buildDashboard(b);
  assert.equal(vm.totals.paidOrders, 1);
  assert.deepEqual(vm.totals.sales, [{ currency: 'AUD', amountMinor: 9999 }]);
  // The partial refund recorded for biz-b's own order counts for biz-b, and only there.
  assert.deepEqual(vm.totals.refunds, [{ currency: 'AUD', amountMinor: 900 }]);
  assert.deepEqual(vm.totals.deliveries, { delivered: 1, waiting: 0, failed: 0 });
  assert.ok(!JSON.stringify(vm).includes('7777'), 'the other workspace order is not counted or shown');
});

// ---- acceptance 3: the demo business, and a business that is not ours ----
test('the /start demo business (no order, delivery, visit, post or cost source) shows honest unavailable states, never a zero', async () => {
  const rt = fakeRuntime(['demo-biz']);
  assert.deepEqual(dashboardSources(rt, {}), { orders: false, fulfilment: false, approvals: false, scheduledPosts: false, costs: false });
  const found = await loadDashboard(rt, ctx, {}, 'demo-biz', { now: NOW });
  assert.ok(found.found);
  if (!found.found) return;
  assert.equal(found.postApprovals, null);
  const vm = buildDashboard(found);
  assert.equal(vm.title, 'Dashboard');
  assert.equal(vm.businessName, 'Name demo-biz');
  assert.deepEqual(vm.totals, {
    paidOrders: null, sales: null, refunds: null, afterRefunds: null, deliveries: null, visits: null, postApprovals: null, scheduledPosts: null, costs: null,
  });
  assert.equal(statOf(vm, 'sales', 'paid-orders').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'sales', 'sales').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'refunds', 'refunds').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'deliveries', 'deliveries').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'visits', 'visits').value, NOT_MEASURED);
  assert.equal(statOf(vm, 'posts', 'scheduled-posts').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'posts', 'post-approvals').value, NOT_IN_DEMO);
  assert.equal(statOf(vm, 'costs', 'costs').value, NO_COST_DATA);
  assert.deepEqual(vm.sections.map((s) => s.id), ['sales', 'refunds', 'deliveries', 'visits', 'posts', 'costs']);
  for (const s of vm.sections) {
    assert.equal(s.unavailable, true, s.id);
    for (const st of s.stats) {
      assert.equal(st.kind, 'unavailable', st.id);
      assert.doesNotMatch(st.value, /\d/, `${st.id} shows words, not a number`);
      assert.ok(st.note && st.note.length > 0, `${st.id} explains itself`);
    }
  }
  assert.match(NOT_IN_DEMO, /Not available in the demo yet/);
  // Payments are not connected for a /start business: that is a real required action, linked to the page that shows it.
  const pay = vm.attention.items.find((i) => i.id.startsWith('seller:'));
  assert.ok(pay);
  assert.equal(pay.href, null, 'Payments is parked in the growth product');
  assert.equal(pay.linkLabel, 'Page coming soon');
  assert.ok(MISSING_WIRING.length >= 4);
});

test('an order source with no orders shows a real zero in the business currency, with words beside it', async () => {
  const found = await loadDashboard(fakeRuntime(['demo-biz']), ctx, { orders: async () => [] }, 'demo-biz', { now: NOW });
  assert.ok(found.found);
  if (!found.found) return;
  const vm = buildDashboard(found);
  assert.equal(vm.totals.paidOrders, 0);
  assert.deepEqual(vm.totals.sales, [{ currency: 'AUD', amountMinor: 0 }]);
  assert.equal(statOf(vm, 'sales', 'paid-orders').note, 'No paid orders yet.');
  assert.equal(statOf(vm, 'sales', 'sales-AUD').value, 'A$0');
  assert.equal(sectionOf(vm, 'sales').stats.some((s) => s.id.startsWith('after-refunds')), false);
  // Orders are read but there is still no delivery source: deliveries stay unavailable and refunds say what is missing.
  assert.equal(statOf(vm, 'deliveries', 'deliveries').value, NOT_IN_DEMO);
  assert.match(sectionOf(vm, 'refunds').notes.join(' '), /Partial refunds and disputes are not available in the demo yet/);
});

test('a business this runtime does not know is refused before anything is read, like the sibling pages', async () => {
  const rt: OverviewRuntime = { ...fakeRuntime(['biz-a']), fulfilment };
  const world = await ordersWorld();
  let approvalReads = 0;
  const extras: OverviewExtras = { orders: world.orders, approvals: async () => { approvalReads += 1; return []; } };
  assert.deepEqual(await loadDashboard(rt, ctx, extras, 'someone-elses-business', { now: NOW }), { found: false });
  assert.deepEqual(await loadDashboard(rt, ctx, extras, 'biz-b', { now: NOW }), { found: false });
  assert.equal(world.reads(), 0);
  assert.equal(approvalReads, 0);
  // The page uses the same gates as the sibling pages: demo storage, a well-formed id, then the known-business check in the loader.
  const page = readFileSync(new URL('../app/app/[business]/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /availability\(\)/);
  assert.match(page, /if \(!checkBusiness\(business\)\) return <UnknownBusiness \/>/);
  assert.match(page, /if \(!found\.found\) return <UnknownBusiness \/>/);
  assert.match(page, /dynamic = 'force-dynamic'/);
});

// ---- acceptance 2: estimates and missing cost data are labelled ----
test('a cost figure is always labelled as an estimate; missing cost data says "No cost data yet"', async () => {
  const { found } = await fullDashboard();
  const none = buildDashboard(found);
  const missing = statOf(none, 'costs', 'costs');
  assert.equal(missing.value, NO_COST_DATA);
  assert.equal(missing.kind, 'unavailable');
  assert.match(missing.note ?? '', /This is not zero/);
  assert.equal(none.totals.costs, null);

  const vm = buildDashboard({ ...found, costs: { amounts: [{ currency: 'USD', amountMinor: 123 }, { currency: 'JPY', amountMinor: 40 }], basis: 'Worked out from 12 AI generations at list price.' } });
  const costs = sectionOf(vm, 'costs');
  assert.equal(costs.title, 'Estimated costs');
  assert.deepEqual(costs.stats.map((s) => s.value), ['About US$1.23', 'About JPY 40']);
  for (const s of costs.stats) {
    assert.equal(s.estimate, true);
    assert.match(s.label, /^Estimated costs \(/);
    assert.ok(s.note?.startsWith(`${ESTIMATE}, not a bill.`));
    assert.match(s.note ?? '', /12 AI generations/);
  }
  assert.match(costs.notes.join(' '), /These are estimates/);
  assert.ok(costs.notes.includes(NOT_SUMMED_NOTE));
  // An amount that is not a whole number of minor units is not shown as a cost at all.
  const bad = buildDashboard({ ...found, costs: { amounts: [{ currency: 'USD', amountMinor: 1.5 }], basis: 'x' } });
  assert.equal(statOf(bad, 'costs', 'costs').value, NO_COST_DATA);
  // The view draws the Estimate tag from the same flag, and a "No data" tag on every figure with no source.
  const view = readFileSync(new URL('../app/app/[business]/dashboard/dashboard-view.tsx', import.meta.url), 'utf8');
  assert.match(view, /stat\.estimate \? <GlassBadge[^>]*>\{ESTIMATE\}<\/GlassBadge>/);
  assert.match(view, /stat\.kind === 'unavailable' \? <GlassBadge[^>]*>No data<\/GlassBadge>/);
});

test('visits are a figure only when a counter answers; posts waiting for approval are counted from the approvals list', async () => {
  const { found } = await fullDashboard();
  const measured = buildDashboard({ ...found, overview: { ...found.overview, summary: { ...found.overview.summary, visits: { known: true, value: 12 } } } });
  assert.equal(statOf(measured, 'visits', 'visits').value, '12');
  assert.equal(measured.totals.visits, 12);
  assert.equal(statOf(buildDashboard(found), 'visits', 'visits').value, NOT_MEASURED);

  const approval = (id: string, over: Partial<ApprovalView> = {}): ApprovalView => ({
    id, area: 'marketing', kind: 'scheduled-post', description: `Post ${id}`, status: 'pending', requestedAt: NOW().getTime() - 1000,
    expiresAt: NOW().getTime() + 60_000, decidedAt: null, jobId: null, ...over,
  });
  const list = [approval('p1'), approval('p2', { expiresAt: NOW().getTime() - 1 }), approval('p3', { status: 'approved' }), approval('s1', { kind: 'publish-site', area: 'publishing' })];
  assert.equal(countPostApprovals(list, NOW().getTime()), 1);
  const withPosts = await loadDashboard(fakeRuntime(['demo-biz']), ctx, { approvals: async () => list }, 'demo-biz', { now: NOW });
  assert.ok(withPosts.found);
  if (!withPosts.found) return;
  assert.equal(withPosts.postApprovals, 1);
  const vm = buildDashboard(withPosts);
  assert.equal(statOf(vm, 'posts', 'post-approvals').value, '1');
  // The count of SCHEDULED posts still has no source, whatever the approvals say.
  assert.equal(statOf(vm, 'posts', 'scheduled-posts').value, NOT_IN_DEMO);
  assert.equal(vm.totals.scheduledPosts, null);
  // The marketing page is built and in the workspace navigation (AMP-129), so that required action links to it.
  const post = vm.attention.items.find((i) => i.id === 'approval:p1');
  assert.ok(post);
  assert.match(post.href ?? '', /^\/app\/[^/]+\/marketing$/);
  assert.equal(post.linkLabel, 'Open Marketing');
});

test('an approvals read that throws or rejects only makes that one figure unavailable; the rest of the dashboard still shows', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  // The overview read model reads approvals first (that read is the read model's own, and on the page it sits behind the cache).
  // The dashboard's count is the SECOND read, outside the cache: that is the one that fails here, once by throwing, once by rejecting.
  const failSecond = (fail: () => Promise<ApprovalView[]>): NonNullable<OverviewExtras['approvals']> => {
    let reads = 0;
    return (() => { reads += 1; return reads === 1 ? Promise.resolve([]) : fail(); }) as NonNullable<OverviewExtras['approvals']>;
  };
  const failing = [
    failSecond(() => { throw new Error('approvals store down: secret-detail'); }),
    failSecond(async () => { throw new TypeError('approvals store down: secret-detail'); }),
  ];
  for (const approvals of failing) {
    const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
    const world = await ordersWorld();
    const found = await loadDashboard(rt, ctx, { orders: world.orders, approvals }, 'biz-a', { now: NOW });
    assert.ok(found.found, 'the page does not fall to its error state');
    if (!found.found) return;
    assert.equal(found.postApprovals, null);
    assert.equal(found.postApprovalsFailed, true);
    assert.equal(found.sources.approvals, true, 'the source is wired; it just could not be read');
    const vm = buildDashboard(found);
    const stat = statOf(vm, 'posts', 'post-approvals');
    assert.equal(stat.kind, 'unavailable');
    assert.equal(stat.value, NOT_IN_DEMO);
    assert.equal(stat.note, APPROVALS_NOT_READ);
    assert.doesNotMatch(stat.value, /\d/, 'never a zero');
    assert.equal(vm.totals.postApprovals, null);
    // Everything else is the same as with no approvals source at all.
    assert.equal(vm.totals.paidOrders, 7);
    assert.deepEqual(vm.totals.sales, [{ currency: 'AUD', amountMinor: 6400 }, { currency: 'JPY', amountMinor: 1700 }, { currency: 'USD', amountMinor: 1050 }]);
    assert.deepEqual(vm.totals.deliveries, { delivered: 2, waiting: 2, failed: 1 });
    assert.equal(statOf(vm, 'sales', 'sales-AUD').value, 'A$64');
  }
  assert.ok(logged.length >= 2, 'each failure is logged');
  assert.ok(!JSON.stringify(logged).includes('secret-detail'), 'only the error name is logged, never its message');
  // With a source that answers, the flag is off and the wording is the plain "no list here" one only when there is no source.
  const ok = await loadDashboard(fakeRuntime(['demo-biz']), ctx, { approvals: async () => [] }, 'demo-biz', { now: NOW });
  assert.ok(ok.found);
  if (!ok.found) return;
  assert.equal(ok.postApprovalsFailed, false);
  assert.equal(ok.postApprovals, 0);
});

test('AMP-109: an approvals read that fails on EVERY call, or on the first call only, never takes the dashboard or the overview to an error state', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  type Read = NonNullable<OverviewExtras['approvals']>;
  const firstOnly = (fail: () => Promise<ApprovalView[]>): Read => {
    let reads = 0;
    return (() => { reads += 1; return reads === 1 ? fail() : Promise.resolve([]); }) as Read;
  };
  const throws = (): Promise<ApprovalView[]> => { throw new Error('approvals store down: secret-detail'); };
  const rejects = async (): Promise<ApprovalView[]> => { throw new TypeError('approvals store down: secret-detail'); };
  // Factories: "first call only" counts its own calls, so each run gets a fresh one.
  const failing: (() => Read)[] = [() => throws as Read, () => rejects as Read, () => firstOnly(throws), () => firstOnly(rejects)];
  for (const [n, make] of failing.entries()) {
    for (const cached of [false, true]) {
      const approvals = make();
      const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
      const world = await ordersWorld();
      const extras: OverviewExtras = { orders: world.orders, approvals };
      const cache = cached ? sharedOverviewCache(rt, ctx, extras, NOW) : undefined;
      const found = await loadDashboard(rt, ctx, extras, 'biz-a', { now: NOW, cache });
      assert.ok(found.found, `case ${n}: the page does not fall to its error state`);
      if (!found.found) return;
      assert.equal(found.postApprovals, null, 'unknown, never zero');
      assert.equal(found.postApprovalsFailed, true);
      const vm = buildDashboard(found);
      const stat = statOf(vm, 'posts', 'post-approvals');
      assert.equal(stat.kind, 'unavailable');
      assert.equal(stat.value, NOT_IN_DEMO);
      assert.equal(stat.note, APPROVALS_NOT_READ);
      assert.equal(vm.totals.postApprovals, null);
      assert.equal(vm.attention.empty, ATTENTION_APPROVALS_NOT_READ, 'never "nothing needs you" over an unread list');
      // The rest of the dashboard is all there.
      assert.equal(vm.totals.paidOrders, 7);
      assert.deepEqual(vm.totals.deliveries, { delivered: 2, waiting: 2, failed: 1 });
      assert.equal(statOf(vm, 'sales', 'sales-AUD').value, 'A$64');
      // The Business Overview page reads through the same adapter: it renders, and says the approvals list was not read.
      const o = cache ? await loadCachedBusinessOverview(cache, rt, ctx, 'biz-a') : await loadBusinessOverview(rt, ctx, { orders: world.orders, approvals: throws as Read }, 'biz-a', NOW);
      assert.ok(o.found);
      if (!o.found) return;
      assert.equal(o.approvalsFailed, true);
      const ovm = buildOverviewViewModel({ overview: o.overview, businessName: o.businessName, storeStatus: o.storeStatus, freshness: o.freshness, approvalsFailed: o.approvalsFailed });
      assert.ok(ovm.banners.some((b) => b.id === 'approvals_not_read'));
      if (cache) assert.equal(o.freshness?.approvalsFailed, true, 'the page passes only `freshness` on, so the flag travels there too');
    }
  }
  assert.ok(logged.length >= failing.length * 2, 'each failure is logged');
  assert.ok(!JSON.stringify(logged).includes('secret-detail'), 'only the error name is logged, never its message');
  // A list that reads fine: no flag, no banner, and the usual words.
  const rt = fakeRuntime(['demo-biz']);
  const fine = await loadBusinessOverview(rt, ctx, { approvals: async () => [] }, 'demo-biz', NOW);
  assert.ok(fine.found);
  if (!fine.found) return;
  assert.equal(fine.approvalsFailed, false);
  assert.ok(!buildOverviewViewModel({ overview: fine.overview, approvalsFailed: fine.approvalsFailed }).banners.some((b) => b.id === 'approvals_not_read'));
  const d = await loadDashboard(rt, ctx, { approvals: async () => [] }, 'demo-biz', { now: NOW });
  assert.ok(d.found);
  if (d.found) assert.equal(buildDashboard(d).attention.empty, NOTHING_NEEDS_YOU);
});

test('AMP-137: a failed approvals read for one business leaves another business\'s dashboard untouched, in either order', async (t) => {
  t.mock.method(console, 'error', () => {});
  const approval = (id: string, businessId: string): ApprovalView => ({
    id, area: 'marketing', kind: 'scheduled-post', description: `Post ${id} (${businessId})`, status: 'pending', requestedAt: NOW().getTime() - 1000,
    expiresAt: NOW().getTime() + 60_000, decidedAt: null, jobId: null,
  });
  const approvals: NonNullable<OverviewExtras['approvals']> = async (scope) => {
    if (scope.businessId === 'biz-a') throw new Error('approvals store down: secret-detail');
    return [approval('b-p1', scope.businessId), approval('b-p2', scope.businessId)];
  };
  const load = async (businessId: string) => {
    const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
    const world = await ordersWorld();
    const found = await loadDashboard(rt, ctx, { orders: world.orders, approvals }, businessId, { now: NOW });
    assert.ok(found.found, businessId);
    if (!found.found) throw new Error('unreachable');
    return { found, vm: buildDashboard(found) };
  };
  for (const order of [['biz-a', 'biz-b'], ['biz-b', 'biz-a']]) {
    const results = new Map<string, Awaited<ReturnType<typeof load>>>();
    for (const b of order) results.set(b, await load(b));
    const a = results.get('biz-a')!;
    const b = results.get('biz-b')!;
    assert.equal(a.found.postApprovals, null);
    assert.equal(a.found.postApprovalsFailed, true);
    assert.equal(statOf(a.vm, 'posts', 'post-approvals').note, APPROVALS_NOT_READ);
    // The other business: its own list was read, counted and shown; nothing of the failure leaks into it.
    assert.equal(b.found.postApprovalsFailed, false);
    assert.equal(b.found.postApprovals, 2);
    assert.equal(statOf(b.vm, 'posts', 'post-approvals').value, '2');
    assert.equal(b.vm.totals.postApprovals, 2);
    assert.equal(b.vm.totals.paidOrders, 1);
    assert.deepEqual(b.vm.totals.sales, [{ currency: 'AUD', amountMinor: 9999 }]);
    assert.notEqual(b.vm.attention.empty, ATTENTION_APPROVALS_NOT_READ);
  }
});

test('AMP-137: a first-call-only approvals failure on the uncached overview path flags that one load, then recovers on the next', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  let reads = 0;
  const approvals: NonNullable<OverviewExtras['approvals']> = async () => {
    reads += 1;
    if (reads === 1) throw new TypeError('approvals store down: secret-detail');
    return [];
  };
  const rt: OverviewRuntime = { ...fakeRuntime(['biz-a', 'biz-b']), fulfilment };
  const world = await ordersWorld();
  const extras: OverviewExtras = { orders: world.orders, approvals };
  // No cache: this is loadBusinessOverview itself, the path the overview page takes when it is not behind the shared cache.
  const first = await loadBusinessOverview(rt, ctx, extras, 'biz-a', NOW);
  assert.ok(first.found);
  if (!first.found) return;
  assert.equal(first.approvalsFailed, true);
  assert.ok(buildOverviewViewModel({ overview: first.overview, approvalsFailed: first.approvalsFailed }).banners.some((b) => b.id === 'approvals_not_read'));
  // The next read (a later page load) succeeds: the flag and the banner are gone, with no cache holding the failure.
  const second = await loadBusinessOverview(rt, ctx, extras, 'biz-a', NOW);
  assert.ok(second.found);
  if (!second.found) return;
  assert.equal(second.approvalsFailed, false);
  assert.ok(!buildOverviewViewModel({ overview: second.overview, approvalsFailed: second.approvalsFailed }).banners.some((b) => b.id === 'approvals_not_read'));
  // The uncached dashboard on the same kind of source is not taken to an error state either, and its orders are all there.
  reads = 0;
  const d = await loadDashboard(rt, ctx, extras, 'biz-a', { now: NOW });
  assert.ok(d.found);
  if (!d.found) return;
  assert.equal(d.postApprovals, null);
  assert.equal(d.postApprovalsFailed, true);
  assert.equal(buildDashboard(d).totals.paidOrders, 7);
  assert.equal(logged.length >= 2, true, 'each failure is logged');
  assert.ok(logged.every((l) => l[1] === 'TypeError'), 'only the error name is logged');
  assert.ok(!JSON.stringify(logged).includes('secret-detail'));
});

// ---- needs your attention ----
test('each required action links to the workspace page that fixes it, and only to pages that exist', async () => {
  const { vm } = await fullDashboard();
  const by = (prefix: string) => { const i = vm.attention.items.find((x) => x.id.startsWith(prefix)); assert.ok(i, prefix); return i; };
  // Growth product: shop pages (Orders, Payments) are parked, so their items are never links to a page that redirects away.
  assert.equal(by('delivery:a3').href, null);
  assert.equal(by('money:e-partial').href, null);
  assert.equal(by('seller:').href, null);
  assert.match(vm.attention.title, /^Needs your attention \(\d+\)$/);
  assert.deepEqual(vm.attention.items.map((i) => i.rank), vm.attention.items.map((_, n) => n + 1));
  for (const i of vm.attention.items) assert.ok(i.href === null ? i.linkLabel === COMING_SOON : i.href.startsWith('/app/biz-a'), i.id);

  assert.deepEqual(attentionLink('/app/biz-a/sales', 'biz-a'), { href: '/app/biz-a/sales', linkLabel: 'Open AI Sales' });
  assert.deepEqual(attentionLink('/app/biz-a/products', 'biz-a').href, null, 'parked');
  assert.deepEqual(attentionLink('/app/biz-a', 'biz-a'), { href: '/app/biz-a', linkLabel: 'Open Overview' });
  assert.deepEqual(attentionLink('/app/biz-a/marketing', 'biz-a'), { href: '/app/biz-a/marketing', linkLabel: 'Open Marketing' });
  for (const dead of ['/app/biz-a/settings', '/app/biz-a/analytics', '/app/biz-b/orders', '/app/biz-abc/orders', 'https://example.test/app/biz-a/orders', '/start']) {
    assert.deepEqual(attentionLink(dead, 'biz-a'), { href: null, linkLabel: COMING_SOON }, dead);
  }
});

test('nothing to do reads as calm words, and stale or unreadable numbers are said out loud', async () => {
  const { found } = await fullDashboard();
  const calm = buildDashboard({ ...found, overview: { ...found.overview, needsYou: [], needsYouTotal: 0 } });
  assert.equal(calm.attention.title, 'Needs your attention');
  assert.equal(calm.attention.empty, NOTHING_NEEDS_YOU);
  assert.deepEqual(calm.banners, []);

  const old = buildDashboard({ ...found, freshness: { refreshedAt: '2026-11-14T08:00:00.000Z', ageMs: 2 * 3_600_000, stale: true, refreshFailed: false } });
  assert.deepEqual(old.banners.map((b) => b.id), ['stale']);
  assert.match(old.updatedWords, /^About 2 hours ago · 2026-11-14 08:00 UTC$/);
  const failed = buildDashboard({ ...found, freshness: { refreshedAt: '2026-11-14T09:59:00.000Z', ageMs: 60_000, stale: false, refreshFailed: true } });
  assert.deepEqual(failed.banners.map((b) => b.id), ['refresh_failed']);
  const low = buildDashboard({ ...found, overview: { ...found.overview, summary: { ...found.overview.summary, invalidAmounts: 2 } } });
  assert.deepEqual(low.banners.map((b) => b.id), ['invalid_amounts']);
  assert.match(low.banners[0].text, /could not read 2 amounts/);
});

// ---- structure ----
test('one h1, an h2 per section, and the page is built on the glass library with 44px targets and no income claims', async () => {
  const { vm } = await fullDashboard();
  const outline = headingOutline(vm);
  assert.equal(outline.filter((h) => h.level === 1).length, 1);
  assert.deepEqual(outline.filter((h) => h.level === 2).map((h) => h.text).slice(1), ['Sales', 'Refunds', 'Deliveries', 'Store visits', 'Scheduled posts', 'Estimated costs']);
  assert.equal(dashboardHref('biz-a'), '/app/biz-a/dashboard');
  assert.equal(vm.overviewHref, '/app/biz-a');

  const view = readFileSync(new URL('../app/app/[business]/dashboard/dashboard-view.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/app/[business]/dashboard/dashboard.css', import.meta.url), 'utf8');
  assert.match(view, /from '..\/..\/..\/design-system\/aimp-glass'/);
  assert.match(view, /<AppLayout width="wide">/);
  // The CSS removes the list markers, so the list says it is a list (VoiceOver drops the semantics otherwise).
  assert.match(css, /\.adb-attention \{[^}]*list-style: none/);
  assert.match(view, /<ol className="adb-attention" role="list">/);
  assert.doesNotMatch(view, /<button|onClick|use client/, 'read-only: no control that changes anything');
  assert.match(css, /\.adb-link \{[^}]*min-block-size: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /(?<![-\w])width:\s*\d{3,}px|min-width:\s*\d{3,}px/, 'no fixed width that could force sideways scrolling');
  assert.doesNotMatch(`${JSON.stringify(vm)}${view}`, /guarantee|passive income|you will earn|profit/i);
});

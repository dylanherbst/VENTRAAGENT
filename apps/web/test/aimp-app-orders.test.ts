// Orders queue and order detail (screens 19 and 20, AMP-086; H19 H20). The server reads, the view model and the action guard run against
// the REAL owner-orders service on the real fulfilment fixture world (in-memory stores), built the way the owner-orders tests build it.
// The /start runtime has no order store, so the page's own source is null: that honest state is tested too (and what it would need).
// Server actions are not run here (actions.ts imports Next-only modules), but the guard that decides whether and with what the service
// runs is, and the last tests run the two service calls the action makes for an allowed request.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BAD_REQUEST, NO_BUSINESS, NO_ORDER, NO_ORDERS_YET, guardOrderAction, isOrderActionKind, isOrderId, isRequestKey,
} from '../app/app/[business]/orders/_server/order-guard.ts';
import { MISSING_WIRING, loadOrder, loadOrders, ordersSource } from '../app/app/[business]/orders/_server/orders.ts';
import type { OrdersRuntime, OrdersSource } from '../app/app/[business]/orders/_server/orders.ts';
import {
  ACTOR_AUTOMATIC, ACTOR_PERSON, ACTOR_UNKNOWN, ACTOR_YOU, DEMO_NOTE, NO_STORE_TEXT, NO_STORE_TITLE, REFUND_NOTE, TEST_ORDER_LABEL, actorLabel, buildDetail, buildList, buildRow, emptyCopy, newRequestKey, orderHref, ordersHref, parseCursor, parseFilter,
} from '../app/app/[business]/orders/view-model.ts';
import { orderIsTest } from '../app/start/_server/checkout-runtime.ts';
import { SAMPLE_SELLER_PREFIX } from '../app/start/_server/orders-runtime.ts';
import { workspaceNavHref, workspaceNavItems } from '../app/app/[business]/workspace-nav-items.ts';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import { reissueAccess, resendDelivery } from '../lib/aimp/owner-orders/index.ts';
import { ownerOrdersDeps, seedOrder } from '../lib/aimp/owner-orders/demo.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'Demo storage is off.' };
const OWNER = 'demo-owner';

async function setup() {
  const w = await createFulfilmentWorld({ now: () => new Date(START) });
  const a = w.stores.a;
  const b = w.stores.b;
  const rt: OrdersRuntime = {
    businesses: new Set([a.businessId, b.businessId, 'biz-second']), seeds: new Map(), slugs: new Map(), productIds: new Map(),
  };
  const source: OrdersSource = { deps: ownerOrdersDeps(w), workspaceId: a.workspaceId, actorId: OWNER };
  const guard = (businessId: unknown, orderId: unknown, kind: unknown, key: unknown, over: { source?: OrdersSource | null; availability?: typeof ON } = {}) =>
    guardOrderAction({ availability: over.availability ?? ON, rt: () => rt, source: () => (over.source === undefined ? source : over.source) }, businessId, orderId, kind, key);
  return { w, a, b, rt, source, guard };
}

/** Narrows a lookup to the "orders are available" branch (fails the test otherwise). */
function availablePage(r: Awaited<ReturnType<typeof loadOrders>>) {
  if (!r.found || !r.available) throw new assert.AssertionError({ message: 'expected an available orders page' });
  return r;
}

// ---- the honest state of the /start demo ----
test('a runtime without order stores has no orders source, so the list says no orders can exist yet and no order can be opened', async () => {
  const rt: OrdersRuntime = { businesses: new Set(['biz-a']), seeds: new Map(), slugs: new Map(), productIds: new Map() };
  assert.equal(ordersSource(rt), null);
  const list = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.deepEqual(list, { found: true, available: false });
  assert.deepEqual(await loadOrder(rt, ordersSource(rt), 'biz-a', 'ord_1'), { found: false });
  assert.deepEqual(await loadOrders(rt, null, 'unknown', { filter: 'all', cursor: null }), { found: false }, 'an unknown business is unknown, not "no orders"');
  assert.match(NO_STORE_TITLE, /Orders cannot be read right now/); // AMP-138: wording updated, the runtime has had an order store since AMP-103
  assert.doesNotMatch(`${NO_STORE_TITLE} ${NO_STORE_TEXT}`, /cannot exist|no checkout|nothing can be bought/i);
  assert.match(NO_STORE_TEXT, /not a count of zero sales/);
  assert.ok(MISSING_WIRING.length >= 3);
});

test('AMP-103: the real /start runtime file now builds an order store and fulfilment service (in orders-runtime.ts) and the source reads them', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /orderDemo: createStartOrders\(/);
  const wiring = readFileSync(new URL('../app/start/_server/orders-runtime.ts', import.meta.url), 'utf8');
  assert.match(wiring, /createMemoryOrderStore/);
  assert.match(wiring, /createFulfilmentService/);
});

// ---- the server reads on the real service ----
test('the list holds only this business\'s orders, newest first, with buyer-safe summaries and counts', async () => {
  const { w, a, rt, source } = await setup();
  w.email.failNext(1);
  const failed = await w.buy('a');
  const ok = await w.buy('a');
  const otherStore = await w.buy('b');
  await seedOrder(w.orders, { id: 'ord-second', workspaceId: a.workspaceId, businessId: 'biz-second', createdAt: '2026-11-14T09:00:00Z', paid: true });

  const r = await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null });
  assert.ok(r.found && r.available);
  const ids = r.page.orders.map((o) => o.id);
  assert.deepEqual([...ids].sort(), [failed.orderId, ok.orderId].sort());
  assert.ok(!ids.includes(otherStore.orderId) && !ids.includes('ord-second'));
  assert.deepEqual(r.page.counts, { all: 2, needs_attention: 1, delivered: 1, refunded: 0 }, 'the failed delivery needs attention; delivered counts only the paid and delivered one');
  const raw = JSON.stringify(r.page);
  assert.doesNotMatch(raw, /buyer-a@example\.test/, 'only the masked address is read');

  const second = await loadOrders(rt, source, 'biz-second', { filter: 'all', cursor: null });
  assert.ok(second.found && second.available);
  assert.deepEqual(second.page.orders.map((o) => o.id), ['ord-second'], 'the other business in the same workspace sees only its own order');
});

test('a filter and a cursor are passed to the service; a bad cursor falls back to the first page', async () => {
  const { w, a, rt, source } = await setup();
  for (let i = 0; i < 3; i++) await w.buy('a');
  const delivered = await loadOrders(rt, source, a.businessId, { filter: 'delivered', cursor: null });
  assert.ok(delivered.found && delivered.available && delivered.page.total === 3);
  const refunded = await loadOrders(rt, source, a.businessId, { filter: 'refunded', cursor: null });
  assert.ok(refunded.found && refunded.available && refunded.page.total === 0);
  const bad = await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: 'not a cursor!' });
  assert.ok(bad.found && bad.available && bad.page.orders.length === 3);
});

test('AMP-102: after a bad or unknown cursor page 1 is shown, so there is no "Back to the newest orders" link; a real cursor keeps it', async () => {
  const { w, a, rt, source } = await setup();
  for (let i = 0; i < 3; i++) await w.buy('a');
  assert.equal(availablePage(await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null })).cursor, null);
  // 'bm9wZQ' is well-formed base64url that decodes to no cursor; the others are malformed.
  for (const cursor of ['not a cursor!', 'bm9wZQ', '%%%', 'x'.repeat(301)]) {
    for (const filter of ['all', 'delivered'] as const) {
      const r = availablePage(await loadOrders(rt, source, a.businessId, { filter, cursor }));
      assert.equal(r.cursor, null, `${cursor.slice(0, 20)}: no cursor was really used`);
      assert.equal(r.page.orders.length, 3, 'page 1 is shown');
      const vm = buildList(a.businessId, r.page, r.cursor);
      assert.equal(vm.firstPageHref, null, `${cursor.slice(0, 20)} ${filter}: no link back to the page already shown`);
    }
  }
  // A real cursor from the service is reported back, so page 2 keeps its link to the newest orders.
  const { listOwnerOrders } = await import('../lib/aimp/owner-orders/index.ts');
  const first = await listOwnerOrders(source.deps, { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER }, { limit: 2 });
  assert.ok(first.nextCursor);
  const real = availablePage(await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: first.nextCursor }));
  assert.equal(real.cursor, first.nextCursor);
  assert.equal(buildList(a.businessId, real.page, real.cursor).firstPageHref, `/app/${a.businessId}/orders`);
  // The page hands buildList the cursor loadOrders reports, not the one in the address.
  const page = readFileSync(new URL('../app/app/[business]/orders/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /buildList\(business, found\.page, found\.cursor, found\.testIds\)/);
});

test('AMP-102: a prototype-key order id is not found by loadOrder: it never throws and never returns an inherited value', async () => {
  const { w, a, rt, source } = await setup();
  await w.buy('a');
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    for (const biz of [a.businessId, 'biz-second']) {
      const r = await loadOrder(rt, source, biz, id);
      assert.deepEqual(r, { found: false }, `${biz} ${id}`);
      assert.equal(Object.hasOwn(r, 'order'), false, id);
    }
    assert.deepEqual(await loadOrder(rt, null, a.businessId, id), { found: false }, `${id} with no source`);
  }
});

test('AMP-102: a zero-decimal currency is not divided by 100: a JPY order of 1500 minor units reads "JPY 1500" in the row and the detail', async () => {
  const { w, a, rt, source } = await setup();
  // The order type only allows AUD today, so the JPY order is written to the real order store with a cast (the store does not check
  // the currency) and marked paid through the same store step the webhook uses. Everything after that is the real read model.
  const { order } = await w.orders.createPending({
    id: 'ord-jpy', workspaceId: a.workspaceId, businessId: 'biz-second', storeSlug: 'slug-biz-second', listingId: 'lst-ord-jpy', listingVersion: 1,
    productId: 'prod-ord-jpy', productVersion: 1, title: 'Yen product', amountMinor: 1500, currency: 'JPY' as 'AUD', sellerAccountId: 'acct-biz-second',
    buyerEmail: 'seed-buyer@example.test', idempotencyKey: 'key-ord-jpy', createdAt: '2026-11-14T09:00:00Z',
  });
  await w.orders.attachSession(order.id, { id: 'cs_ord-jpy', url: 'https://pay.example.test/session' });
  const paid = await w.orders.applyPaid({ eventId: 'evt_ord-jpy', sessionId: 'cs_ord-jpy', amountMinor: 1500, currency: 'JPY', at: '2026-11-14T09:00:00Z' });
  assert.equal(paid.outcome, 'paid');

  const list = availablePage(await loadOrders(rt, source, 'biz-second', { filter: 'all', cursor: null }));
  const summary = list.page.orders.find((o) => o.id === 'ord-jpy');
  assert.ok(summary);
  assert.deepEqual([summary.amountMinor, summary.currency], [1500, 'JPY'], 'the read model passes the order through unchanged');
  const row = buildRow('biz-second', summary);
  assert.equal(row.amount, 'JPY 1500');

  const d = await loadOrder(rt, source, 'biz-second', 'ord-jpy');
  assert.ok(d.found);
  const vm = buildDetail('biz-second', d.order);
  assert.equal(vm.facts.find((f) => f.label === 'Amount')?.value, 'JPY 1500');
  assert.deepEqual(vm.lineItems.map((l) => l.amount), ['JPY 1500']);
  assert.doesNotMatch(JSON.stringify([row, vm]), /JPY 15(\.00)?"/, 'never 15 yen');
});

// ---- AMP-138: test orders are labelled, decided on the server ----
async function seedSampleOrder(w: Awaited<ReturnType<typeof setup>>['w'], workspaceId: string, id: string, sellerAccountId: string) {
  const { order } = await w.orders.createPending({
    id, workspaceId, businessId: 'biz-second', storeSlug: 'slug-biz-second', listingId: `lst-${id}`, listingVersion: 1,
    productId: `prod-${id}`, productVersion: 1, title: `Item ${id}`, amountMinor: 1400, currency: 'AUD', sellerAccountId,
    buyerEmail: 'seed-buyer@example.test', idempotencyKey: `key-${id}`, createdAt: '2026-11-14T09:00:00Z',
  });
  await w.orders.attachSession(order.id, { id: `cs_${id}`, url: 'https://pay.example.test/session' });
  const paid = await w.orders.applyPaid({ eventId: `evt_${id}`, sessionId: `cs_${id}`, amountMinor: 1400, currency: 'AUD', at: '2026-11-14T09:00:00Z' });
  assert.equal(paid.outcome, 'paid');
}

test('AMP-138/AMP-152: an order carrying the stored test flag is labelled on the row and the detail; a real order is not (even with a sample seller id)', async () => {
  const { w, a, rt, source: base } = await setup();
  await seedSampleOrder(w, a.workspaceId, 'ord-sample', `${SAMPLE_SELLER_PREFIX}biz-second`);
  await seedSampleOrder(w, a.workspaceId, 'ord-real', 'acct-biz-second');
  // The flag is stored when the order is created; the seller id is not what decides.
  const source: OrdersSource = { ...base, isTest: (id) => id === 'ord-sample' };

  const list = availablePage(await loadOrders(rt, source, 'biz-second', { filter: 'all', cursor: null }));
  assert.deepEqual(list.testIds, ['ord-sample']);
  const vm = buildList('biz-second', list.page, list.cursor, list.testIds);
  assert.equal(vm.rows.find((r) => r.id === 'ord-sample')?.test, true);
  assert.equal(vm.rows.find((r) => r.id === 'ord-real')?.test, false);
  assert.match(vm.testNote ?? '', /include test orders/);
  assert.equal(TEST_ORDER_LABEL, 'Test order: no real payment');

  const sample = await loadOrder(rt, source, 'biz-second', 'ord-sample');
  const real = await loadOrder(rt, source, 'biz-second', 'ord-real');
  assert.ok(real.found && !real.test, 'a real order stays unlabelled');
  assert.ok(sample.found && real.found);
  assert.equal(sample.test, true);
  assert.equal(real.test, false);
  assert.equal(buildDetail('biz-second', sample.order, null, sample.test).test, true);
  assert.equal(buildDetail('biz-second', real.order, null, real.test).test, false);

  const onlyReal = buildList('biz-second', list.page, list.cursor, []);
  assert.equal(onlyReal.testNote, null, 'no test order listed, no note');
  assert.ok(onlyReal.rows.every((r) => !r.test));

  // A sample seller id WITHOUT the flag is not labelled: the flag decides, not the seller id.
  const unflagged = availablePage(await loadOrders(rt, { ...base, isTest: () => false }, 'biz-second', { filter: 'all', cursor: null }));
  assert.deepEqual(unflagged.testIds, []);
});

test('AMP-152: the label makes no second read of the order per row: loadOrders reads the store exactly as the plain list does', async () => {
  const { w, a, rt, source: base } = await setup();
  for (let i = 0; i < 3; i++) await w.buy('a');
  let gets = 0;
  const orders = { ...base.deps.orders, get: async (...args: Parameters<typeof base.deps.orders.get>) => { gets++; return base.deps.orders.get(...args); } } as typeof base.deps.orders;
  const source: OrdersSource = { ...base, deps: { ...base.deps, orders }, isTest: () => false };
  const { listOwnerOrders } = await import('../lib/aimp/owner-orders/index.ts');
  await listOwnerOrders(source.deps, { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER }, { filter: 'all', cursor: null });
  const plain = gets;
  gets = 0;
  availablePage(await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null }));
  assert.equal(gets, plain, 'the label added no read of the order');
});

test('AMP-152: a label whose flag read fails closed: the order is shown as a test order, never as a real one', async () => {
  const { w, a, rt, source: base } = await setup();
  await seedSampleOrder(w, a.workspaceId, 'ord-sample', `${SAMPLE_SELLER_PREFIX}biz-second`);
  const broken: OrdersSource = { ...base, isTest: () => { throw new Error('flag store down'); } };
  const list = availablePage(await loadOrders(rt, broken, 'biz-second', { filter: 'all', cursor: null }));
  assert.deepEqual(list.testIds, ['ord-sample']);
  const rejecting: OrdersSource = { ...base, isTest: async () => { throw new Error('flag store down'); } };
  assert.deepEqual(availablePage(await loadOrders(rt, rejecting, 'biz-second', { filter: 'all', cursor: null })).testIds, ['ord-sample']);
  const detail = await loadOrder(rt, broken, 'biz-second', 'ord-sample');
  assert.ok(detail.found);
  assert.equal(detail.test, true);
  // With no override the flag is read from the stored order.
  const runtimeRt: OrdersRuntime = { ...rt, orderDemo: { orders: base.deps.orders, fulfilment: base.deps.fulfilment, now: base.deps.now, workspaceId: a.workspaceId, actorId: OWNER } };
  const real = ordersSource(runtimeRt);
  assert.ok(real);
  assert.deepEqual(availablePage(await loadOrders(runtimeRt, real, 'biz-second', { filter: 'all', cursor: null })).testIds, [], 'stored flag is false: not labelled');
});

test('AMP-163: with the default flag reader, a failing order read is shown as test, and the label reads each order once', async () => {
  const { w, a, rt, source: base } = await setup();
  await seedSampleOrder(w, a.workspaceId, 'ord-real', 'acct-biz-second');
  let gets = 0;
  const failing = { ...base.deps.orders, get: async () => { gets++; throw new Error('store down'); } } as typeof base.deps.orders;
  const source: OrdersSource = { ...base, deps: { ...base.deps, orders: failing } };
  const list = availablePage(await loadOrders(rt, source, 'biz-second', { filter: 'all', cursor: null }));
  assert.ok(list.page.orders.length > 0);
  assert.deepEqual(list.testIds.sort(), list.page.orders.map((o) => o.id).sort(), 'every order whose flag cannot be read is shown as test');
  assert.ok(gets >= list.page.orders.length);
});

// ---- AMP-162: the flag is stored on the Order record; a record without it never flips real/test the wrong way ----
test('AMP-162: the memory store writes an explicit test flag at creation: false by default, true only when the server marks it', async () => {
  const { createMemoryOrderStore } = await import('../lib/aimp/orders/index.ts');
  const base = {
    workspaceId: 'ws-1', businessId: 'b-1', storeSlug: 's', listingId: 'l-1', listingVersion: 1, productId: 'p', productVersion: 1, title: 'T', amountMinor: 1000,
    currency: 'AUD' as const, sellerAccountId: 'acct-real', buyerEmail: 'x@example.test', createdAt: '2026-11-14T09:00:00Z',
  };
  const plain = createMemoryOrderStore();
  assert.equal((await plain.createPending({ ...base, id: 'o1', idempotencyKey: 'k1' })).order.test, false);
  assert.equal((await plain.createPending({ ...base, id: 'o2', idempotencyKey: 'k2', test: true })).order.test, true);
  const marked = createMemoryOrderStore({ testOnCreate: (n) => n.idempotencyKey === 'k-test' });
  assert.equal((await marked.createPending({ ...base, id: 'o3', idempotencyKey: 'k-test' })).order.test, true);
  assert.equal((await marked.createPending({ ...base, id: 'o4', idempotencyKey: 'k-real' })).order.test, false);
  const throwing = createMemoryOrderStore({ testOnCreate: () => { throw new Error('x'); } });
  // AMP-162 F2: a throwing callback does not fail open to a real order; the error propagates and nothing is stored.
  await assert.rejects(() => throwing.createPending({ ...base, id: 'o5', idempotencyKey: 'k5' }));
  assert.equal((await throwing.list('ws-1')).length, 0);
  // A retry of the same order does not change the stored flag.
  const retry = await marked.createPending({ ...base, id: 'o6', idempotencyKey: 'k-test', test: false });
  assert.deepEqual([retry.created, retry.order.id, retry.order.test], [false, 'o3', true]);
  // It survives the later transitions and reads.
  await marked.attachSession('o3', { id: 'cs_o3', url: 'u' });
  await marked.applyPaid({ eventId: 'e3', sessionId: 'cs_o3', amountMinor: 1000, currency: 'AUD', at: '2026-11-14T09:00:00Z' });
  assert.equal((await marked.get('ws-1', 'o3'))?.test, true);
});

test('AMP-162: a record WITHOUT the stored field reads by seller account only: a real seller is never test, a sample seller is never real; a stored value always wins', () => {
  const real = { sellerAccountId: 'acct_1RealConnected' };
  const sample = { sellerAccountId: `${SAMPLE_SELLER_PREFIX}biz-a` };
  assert.equal(orderIsTest(real), false, 'a real paid order without the field is not labelled test');
  assert.equal(orderIsTest(sample), true, 'a sample order without the field is not shown as real');
  assert.equal(orderIsTest({ ...real, test: true }), true);
  assert.equal(orderIsTest({ ...sample, test: false }), false, 'the stored flag wins over the seller id');
  for (const bad of [null, undefined, 'true', 1, 0, {}]) {
    assert.equal(orderIsTest({ ...real, test: bad as unknown as boolean }), false, `junk flag ${String(bad)} on a real seller is not test`);
    assert.equal(orderIsTest({ ...sample, test: bad as unknown as boolean }), true, `junk flag ${String(bad)} on a sample seller is not real`);
  }
  assert.equal(orderIsTest({ sellerAccountId: undefined as unknown as string }), false);
});

test('AMP-162: the Orders label reads the flag stored on the order when no override is given, in both directions', async () => {
  const { w, a, rt, source: base } = await setup();
  await seedSampleOrder(w, a.workspaceId, 'ord-a', 'acct-biz-second');
  const flagged = await w.orders.createPending({
    id: 'ord-t', workspaceId: a.workspaceId, businessId: 'biz-second', storeSlug: 'slug-biz-second', listingId: 'lst-t', listingVersion: 1, productId: 'prod-t', productVersion: 1,
    title: 'T', amountMinor: 1400, currency: 'AUD', sellerAccountId: 'acct-biz-second', buyerEmail: 'seed-buyer@example.test', idempotencyKey: 'key-t', createdAt: '2026-11-14T09:00:00Z', test: true,
  });
  assert.equal(flagged.order.test, true);
  const withRt: OrdersRuntime = { ...rt, orderDemo: { orders: base.deps.orders, fulfilment: base.deps.fulfilment, now: base.deps.now, workspaceId: a.workspaceId, actorId: OWNER } };
  const src = ordersSource(withRt);
  assert.ok(src);
  const list = availablePage(await loadOrders(withRt, src, 'biz-second', { filter: 'all', cursor: null }));
  assert.deepEqual(list.testIds, ['ord-t'], 'only the stored test order is labelled');
  // Records that carry NO flag: a store that returns them without the field.
  const stripped = (id: string, seller: string) => ({ get: async (ws: string, oid: string) => { const o = await base.deps.orders.get(ws, oid); return o && o.id === id ? ({ ...o, sellerAccountId: seller, test: undefined } as typeof o) : o; } });
  const realNoFlag = { ...src, deps: { ...src.deps, orders: stripped('ord-a', 'acct_real') as unknown as typeof src.deps.orders } };
  assert.deepEqual(availablePage(await loadOrders(withRt, realNoFlag, 'biz-second', { filter: 'all', cursor: null })).testIds.filter((id) => id === 'ord-a'), [], 'real paid order without the field: not test');
  const sampleNoFlag = { ...src, deps: { ...src.deps, orders: stripped('ord-a', `${SAMPLE_SELLER_PREFIX}biz-second`) as unknown as typeof src.deps.orders } };
  assert.ok(availablePage(await loadOrders(withRt, sampleNoFlag, 'biz-second', { filter: 'all', cursor: null })).testIds.includes('ord-a'), 'sample order without the field: not shown as real');
  const detail = await loadOrder(withRt, src, 'biz-second', 'ord-t');
  assert.ok(detail.found);
  assert.equal(detail.test, true);
});

test('AMP-152: a sample order of a second business never appears in the first business\'s label list', async () => {
  const { w, a, rt, source: base } = await setup();
  await seedSampleOrder(w, a.workspaceId, 'ord-sample', `${SAMPLE_SELLER_PREFIX}biz-second`); // business biz-second
  const mine = await w.buy('a');
  const source: OrdersSource = { ...base, isTest: (id) => id === 'ord-sample' };
  const first = availablePage(await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null }));
  assert.deepEqual(first.page.orders.map((o) => o.id), [mine.orderId]);
  assert.deepEqual(first.testIds, [], 'the other business\'s sample order is neither listed nor labelled here');
  assert.equal(buildList(a.businessId, first.page, first.cursor, first.testIds).testNote, null);
  const second = availablePage(await loadOrders(rt, source, 'biz-second', { filter: 'all', cursor: null }));
  assert.deepEqual(second.testIds, ['ord-sample']);
});

test('AMP-152: paging with a test order keeps the label on the page the test order is on, and only there', async () => {
  const { w, a, rt, source: base } = await setup();
  const flagged = new Set<string>();
  const source: OrdersSource = { ...base, isTest: (id) => flagged.has(id) };
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await w.buy('a')).orderId);
  const { listOwnerOrders } = await import('../lib/aimp/owner-orders/index.ts');
  const scope = { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER };
  const one = await listOwnerOrders(source.deps, scope, { limit: 2 });
  assert.ok(one.nextCursor);
  const two = await listOwnerOrders(source.deps, scope, { limit: 2, cursor: one.nextCursor });
  const onSecondPage = two.orders[0].id;
  flagged.add(onSecondPage);
  // Page 1 holds no test order: no label there. Page 2 holds it: labelled there.
  const page2 = availablePage(await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: one.nextCursor }));
  assert.deepEqual(page2.testIds, [onSecondPage]);
  assert.equal(buildList(a.businessId, page2.page, page2.cursor, page2.testIds).rows.filter((r) => r.test).length, 1);
  const vm1 = buildList(a.businessId, one, null, one.orders.map((o) => o.id).filter((id) => flagged.has(id)));
  assert.equal(vm1.testNote, null);
  assert.ok(vm1.rows.every((r) => !r.test));
});

test('AMP-138: the views draw the label as text, the empty state is plain and true, and the pages pass the server flag', () => {
  const list = readFileSync(new URL('../app/app/[business]/orders/orders-view.tsx', import.meta.url), 'utf8');
  assert.match(list, /r\.test \?[^\n]*\{TEST_ORDER_LABEL\}/);
  const detail = readFileSync(new URL('../app/app/[business]/orders/[orderId]/order-detail-view.tsx', import.meta.url), 'utf8');
  assert.match(detail, /vm\.test \?[^\n]*title=\{TEST_ORDER_LABEL\}/);
  assert.match(readFileSync(new URL('../app/app/[business]/orders/page.tsx', import.meta.url), 'utf8'), /found\.testIds/);
  assert.match(readFileSync(new URL('../app/app/[business]/orders/[orderId]/page.tsx', import.meta.url), 'utf8'), /found\.test\)/);
  const empty = emptyCopy('all', 0);
  assert.equal(empty.title, 'No orders yet');
  assert.match(empty.text, /test purchase from your store page/);
  assert.doesNotMatch(JSON.stringify(empty), /cannot exist|no order store/i);
});

test('AMP-102: the timeline names the actor the event records: automatic steps, the person looking, another person, or not recorded', async () => {
  const { w, a, rt, source, guard } = await setup();
  const paid = await w.buy('a');
  const g = await guard(a.businessId, paid.orderId, 'reissue', 'k-actor');
  assert.ok(g.ok);
  const sent = await reissueAccess(g.source.deps, g.scope, g.orderId, g.requestKey);
  assert.ok(sent.ok);
  const d = await loadOrder(rt, source, a.businessId, paid.orderId);
  assert.ok(d.found);
  const reissued = d.order.timeline.find((t) => t.kind === 'link_reissued');
  assert.equal(reissued?.actor, OWNER, 'the service records the id of the person who acted');
  const actorOf = (vm: ReturnType<typeof buildDetail>, kind: string) => vm.timeline.find((t) => t.kind === kind)?.actor;

  const mine = buildDetail(a.businessId, d.order, OWNER);
  assert.equal(actorOf(mine, 'link_reissued'), ACTOR_YOU, 'the person looking did it');
  assert.equal(actorOf(mine, 'paid'), ACTOR_AUTOMATIC);
  assert.equal(actorOf(mine, 'delivery_email_sent'), ACTOR_AUTOMATIC);

  const someoneElse = buildDetail(a.businessId, d.order, 'another-person');
  assert.equal(actorOf(someoneElse, 'link_reissued'), ACTOR_PERSON, 'a different person is never called "You"');
  const unknownViewer = buildDetail(a.businessId, d.order);
  assert.equal(actorOf(unknownViewer, 'link_reissued'), ACTOR_PERSON, 'with no viewer known, nobody is called "You"');
  assert.ok(!unknownViewer.timeline.some((t) => t.actor === ACTOR_YOU));
  assert.doesNotMatch(JSON.stringify([mine.timeline, someoneElse.timeline]), new RegExp(OWNER), 'the raw user id is never shown');

  assert.equal(actorLabel('system'), ACTOR_AUTOMATIC);
  assert.equal(actorLabel('system:refund-event', 'system:refund-event'), ACTOR_AUTOMATIC, 'a system actor is never "You"');
  for (const none of ['', '   ', undefined, null, 5]) assert.equal(actorLabel(none, OWNER), ACTOR_UNKNOWN, String(none));
  assert.equal(actorLabel(OWNER, ''), ACTOR_PERSON);
  // The page passes the server-side actor of the orders source, never anything from the request.
  const page = readFileSync(new URL('../app/app/[business]/orders/[orderId]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /buildDetail\(business, found\.order, viewerId(, found\.test)?\)/);
  assert.match(page, /viewerId = source\?\.actorId \?\? null/);
});

test('AMP-102: the action list has the same list reset as the other lists on the page', () => {
  const css = readFileSync(new URL('../app/app/[business]/orders/orders.css', import.meta.url), 'utf8');
  for (const cls of ['apo-filters', 'apo-list', 'apo-timeline', 'apo-actions']) {
    const rule = css.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`))?.[1] ?? '';
    assert.match(rule, /list-style: none; padding: 0; margin: 0;/, cls);
  }
});

test('an order opens only inside its own business: another business, another workspace, an unknown or a bad id all read as not found', async () => {
  const { w, a, b, rt, source } = await setup();
  const mine = await w.buy('a');
  const theirs = await w.buy('b');
  await seedOrder(w.orders, { id: 'ord-second', workspaceId: a.workspaceId, businessId: 'biz-second', createdAt: '2026-11-14T09:00:00Z', paid: true });

  const own = await loadOrder(rt, source, a.businessId, mine.orderId);
  assert.ok(own.found);
  assert.equal(own.order.id, mine.orderId);
  assert.equal(own.order.businessId, a.businessId);
  // both directions
  assert.deepEqual(await loadOrder(rt, source, a.businessId, theirs.orderId), { found: false }, 'store b order under business a (other workspace)');
  assert.deepEqual(await loadOrder(rt, source, a.businessId, 'ord-second'), { found: false }, 'same workspace, other business');
  const second = await loadOrder(rt, source, 'biz-second', 'ord-second');
  assert.ok(second.found, 'and the other business can open its own order');
  assert.deepEqual(await loadOrder(rt, source, 'biz-second', mine.orderId), { found: false });
  const sourceB: OrdersSource = { ...source, workspaceId: b.workspaceId };
  assert.ok((await loadOrder(rt, sourceB, b.businessId, theirs.orderId)).found);
  assert.deepEqual(await loadOrder(rt, sourceB, b.businessId, mine.orderId), { found: false });
  for (const id of ['nope', '', '../x', 'a b', 'x'.repeat(300)]) assert.deepEqual(await loadOrder(rt, source, a.businessId, id), { found: false }, id);
  assert.deepEqual(await loadOrder(rt, source, 'not-a-known-business', mine.orderId), { found: false });
});

// ---- view model ----
test('rows show a buyer-safe summary: title, amount in the money format, payment and delivery state, date, a masked buyer', async () => {
  const { w, a, rt, source } = await setup();
  w.email.failNext(1);
  const failed = await w.buy('a');
  const r = await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null });
  assert.ok(r.found && r.available);
  const row = buildRow(a.businessId, r.page.orders[0]);
  assert.equal(row.id, failed.orderId);
  assert.match(row.amount, /^A\$\d+(\.\d{2})?$/);
  assert.equal(row.payment.label, 'Paid');
  assert.equal(row.delivery.label, 'Delivery failed');
  assert.equal(row.delivery.tone, 'danger');
  assert.match(row.buyer, /^b\*\*\*@/);
  assert.match(row.created, /^2026-11-14 \d\d:\d\d UTC$/);
  assert.equal(row.href, `/app/${a.businessId}/orders/${failed.orderId}`);
  assert.doesNotMatch(JSON.stringify(row), /buyer-a@example\.test/);
});

test('the list view model has the filter tabs with counts, a summary, paging links and a clear empty state', async () => {
  const { w, a, rt, source } = await setup();
  const none = await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null });
  assert.ok(none.found && none.available);
  const empty = buildList(a.businessId, none.page);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.empty?.title, 'No orders yet');
  assert.equal(empty.summary, 'No orders to show');
  assert.deepEqual(empty.tabs.map((t) => [t.filter, t.count, t.current]), [['all', 0, true], ['needs_attention', 0, false], ['delivered', 0, false], ['refunded', 0, false]]);

  for (let i = 0; i < 3; i++) await w.buy('a');
  const some = await loadOrders(rt, source, a.businessId, { filter: 'all', cursor: null });
  assert.ok(some.found && some.available);
  const vm = buildList(a.businessId, some.page);
  assert.equal(vm.rows.length, 3);
  assert.equal(vm.empty, null);
  assert.equal(vm.summary, 'Showing 3 of 3 orders');
  assert.equal(vm.nextHref, null);
  assert.equal(vm.firstPageHref, null);
  assert.equal(vm.tabs.find((t) => t.filter === 'delivered')?.href, `/app/${a.businessId}/orders?filter=delivered`);

  const filtered = await loadOrders(rt, source, a.businessId, { filter: 'refunded', cursor: null });
  assert.ok(filtered.found && filtered.available);
  const fvm = buildList(a.businessId, filtered.page);
  assert.equal(fvm.empty?.title, 'No refunded orders', 'a filter with nothing in it says so, and it is not the "no orders yet" copy');
  assert.equal(fvm.tabs.find((t) => t.current)?.filter, 'refunded');
});

test('paging: a page cut gives a link to older orders that carries the filter and an opaque cursor', async () => {
  const { w, a } = await setup();
  for (let i = 0; i < 3; i++) await w.buy('a');
  const { listOwnerOrders } = await import('../lib/aimp/owner-orders/index.ts');
  const page = await listOwnerOrders(ownerOrdersDeps(w), { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER }, { limit: 2 });
  const vm = buildList(a.businessId, page);
  assert.equal(vm.summary, 'Showing 2 of 3 orders');
  assert.ok(vm.nextHref?.startsWith(`/app/${a.businessId}/orders?cursor=`));
  const cursor = new URL(vm.nextHref!, 'http://x').searchParams.get('cursor');
  assert.equal(parseCursor(cursor ?? undefined), cursor);
  const next = await listOwnerOrders(ownerOrdersDeps(w), { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER }, { limit: 2, cursor });
  const nvm = buildList(a.businessId, next, cursor);
  assert.equal(nvm.rows.length, 1);
  assert.equal(nvm.nextHref, null);
  assert.equal(nvm.firstPageHref, `/app/${a.businessId}/orders`);
  assert.deepEqual(new Set([...vm.rows, ...nvm.rows].map((r) => r.id)).size, 3);
});

test('query parsing is safe and links are built from ids, never from free text', () => {
  assert.equal(parseFilter('delivered'), 'delivered');
  assert.equal(parseFilter(['refunded', 'x']), 'refunded');
  for (const bad of [undefined, '', 'nope', '__proto__', ['bad']]) assert.equal(parseFilter(bad as string | string[] | undefined), 'all');
  assert.equal(parseCursor(undefined), null);
  assert.equal(parseCursor(''), null);
  assert.equal(parseCursor('x'.repeat(400)), null);
  assert.equal(ordersHref('biz-a'), '/app/biz-a/orders');
  assert.equal(ordersHref('biz-a', 'needs_attention'), '/app/biz-a/orders?filter=needs_attention');
  assert.equal(orderHref('biz-a', 'ord 1/../x'), '/app/biz-a/orders/ord%201%2F..%2Fx');
  assert.equal(emptyCopy('all', 0).title, 'No orders yet');
  assert.equal(emptyCopy('needs_attention', 4).title, 'Nothing needs your attention');
  assert.match(newRequestKey(() => 'a1b2-c3d4 ;$$'), /^own-[A-Za-z0-9._:-]+$/);
  assert.ok(isRequestKey(newRequestKey(() => crypto.randomUUID())));
});

test('the detail view model: delivered order allows a new link but not a resend; a failed delivery allows both; no tokens, links or full emails', async () => {
  const { w, a, rt, source } = await setup();
  const delivered = await w.buy('a');
  w.email.failNext(1);
  const failed = await w.buy('a');

  const d1 = await loadOrder(rt, source, a.businessId, delivered.orderId);
  assert.ok(d1.found);
  const vm1 = buildDetail(a.businessId, d1.order);
  assert.equal(vm1.delivery.label, 'Delivered');
  assert.equal(vm1.payment.label, 'Paid');
  assert.deepEqual(vm1.actions.map((x) => [x.kind, x.allowed]), [['resend', false], ['reissue', true]]);
  assert.match(vm1.actions[0].reason, /already sent/);
  assert.equal(vm1.access.stateLabel, 'A download link works');
  assert.equal(vm1.access.grants.length, 1);
  assert.equal(vm1.backHref, `/app/${a.businessId}/orders`);
  assert.ok(vm1.timeline.some((t) => t.label === 'Payment confirmed'));
  assert.equal(vm1.refund.stateLabel, 'No refund');
  assert.equal(vm1.refund.note, REFUND_NOTE);
  assert.equal(vm1.lineItems.length, 1);
  const text = JSON.stringify(vm1);
  assert.doesNotMatch(text, /buyer-a@example\.test/);
  assert.doesNotMatch(text, /\/api\/aimp\/fulfilment\/download|token|signature/i);

  const d2 = await loadOrder(rt, source, a.businessId, failed.orderId);
  assert.ok(d2.found);
  const vm2 = buildDetail(a.businessId, d2.order);
  assert.equal(vm2.delivery.label, 'Delivery failed');
  assert.deepEqual(vm2.actions.map((x) => x.allowed), [true, true]);
  assert.ok(vm2.deliveryError, 'the last problem is shown in plain words');
  assert.doesNotMatch(vm2.deliveryError ?? '', /Error:|at .*\.ts/);
  assert.equal(vm2.access.stateLabel, vm2.access.grants.length ? 'A download link works' : 'No link sent yet', 'the access card follows the service\'s grants');
  assert.ok(vm2.attention, 'the failed delivery is flagged in plain words');
});

test('a refunded order shows the refund state only, withdraws the actions, and says no refund is issued here', async () => {
  const { w, a, rt, source } = await setup();
  const paid = await w.buy('a');
  const order = (await w.orders.get(a.workspaceId, paid.orderId))!;
  await w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: 'evt_page_refund', type: 'charge.refunded', order }, w.now()));
  const d = await loadOrder(rt, source, a.businessId, paid.orderId);
  assert.ok(d.found);
  const vm = buildDetail(a.businessId, d.order);
  assert.equal(vm.payment.label, 'Refunded');
  assert.equal(vm.refund.stateLabel, 'Refunded');
  assert.ok(vm.refund.events.length >= 1);
  assert.deepEqual(vm.actions.map((x) => x.allowed), [false, false]);
  assert.match(vm.refund.note, /No refunds are issued from here/);
  assert.ok(!vm.actions.some((x) => /refund/i.test(x.label)), 'there is no refund button');
});

// ---- the action guard ----
test('guard: demo storage off, bad ids, unknown business and no source refuse before anything is read or run', async () => {
  const { w, a, guard } = await setup();
  const paid = await w.buy('a');
  const run = async (...args: Parameters<typeof guard>) => { const g = await guard(...args); return g.ok ? 'ok' : g.message; };
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', 'k1', { availability: OFF }), OFF.reason);
  assert.equal(await run('bad id!', paid.orderId, 'reissue', 'k1'), NO_BUSINESS);
  assert.equal(await run(undefined, paid.orderId, 'reissue', 'k1'), NO_BUSINESS);
  assert.equal(await run('biz-unknown', paid.orderId, 'reissue', 'k1'), NO_BUSINESS);
  for (const id of ['', '../x', 'a b', 5, null, 'x'.repeat(161)]) assert.equal(await run(a.businessId, id, 'reissue', 'k1'), NO_ORDER, String(id));
  // AMP-102: prototype keys are well-formed ids, so they reach the service; they must read as an unknown order, for both actions.
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    for (const kind of ['resend', 'reissue']) assert.deepEqual(await guard(a.businessId, id, kind, `k-${kind}`), { ok: false, message: NO_ORDER }, `${id} ${kind}`);
  }
  assert.equal(w.email.outbox().length, 1, 'only the delivery email of the real purchase was sent');
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', 'k1', { source: null }), NO_ORDERS_YET);
  assert.equal(await run(a.businessId, paid.orderId, 'refund', 'k1'), BAD_REQUEST, 'there is no refund action');
  assert.equal(await run(a.businessId, paid.orderId, undefined, 'k1'), BAD_REQUEST);
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', ''), BAD_REQUEST);
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', 'x'.repeat(81)), BAD_REQUEST);
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', 'a b'), BAD_REQUEST);
  assert.equal(await run(a.businessId, paid.orderId, 'reissue', 'k1'), 'ok');
  assert.ok(isOrderId('ord_1') && !isOrderId('..') && isOrderActionKind('resend') && !isOrderActionKind('refund'));
});

test('guard: an order of another business or workspace, or an unknown id, is "not found" in both directions and causes no side effect', async () => {
  const { w, a, b, source, guard } = await setup();
  const mine = await w.buy('a');
  const theirs = await w.buy('b');
  await seedOrder(w.orders, { id: 'ord-second', workspaceId: a.workspaceId, businessId: 'biz-second', createdAt: '2026-11-14T09:00:00Z', paid: true });
  const outbox = w.email.outbox().length;
  const audit = (await w.fulfilment.audit({ workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER })).length;

  for (const [biz, id] of [[a.businessId, theirs.orderId], [a.businessId, 'ord-second'], [a.businessId, 'missing-order'], ['biz-second', mine.orderId]] as const) {
    for (const kind of ['resend', 'reissue']) {
      const g = await guard(biz, id, kind, `k-${kind}`);
      assert.deepEqual(g, { ok: false, message: NO_ORDER }, `${biz} ${id} ${kind}`);
    }
  }
  assert.equal(w.email.outbox().length, outbox, 'no email was sent');
  assert.equal((await w.fulfilment.audit({ workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER })).length, audit, 'no audit row was written');

  const own = await guard(a.businessId, mine.orderId, 'reissue', 'k-own');
  assert.ok(own.ok);
  assert.deepEqual(own.scope, { workspaceId: a.workspaceId, businessId: a.businessId, actorId: OWNER }, 'workspace and actor come from the server source');
  const sourceB: OrdersSource = { ...source, workspaceId: b.workspaceId };
  const g2 = await guard(b.businessId, theirs.orderId, 'reissue', 'k-b', { source: sourceB });
  assert.ok(g2.ok);
  assert.deepEqual(await guard(b.businessId, mine.orderId, 'reissue', 'k-b2', { source: sourceB }), { ok: false, message: NO_ORDER });
});

test('guard: it refuses an action the service says is not allowed, with the service\'s own reason', async () => {
  const { w, a, guard } = await setup();
  const delivered = await w.buy('a');
  const g = await guard(a.businessId, delivered.orderId, 'resend', 'k1');
  assert.equal(g.ok, false);
  assert.match(!g.ok ? g.message : '', /already sent/);
  const unpaid = await w.startOrder('a');
  const u = await guard(a.businessId, unpaid.orderId, 'reissue', 'k2');
  assert.equal(u.ok, false);
  assert.match(!u.ok ? u.message : '', /not completed|nothing to send/);
});

test('an allowed request runs the real service exactly as the action does: resend delivers once, a repeat of the key sends nothing more', async () => {
  const { w, a, guard } = await setup();
  w.email.failNext(1);
  const failed = await w.buy('a');
  assert.equal(w.email.outbox().length, 0);
  const g = await guard(a.businessId, failed.orderId, 'resend', 'k-resend');
  assert.ok(g.ok);
  const run = () => resendDelivery(g.source.deps, g.scope, g.orderId, g.requestKey);
  const r1 = await run();
  assert.deepEqual([r1.ok, r1.ok && r1.outcome], [true, 'sent']);
  const r2 = await run();
  assert.deepEqual([r2.ok, r2.ok && r2.outcome], [true, 'duplicate']);
  assert.equal(w.email.outbox().length, 1);
});

test('an allowed reissue runs the real service: one new link is emailed and the earlier one stops working', async () => {
  const { w, a, guard, rt, source } = await setup();
  const paid = await w.buy('a');
  const g = await guard(a.businessId, paid.orderId, 'reissue', 'k-reissue');
  assert.ok(g.ok);
  const r = await reissueAccess(g.source.deps, g.scope, g.orderId, g.requestKey);
  assert.equal(r.ok && r.outcome, 'sent');
  assert.equal(r.ok && r.revokedLinks, 1);
  const d = await loadOrder(rt, source, a.businessId, paid.orderId);
  assert.ok(d.found);
  assert.equal(d.order.access.activeCount, 1);
  assert.equal(d.order.access.reissues, 1);
});

// ---- wiring in the owner workspace ----
test('Orders is parked (not in the bar) but its pages, action and styles are kept for later; an unbuilt page is never a link', () => {
  assert.ok(!workspaceNavItems.some((i) => i.label === 'Orders'));
  // Website and Payments became links with AMP-087 and AMP-088 (checked in aimp-app-workspace-nav.test.ts).
  assert.equal(workspaceNavHref('biz-a', { label: 'Later', segment: 'later', ready: false }), null);
  for (const f of ['page.tsx', 'orders-view.tsx', 'actions.ts', 'orders.css', '[orderId]/page.tsx', '[orderId]/order-detail-view.tsx']) {
    assert.ok(existsSync(new URL(`../app/app/[business]/orders/${f}`, import.meta.url)), f);
  }
});

test('the pages carry the DEMO label and honest copy: no earnings language, no invented numbers', () => {
  assert.match(DEMO_NOTE, /lost when the server restarts/);
  const files = ['orders-view.tsx', '[orderId]/order-detail-view.tsx', 'view-model.ts'].map((f) => readFileSync(new URL(`../app/app/[business]/orders/${f}`, import.meta.url), 'utf8'));
  for (const src of files) assert.doesNotMatch(src, /guarantee|earn \$|make money|passive income/i);
  assert.match(files[0], />DEMO</);
  assert.match(files[1], />DEMO</);
  assert.match(files[1], /orderAction/);
  assert.doesNotMatch(files[1], /issueRefund|createRefund/);
});

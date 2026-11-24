// AMP-103: order store and fulfilment on the /start runtime, so the Orders pages have real orders to show.
// app/start/_server/runtime.ts is not loadable in node (extensionless imports), so this builds the SAME services the way runtime.ts does
// (product service on a shared product store, catalogue, brands, assets) and wires them with `createStartOrders` from orders-runtime.ts,
// the file runtime.ts calls. Then the sample orders go through the real checkout and paid-event path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadOrder, loadOrders, ordersSource } from '../app/app/[business]/orders/_server/orders.ts';
import type { OrdersRuntime } from '../app/app/[business]/orders/_server/orders.ts';
import { NO_ORDER, guardOrderAction } from '../app/app/[business]/orders/_server/order-guard.ts';
import { buildDetail, buildList } from '../app/app/[business]/orders/view-model.ts';
import { DOWNLOAD_PATH, MAX_SAMPLE_ORDERS, SAMPLE_SELLER_PREFIX, createSampleOrders, createStartOrders, runTestPurchase } from '../app/start/_server/orders-runtime.ts';
import type { SampleSource, StartOrders } from '../app/start/_server/orders-runtime.ts';
import { orderFacts, shopFacts } from '../app/start/_server/inbox-runtime.ts';
import type { InboxRuntime } from '../app/start/_server/inbox-runtime.ts';
import { createInbox } from '../lib/aimp/storeops/inbox.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec } from '../lib/aimp/factory/generate.ts';
import { reissueAccess, resendDelivery } from '../lib/aimp/owner-orders/index.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const ON = { available: true, reason: '' };
const START = Date.parse('2026-11-14T10:00:00Z');

/** What runtime.ts builds, with the same workspace, owner and contexts. */
async function setup() {
  const llm = createProviderRegistry({ env: {} }).llm;
  const productStore = createMemoryProductStore();
  const products = createProductService({
    store: productStore, now: () => new Date(START),
    generateSpec: async () => { throw new Error('not used'); },
  });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products, brands, assets, now: () => new Date(START) });
  const slugs = new Map<string, string>();
  const orderDemo = createStartOrders({ workspaceId: WORKSPACE, actorId: OWNER, productStore, catalogue, now: () => new Date(START) });
  const blueprint = blueprintRegistry.find('printable-planner');
  assert.ok(blueprint);

  /** A /start business with an approved product and an approved listing (what the guided steps leave behind). */
  const business = async (businessId: string, niche: string) => {
    const spec = await generateProductSpec({ blueprint, provider: llm, inputs: { niche, audience: 'Busy people', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } });
    const pctx = { workspaceId: WORKSPACE, actorId: OWNER };
    const { product, version } = await products.createProduct(pctx, { businessId, spec });
    await products.approve(pctx, version.id);
    for (const role of ['cover', 'preview', 'master'] as const) assets.add({ id: `${product.id}-${role}`, workspaceId: WORKSPACE, businessId, productId: product.id, role });
    const bd = { store: brands, now: () => new Date(START) };
    const made = await createBrandDraft(bd, { workspaceId: WORKSPACE }, businessId, { niche, audience: 'Busy people', productTitle: spec.title, productType: 'printable planner', formats: ['PDF'] });
    assert.ok(made.ok);
    assert.ok((await approveBrand(bd, { workspaceId: WORKSPACE }, businessId, OWNER)).ok);
    const octx = { workspaceId: WORKSPACE, actorUserId: OWNER, idempotencyKey: `t:${businessId}` };
    const draft = await catalogue.createDraft(octx, { businessId, productId: product.id });
    await catalogue.approveListing(octx, draft.listingId);
    return { businessId, productId: product.id };
  };

  const src: SampleSource = { catalogue, products, slugs };
  const businesses = new Set<string>();
  const rt: OrdersRuntime & { orderDemo: StartOrders; businesses: Set<string> } = { businesses, seeds: new Map(), slugs, productIds: new Map(), orderDemo };
  const guard = (businessId: unknown, orderId: unknown, kind: unknown, key: unknown) =>
    guardOrderAction({ availability: ON, rt: () => rt, source: () => ordersSource(rt) }, businessId, orderId, kind, key);
  return { orderDemo, src, rt, business, guard, catalogue };
}

test('the runtime has an order store and fulfilment service, and the source is the runtime\'s own workspace and owner', async () => {
  const { rt, orderDemo } = await setup();
  const s = ordersSource(rt);
  assert.ok(s);
  assert.equal(s.workspaceId, WORKSPACE);
  assert.equal(s.actorId, OWNER);
  assert.equal(s.deps.orders, orderDemo.orders);
  assert.equal(s.deps.fulfilment, orderDemo.fulfilment);
  assert.deepEqual(Object.keys(s).sort(), ['actorId', 'deps', 'workspaceId']);
  assert.equal(ordersSource({ businesses: new Set(), seeds: new Map(), slugs: new Map(), productIds: new Map() }), null, 'a runtime without the stores still reads as no source');
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /orderDemo: createStartOrders\(/);
});

test('a business with no approved listing gets no sample orders and nothing is registered', async () => {
  const { rt, orderDemo, src } = await setup();
  rt.businesses.add('biz-empty');
  const r = await createSampleOrders(orderDemo, src, 'biz-empty');
  assert.equal(r.ok, false);
  assert.equal(orderDemo.sellers.get(WORKSPACE, 'biz-empty'), null, 'no seller was registered');
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, 0);
  assert.deepEqual(await createSampleOrders(orderDemo, src, 'bad id!'), { ok: false, message: 'Unknown business.' });
});

test('sample orders go through the real checkout and paid path, are labelled, and show on the Orders pages with a delivery email each', async () => {
  const { rt, orderDemo, src, business } = await setup();
  await business('biz-a', 'Wedding planning');
  rt.businesses.add('biz-a');
  const r = await createSampleOrders(orderDemo, src, 'biz-a');
  assert.ok(r.ok);
  assert.equal(r.orderIds.length, MAX_SAMPLE_ORDERS);

  // the fixture seller is labelled sample/demo
  const seller = orderDemo.sellers.get(WORKSPACE, 'biz-a');
  assert.ok(seller);
  assert.ok(seller.stripeAccountId.startsWith(SAMPLE_SELLER_PREFIX));
  assert.match(seller.stripeAccountId, /sample_demo/);

  // the orders are real, paid by a recorded provider event, and delivered by the fixture email
  for (const id of r.orderIds) {
    const o = await orderDemo.orders.get(WORKSPACE, id);
    assert.equal(o?.status, 'paid');
    assert.match(o?.buyerEmail ?? '', /^sample-buyer-\d@example\.test$/);
    assert.equal(o?.sellerAccountId, seller.stripeAccountId);
  }
  assert.equal(orderDemo.email.outbox().length, MAX_SAMPLE_ORDERS);

  const list = await loadOrders(rt, ordersSource(rt), 'biz-a', { filter: 'all', cursor: null });
  assert.ok(list.found && list.available);
  assert.deepEqual(list.page.orders.map((o) => o.id).sort(), [...r.orderIds].sort());
  assert.equal(list.page.counts.delivered, MAX_SAMPLE_ORDERS);
  const vm = buildList('biz-a', list.page);
  assert.equal(vm.rows.length, MAX_SAMPLE_ORDERS);
  assert.doesNotMatch(JSON.stringify(list.page), /sample-buyer-1@example\.test/, 'only the masked buyer is read');

  const d = await loadOrder(rt, ordersSource(rt), 'biz-a', r.orderIds[0]);
  assert.ok(d.found);
  assert.equal(buildDetail('biz-a', d.order, OWNER).delivery.label, 'Delivered');
});

test('calling it again adds nothing (same ids), and a concurrent call shares the first', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-a', 'Wedding planning');
  const [x, y] = await Promise.all([createSampleOrders(orderDemo, src, 'biz-a'), createSampleOrders(orderDemo, src, 'biz-a')]);
  assert.ok(x.ok && y.ok);
  assert.deepEqual(x.orderIds, y.orderIds);
  const again = await createSampleOrders(orderDemo, src, 'biz-a');
  assert.ok(again.ok);
  assert.equal(again.created, 0);
  assert.deepEqual(again.orderIds, x.orderIds);
  assert.equal((await orderDemo.orders.list(WORKSPACE)).length, MAX_SAMPLE_ORDERS);
  assert.equal(orderDemo.email.outbox().length, MAX_SAMPLE_ORDERS);
});

test('resend and reissue work on a sample order through the page guard and the real service', async () => {
  const { rt, orderDemo, src, business, guard } = await setup();
  await business('biz-a', 'Wedding planning');
  rt.businesses.add('biz-a');
  const r = await createSampleOrders(orderDemo, src, 'biz-a', 1);
  assert.ok(r.ok);
  const [id] = r.orderIds;
  const before = orderDemo.email.outbox().length;

  const g = await guard('biz-a', id, 'reissue', 'k-reissue');
  assert.ok(g.ok);
  const sent = await reissueAccess(g.source.deps, g.scope, g.orderId, g.requestKey);
  assert.equal(sent.ok && sent.outcome, 'sent');
  assert.equal(sent.ok && sent.revokedLinks, 1);
  assert.equal(orderDemo.email.outbox().length, before + 1, 'one new email carries the new link');
  const d = await loadOrder(rt, ordersSource(rt), 'biz-a', id);
  assert.ok(d.found);
  assert.equal(d.order.access.reissues, 1);

  // resend is refused with the service's own reason when the email already went out
  const refused = await guard('biz-a', id, 'resend', 'k-resend');
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.message : '', /already sent/);
  assert.ok(typeof resendDelivery === 'function', 'resend of a failed delivery runs on the same service (covered in aimp-app-orders.test.ts)');
});

test('two businesses never see each other\'s orders, in the list, the detail, or the actions', async () => {
  const { rt, orderDemo, src, business, guard } = await setup();
  await business('biz-a', 'Wedding planning');
  await business('biz-b', 'Home strength training');
  rt.businesses.add('biz-a');
  rt.businesses.add('biz-b');
  const a = await createSampleOrders(orderDemo, src, 'biz-a', 2);
  const b = await createSampleOrders(orderDemo, src, 'biz-b', 1);
  assert.ok(a.ok && b.ok);
  assert.equal(a.orderIds.length, 2);
  assert.equal(b.orderIds.length, 1);
  const source = ordersSource(rt);

  const la = await loadOrders(rt, source, 'biz-a', { filter: 'all', cursor: null });
  const lb = await loadOrders(rt, source, 'biz-b', { filter: 'all', cursor: null });
  assert.ok(la.found && la.available && lb.found && lb.available);
  assert.deepEqual(la.page.orders.map((o) => o.id).sort(), [...a.orderIds].sort());
  assert.deepEqual(lb.page.orders.map((o) => o.id), b.orderIds);
  for (const id of b.orderIds) assert.ok(!la.page.orders.some((o) => o.id === id), 'A does not see B');
  for (const id of a.orderIds) assert.ok(!lb.page.orders.some((o) => o.id === id), 'B does not see A');

  assert.deepEqual(await loadOrder(rt, source, 'biz-a', b.orderIds[0]), { found: false });
  assert.deepEqual(await loadOrder(rt, source, 'biz-b', a.orderIds[0]), { found: false });
  const outbox = orderDemo.email.outbox().length;
  assert.deepEqual(await guard('biz-a', b.orderIds[0], 'reissue', 'k-x'), { ok: false, message: NO_ORDER });
  assert.equal(orderDemo.email.outbox().length, outbox, 'no email went out for the crossed request');
  // each business has its own sample seller
  assert.notEqual(orderDemo.sellers.get(WORKSPACE, 'biz-a')?.stripeAccountId, orderDemo.sellers.get(WORKSPACE, 'biz-b')?.stripeAccountId);
});

test('test purchase: pays through the real path, delivers the approved file once, and a replayed payment gives no second delivery', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-t', 'Wedding planning');
  const r = await runTestPurchase(orderDemo, src, 'biz-t', ' Owner@Example.com ');
  assert.ok(r.ok, JSON.stringify(r));
  const x = r.summary;
  assert.equal(x.buyerEmail, 'owner@example.com');
  assert.equal(x.orderStatus, 'paid');
  assert.equal(x.priceMinor, 1400);
  assert.match(x.productTitle, /Wedding Planning/i);
  assert.deepEqual(x.deliveries, { grants: 1, emails: 1 });
  assert.equal(x.replay.secondDelivery, false);
  assert.equal(x.replay.grants, 1);
  assert.equal(x.replay.emails, 1);
  assert.notEqual(x.replay.outcome, 'paid');
  // the order is paid exactly once in the store, and the fixture seller is labelled sample/demo
  assert.equal((await orderDemo.orders.get(WORKSPACE, x.orderId))?.status, 'paid');
  assert.match(orderDemo.sellers.get(WORKSPACE, 'biz-t')?.stripeAccountId ?? '', /sample_demo/);
});

test('test purchase: the emailed link downloads the approved file, and it is the file the product page offers', async () => {
  const { orderDemo, src, business } = await setup();
  const { productId } = await business('biz-d', 'Teacher planning');
  const r = await runTestPurchase(orderDemo, src, 'biz-d', 'me@example.com');
  assert.ok(r.ok);
  assert.ok(r.summary.downloadPath?.startsWith(`${DOWNLOAD_PATH}/`));
  const token = (r.summary.downloadPath as string).slice(DOWNLOAD_PATH.length + 1);
  const got = await orderDemo.files.redeem(token);
  assert.ok(got.ok);
  const approved = await src.products.getBuyerFile({ workspaceId: WORKSPACE, actorId: OWNER }, productId);
  assert.equal(got.file.fileName, approved.fileName);
  assert.deepEqual(Buffer.from(got.file.bytes), Buffer.from(approved.bytes));
  assert.equal(r.summary.fileName, approved.fileName);
});

test('test purchase: the same email again returns the same order, a different email is a separate order, and bad input is refused', async () => {
  const { orderDemo, src, business } = await setup();
  await business('biz-r', 'Meal planning');
  const a = await runTestPurchase(orderDemo, src, 'biz-r', 'a@example.com');
  const again = await runTestPurchase(orderDemo, src, 'biz-r', 'A@example.com');
  const b = await runTestPurchase(orderDemo, src, 'biz-r', 'b@example.com');
  assert.ok(a.ok && again.ok && b.ok);
  assert.equal(again.summary.orderId, a.summary.orderId);
  assert.notEqual(b.summary.orderId, a.summary.orderId);
  assert.equal(again.summary.deliveries.emails, 1, 'running it twice still sent one delivery email');
  for (const bad of ['', 'not-an-email', 'a@b', 42, null]) assert.equal((await runTestPurchase(orderDemo, src, 'biz-r', bad)).ok, false);
  assert.equal((await runTestPurchase(orderDemo, src, '../nope', 'a@example.com')).ok, false);
});

test('test purchase: a business with no approved listing is refused and nothing is created', async () => {
  const { orderDemo, src } = await setup();
  const r = await runTestPurchase(orderDemo, src, 'biz-empty', 'a@example.com');
  assert.equal(r.ok, false);
  assert.equal(orderDemo.email.outbox().length, 0);
});

test('inbox: a buyer who really bought gets a verified reply from the real order and delivery state; strangers get nothing about orders', async () => {
  const { orderDemo, src, business, catalogue, rt } = await setup();
  await business('biz-i', 'Meal planning');
  const bought = await runTestPurchase(orderDemo, src, 'biz-i', 'buyer@example.com');
  assert.ok(bought.ok);
  const irt = { slugs: rt.slugs, catalogue, orderDemo } as unknown as InboxRuntime;
  const facts = await orderFacts(irt, 'biz-i');
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.payment, 'paid');
  assert.equal(facts[0]!.delivery, 'delivered');
  assert.equal((await orderFacts(irt, 'biz-other')).length, 0);
  const shop = await shopFacts(irt, 'biz-i');
  assert.equal(shop.products.length, 1);
  assert.equal(shop.products[0]!.priceLabel, '$14');

  let n = 0;
  const outboxBefore = orderDemo.email.outbox().length;
  const inbox = createInbox({
    now: () => 1000 + n, newId: () => `t${++n}`, model: null,
    orders: (b) => orderFacts(irt, b), shop: (b) => shopFacts(irt, b),
    send: (m) => orderDemo.email.send({ to: m.to, subject: m.subject, text: m.text, idempotencyKey: m.idempotencyKey }),
  });
  const mine = await inbox.add('biz-i', { fromEmail: 'buyer@example.com', message: 'I cannot find my download' });
  assert.ok(mine.ok);
  if (!mine.ok) return;
  assert.equal(mine.thread.kind, 'order');
  assert.match(mine.thread.body, /emailed to buyer@example.com/);
  const stranger = await inbox.add('biz-i', { fromEmail: 'stranger@example.com', message: 'where is my order' });
  if (!stranger.ok) throw new Error('add');
  assert.doesNotMatch(stranger.thread.body, /Meal/i);
  assert.equal(orderDemo.email.outbox().length, outboxBefore, 'drafting sends nothing');
  const sent = await inbox.decide('biz-i', mine.thread.id, 'approve');
  assert.ok(sent.ok);
  await inbox.decide('biz-i', mine.thread.id, 'approve');
  assert.equal(orderDemo.email.outbox().length, outboxBefore + 1, 'approved once, sent once');
});

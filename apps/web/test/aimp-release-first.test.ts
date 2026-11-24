// FIRST RELEASE TEST (Business Builder architecture): "Two stores. One shared blueprint. Prove that one Stripe test purchase
// delivers the correct file once even when the payment event is replayed. Restart a build and verify it resumes. Verify that
// the stores cannot read each other's files or orders." Runs on fixtures: the payment event is fixture-signed, not from Stripe.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { OperationContext } from '../lib/aimp/contracts.ts';
import { FilesError } from '../lib/aimp/files/types.ts';
import { createFulfilmentWorld, SHARED_BLUEPRINT } from '../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentWorld, WorldStore } from '../lib/aimp/fulfilment/demo.ts';
import { createFulfilOrderJob, FULFIL_ORDER_JOB } from '../lib/aimp/fulfilment/job.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import { createJobRegistry, createJobRunner, createJobService, createMemoryJobStore } from '../lib/aimp/jobs/index.ts';
import type { JobKindDefinition } from '../lib/aimp/jobs/index.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function world(opts: { attach?: boolean } = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock };
}
const tokens = (w: FulfilmentWorld) => w.email.outbox().map((m) => { const t = w.tokenIn(m); assert.ok(t); return t; });

test('release: two stores are built from one shared blueprint and sell different files', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const pa = await w.products.getProduct(a.workspaceId, a.productId);
  const pb = await w.products.getProduct(b.workspaceId, b.productId);
  assert.equal(pa?.blueprintId, SHARED_BLUEPRINT);
  assert.equal(pb?.blueprintId, SHARED_BLUEPRINT);
  assert.notEqual(a.workspaceId, b.workspaceId);
  assert.notEqual(a.slug, b.slug);
  assert.notEqual(a.sellerAccountId, b.sellerAccountId);
  assert.notEqual(sha(a.master.bytes), sha(b.master.bytes), 'each store has its own file');
  assert.deepEqual(await w.directory.resolve(a.slug), { workspaceId: a.workspaceId, businessId: a.businessId });
  assert.deepEqual(await w.directory.resolve(b.slug), { workspaceId: b.workspaceId, businessId: b.businessId });
});

test('release: one test purchase in store A delivers store A\'s correct file exactly once, even when the payment event is replayed', async () => {
  const { w } = await world();
  const { a, b } = w.stores;
  const { orderId, event } = await w.buy('a', { email: 'first.buyer@example.test' });
  // the provider replays the same event (in a burst and one by one)
  const burst = await Promise.all([1, 2, 3].map(() => w.checkout.handlePaymentEvent(event)));
  assert.ok(burst.every((r) => r.outcome === 'duplicate_event'));
  for (let i = 0; i < 3; i++) assert.equal((await w.checkout.handlePaymentEvent(event)).outcome, 'duplicate_event');

  const box = w.email.outbox();
  assert.equal(box.length, 1, 'exactly one delivery email');
  assert.equal(w.email.attempts(), 1);
  assert.equal(box[0]!.to, 'first.buyer@example.test');
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1);
  assert.equal((await w.fulfilmentStore.list(b.workspaceId)).length, 0);
  assert.equal((await w.files.listGrants({ workspaceId: a.workspaceId, businessId: a.businessId }, orderItemId(orderId))).length, 1);
  assert.equal((await w.orders.list(a.workspaceId)).length, 1);

  const got = await w.files.redeem(tokens(w)[0]);
  assert.ok(got.ok);
  assert.equal(sha(got.file.bytes), sha(a.master.bytes), 'the bytes are store A\'s approved master');
  assert.notEqual(sha(got.file.bytes), sha(b.master.bytes));
  const version = (await w.products.listVersions(a.workspaceId, a.productId)).find((v) => v.version === a.productVersion);
  assert.equal(got.sha256, version?.approvedHash, 'and they match the approved, pinned version that was bought');
  const ent = await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId);
  assert.deepEqual([ent?.productId, ent?.productVersion, ent?.storeSlug], [a.productId, a.productVersion, a.slug]);
});

test('release: the two stores cannot read each other\'s orders, fulfilments, grants or files', async () => {
  const { w } = await world();
  const bought = { a: await w.buy('a'), b: await w.buy('b') };
  const [tokenA, tokenB] = tokens(w) as [string, string];
  const token = { a: tokenA, b: tokenB };

  const check = async (meKey: 'a' | 'b', themKey: 'a' | 'b') => {
    const me: WorldStore = w.stores[meKey];
    const them: WorldStore = w.stores[themKey];
    const theirOrder = bought[themKey].orderId;
    const theirItem = orderItemId(theirOrder);
    const mine = { workspaceId: me.workspaceId, businessId: me.businessId, actorId: me.scope.actorId };
    // orders
    assert.equal(await w.orders.get(me.workspaceId, theirOrder), null);
    assert.deepEqual((await w.orders.list(me.workspaceId)).map((o) => o.id), [bought[meKey].orderId]);
    assert.deepEqual((await w.fulfilment.listStoreOrders(me.scope)).map((r) => r.orderId), [bought[meKey].orderId]);
    assert.equal(await w.fulfilment.getStoreOrder(me.scope, theirOrder), null);
    assert.equal(await w.fulfilment.lookupBuyerOrder({ storeSlug: me.slug, reference: theirOrder, email: `buyer-${themKey}@example.test` }), null);
    // fulfilments and entitlements
    assert.equal(await w.fulfilmentStore.get(me.workspaceId, theirOrder), null);
    assert.equal(await w.fulfilmentStore.getEntitlement(me.workspaceId, theirOrder), null);
    assert.equal((await w.fulfilment.retryDelivery(me.scope, theirOrder)).outcome, 'order_not_found');
    assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: me.workspaceId, orderId: theirOrder })).outcome, 'order_not_found');
    const re = await w.fulfilment.reissueAccess(me.scope, { orderId: theirOrder, reason: 'Trying the other store' });
    assert.equal(re.ok === false && re.code, 'order_not_found');
    assert.equal(JSON.stringify(await w.fulfilment.audit(me.scope)).includes(bought[themKey].event.eventId), false);
    // grants
    assert.deepEqual(await w.files.listGrants(mine, theirItem), []);
    const theirGrant = (await w.files.listGrants({ workspaceId: them.workspaceId, businessId: them.businessId }, theirItem))[0]!;
    const wrongTenant = (e: unknown) => e instanceof FilesError && e.code === 'wrong_tenant';
    await assert.rejects(w.files.issueGrant(mine, theirItem), wrongTenant);
    await assert.rejects(w.files.reissueGrant(mine, theirItem), wrongTenant);
    await assert.rejects(w.files.revokeGrant(mine, theirGrant.id), wrongTenant);
    assert.equal(w.files.audit(mine).some((x) => x.grantId === theirGrant.id && x.event !== 'download_denied'), false);
    // files: their link presented on my store is refused, and my tenant keys cannot address their master
    const crossed = await w.files.redeem(token[themKey], { businessId: me.businessId });
    assert.equal(crossed.ok === false && crossed.reason, 'wrong_tenant');
    assert.equal(await w.products.getProduct(me.workspaceId, them.productId), null);
    assert.deepEqual(await w.products.listVersions(me.workspaceId, them.productId), []);
    assert.equal(await w.storage.getMaster({ workspaceId: me.workspaceId, businessId: me.businessId, productId: them.productId, version: them.productVersion }), null);
  };
  await check('a', 'b');
  await check('b', 'a');

  // after all of that, each buyer's own link still returns their own store's file, and nothing extra was emailed
  for (const k of ['a', 'b'] as const) {
    const r = await w.files.redeem(token[k]);
    assert.ok(r.ok);
    assert.equal(sha(r.file.bytes), sha(w.stores[k].master.bytes));
    assert.equal((await w.files.listGrants({ workspaceId: w.stores[k].workspaceId, businessId: w.stores[k].businessId }, orderItemId(bought[k].orderId))).filter((g) => g.revokedAt === null).length, 1);
  }
  assert.equal(w.email.outbox().length, 2);
  // a refund in store A does not touch store B
  const orderA = (await w.orders.get(w.stores.a.workspaceId, bought.a.orderId))!;
  assert.equal((await w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: 'evt_release_refund', type: 'charge.refunded', order: orderA }, w.now()))).outcome, 'refunded');
  assert.equal((await w.files.redeem(token.a)).ok, false);
  assert.equal((await w.files.redeem(token.b)).ok, true);
});

/** The fulfil-order job on the real jobs runner, with a counter around every step. */
function jobs(w: FulfilmentWorld, clock: { t: number }) {
  const runs: string[] = [];
  const def = createFulfilOrderJob(w.fulfilment);
  const counted: JobKindDefinition = { ...def, steps: def.steps.map((s) => ({ ...s, run: async (args) => { runs.push(s.name); return s.run(args); } })) };
  const registry = createJobRegistry([counted]);
  const store = createMemoryJobStore();
  const now = () => clock.t;
  const service = createJobService({ store, registry, now });
  const runner = (owner: string) => createJobRunner({ store, registry, owner, now, random: () => 0, leaseMs: 60_000, backoff: { baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0 } });
  const ctx = (s: WorldStore, orderId: string): OperationContext => ({ workspaceId: s.workspaceId, businessId: s.businessId, actorUserId: 'system:payment-event', idempotencyKey: orderId });
  return { runs, store, service, runner, ctx };
}

test('release: a fulfilment job stopped after its first step resumes from the checkpoint on a new runner without redoing it', async () => {
  const { w, clock } = await world({ attach: false });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const j = jobs(w, clock);
  const { job, created } = await j.service.enqueue(j.ctx(a, orderId), { kind: FULFIL_ORDER_JOB, input: { orderId } });
  assert.equal(created, true);
  assert.equal((await j.service.enqueue(j.ctx(a, orderId), { kind: FULFIL_ORDER_JOB, input: { orderId } })).created, false, 'one job per order');

  const r1 = await j.runner('runner-1').runDue();
  assert.deepEqual(r1.map((r) => [r.step, r.outcome]), [['record', 'succeeded']]);
  const mid = await j.service.get(j.ctx(a, orderId), job.id);
  assert.equal(mid.steps[0]!.status, 'succeeded');
  assert.equal(mid.steps[1]!.status, 'pending');
  const fulfilmentId = (mid.steps[0]!.output as { fulfilmentId: string }).fulfilmentId;
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.id, fulfilmentId);
  assert.equal(w.email.outbox().length, 0, 'interrupted before delivery');

  // the process restarts: a brand-new runner on the same job store
  await j.runner('runner-2').drain();
  const done = await j.service.get(j.ctx(a, orderId), job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(j.runs, ['record', 'deliver', 'confirm'], 'the completed step was not run again');
  assert.deepEqual(done.steps.map((s) => [s.name, s.status, s.attempts]), [['record', 'succeeded', 1], ['deliver', 'succeeded', 1], ['confirm', 'succeeded', 1]]);
  assert.deepEqual(done.steps[0]!.output, mid.steps[0]!.output, 'the checkpoint is unchanged');
  assert.deepEqual(done.steps[2]!.output, { status: 'delivered', deliveredAt: new Date(START).toISOString() });
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1);
  const got = await w.files.redeem(tokens(w)[0]);
  assert.ok(got.ok);
  assert.equal(sha(got.file.bytes), sha(a.master.bytes));
  assert.equal(JSON.stringify(done).includes(tokens(w)[0]!), false, 'no download link in a job checkpoint');
});

test('release: a worker that dies in the middle of the deliver step (after the email went out) is resumed without a second email', async () => {
  const { w, clock } = await world({ attach: false });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const j = jobs(w, clock);
  const { job } = await j.service.enqueue(j.ctx(a, orderId), { kind: FULFIL_ORDER_JOB, input: { orderId } });
  await j.runner('runner-1').runDue(); // record
  // runner-1 claims "deliver", sends the email, then the process is killed before the checkpoint is written
  const claims = await j.store.claim({ now: clock.t, owner: 'runner-1', leaseMs: 60_000, limit: 10 });
  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.job.steps[claims[0]!.stepIndex]!.name, 'deliver');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId }, { trigger: 'job' })).outcome, 'delivered');
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await j.service.get(j.ctx(a, orderId), job.id)).status, 'running');

  // nothing can take the job while the dead worker's lease is still valid
  assert.deepEqual(await j.runner('runner-2').runDue(), []);
  clock.t += 60_001;
  await j.runner('runner-2').drain();
  const done = await j.service.get(j.ctx(a, orderId), job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(j.runs, ['record', 'deliver', 'confirm'], 'record was not redone; deliver re-ran once for the lost attempt');
  assert.deepEqual(done.steps[1]!.output, { status: 'delivered', sentNow: false, attempts: 1 });
  assert.equal(done.steps[1]!.attempts, 2);
  assert.equal(w.email.outbox().length, 1, 'still exactly one email');
  assert.equal(w.email.attempts(), 1);
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.attempts, 1);
  assert.equal((await w.files.listGrants({ workspaceId: a.workspaceId, businessId: a.businessId }, orderItemId(orderId))).length, 1);
});

test('release: an email outage during the job is retried from the deliver step only, and a job for an unpaid or foreign order delivers nothing', async () => {
  const { w, clock } = await world({ attach: false });
  const { a, b } = w.stores;
  const { orderId } = await w.buy('a');
  const j = jobs(w, clock);
  w.email.failNext(1);
  const { job } = await j.service.enqueue(j.ctx(a, orderId), { kind: FULFIL_ORDER_JOB, input: { orderId } });
  const first = await j.runner('runner-1').drain();
  assert.deepEqual(first.map((r) => [r.step, r.outcome]), [['record', 'succeeded'], ['deliver', 'retry']]);
  assert.equal((await j.service.get(j.ctx(a, orderId), job.id)).status, 'waiting-retry');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.status, 'failed');
  clock.t += 1_000;
  await j.runner('runner-2').drain();
  assert.equal((await j.service.get(j.ctx(a, orderId), job.id)).status, 'succeeded');
  assert.deepEqual(j.runs, ['record', 'deliver', 'deliver', 'confirm']);
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.attempts, 2);

  // store B enqueues a job naming store A's order; and store A enqueues one for an unpaid order
  const pending = await w.startOrder('a');
  const foreign = await j.service.enqueue(j.ctx(b, orderId), { kind: FULFIL_ORDER_JOB, input: { orderId } });
  const unpaid = await j.service.enqueue(j.ctx(a, pending.orderId), { kind: FULFIL_ORDER_JOB, input: { orderId: pending.orderId } });
  await j.runner('runner-3').drain();
  assert.equal((await j.service.get(j.ctx(b, orderId), foreign.job.id)).status, 'failed');
  assert.equal((await j.service.get(j.ctx(a, pending.orderId), unpaid.job.id)).status, 'failed');
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.list(b.workspaceId)).length, 0);
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1);
});

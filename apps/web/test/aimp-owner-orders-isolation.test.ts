// H19/H20 tenant isolation: an order of another business (same workspace) or another workspace answers exactly like an unknown
// order for list, detail, resend and reissue, and causes no side effect (no email, no grant change, no audit row, no fulfilment).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import { getOwnerOrder, listOwnerOrders, reissueAccess, resendDelivery } from '../lib/aimp/owner-orders/index.ts';
import { ownerOrdersDeps, seedOrder } from '../lib/aimp/owner-orders/demo.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
async function setup() {
  const w = await createFulfilmentWorld({ now: () => new Date(START), attach: false });
  const a = w.stores.a;
  const b = w.stores.b;
  // Business A's paid order, undelivered so a stray action would be visible as an email.
  const orderA = (await w.buy('a')).orderId;
  // Business B (other workspace) has a paid order.
  const orderB = (await w.buy('b')).orderId;
  // A SECOND business in A's workspace, with its own paid order.
  const sibling = { workspaceId: a.workspaceId, businessId: 'biz-store-a-second' };
  await seedOrder(w.orders, { id: 'ord_sibling', ...sibling, createdAt: '2026-11-14T09:30:00.000Z', paid: true });
  return { w, deps: ownerOrdersDeps(w), a, b, orderA, orderB, sibling, orderSibling: 'ord_sibling' };
}
const owner = (scope: { workspaceId: string; businessId: string }, actorId: string) => ({ ...scope, actorId });
const unknown = 'ord_does_not_exist';

async function snapshot(x: Awaited<ReturnType<typeof setup>>) {
  return JSON.stringify({
    emails: x.w.email.outbox().length,
    fulfilmentsA: await x.w.fulfilmentStore.list(x.a.workspaceId),
    fulfilmentsB: await x.w.fulfilmentStore.list(x.b.workspaceId),
    auditA: await x.w.fulfilmentStore.listAudit(x.a.workspaceId),
    auditB: await x.w.fulfilmentStore.listAudit(x.b.workspaceId),
    orders: [await x.w.orders.list(x.a.workspaceId), await x.w.orders.list(x.b.workspaceId)],
    grantsA: await x.w.files.listGrants({ workspaceId: x.a.workspaceId, businessId: x.a.businessId }, orderItemId(x.orderA)),
    grantsB: await x.w.files.listGrants({ workspaceId: x.b.workspaceId, businessId: x.b.businessId }, orderItemId(x.orderB)),
  });
}

test('lists show one business only: A sees A, the sibling sees its own order, B sees B', async () => {
  const x = await setup();
  const ids = async (s: { workspaceId: string; businessId: string }) => (await listOwnerOrders(x.deps, s)).orders.map((o) => o.id);
  assert.deepEqual(await ids(x.a), [x.orderA]);
  assert.deepEqual(await ids(x.b), [x.orderB]);
  assert.deepEqual(await ids(x.sibling), [x.orderSibling]);
  assert.deepEqual((await listOwnerOrders(x.deps, x.a)).counts, { all: 1, needs_attention: 0, delivered: 0, refunded: 0 });
  // a forged mix of B's workspace with A's business, and the reverse, sees nothing
  assert.deepEqual(await ids({ workspaceId: x.b.workspaceId, businessId: x.a.businessId }), []);
  assert.deepEqual(await ids({ workspaceId: x.a.workspaceId, businessId: x.b.businessId }), []);
  assert.deepEqual(await ids({ workspaceId: x.a.workspaceId, businessId: 'biz-nobody' }), []);
});

test('detail: a foreign order is null, exactly like an unknown one (same business in another workspace, sibling business, other workspace)', async () => {
  const x = await setup();
  const before = await snapshot(x);
  const unknownAnswer = await getOwnerOrder(x.deps, x.a, unknown);
  assert.equal(unknownAnswer, null);
  for (const [scope, id] of [
    [x.a, x.orderB],                       // other workspace's order
    [x.a, x.orderSibling],                 // sibling business, same workspace
    [x.sibling, x.orderA],                 // the sibling asks for A's order
    [x.b, x.orderA],
    [{ workspaceId: x.b.workspaceId, businessId: x.a.businessId }, x.orderA],   // forged: A's business id under B's workspace
    [{ workspaceId: x.a.workspaceId, businessId: x.b.businessId }, x.orderA],   // forged: B's business id under A's workspace
  ] as const) {
    assert.deepEqual(await getOwnerOrder(x.deps, scope, id), unknownAnswer);
  }
  // each owner still sees their own
  assert.equal((await getOwnerOrder(x.deps, x.a, x.orderA))?.id, x.orderA);
  assert.equal((await getOwnerOrder(x.deps, x.sibling, x.orderSibling))?.id, x.orderSibling);
  assert.equal(await snapshot(x), before, 'reads changed nothing');
});

test('actions: a foreign order answers exactly like an unknown one and causes no side effect', async () => {
  const x = await setup();
  const before = await snapshot(x);
  const askers = [owner(x.a, 'owner-a'), owner(x.sibling, 'owner-sib'), owner(x.b, 'owner-b')];
  for (const act of [resendDelivery, reissueAccess]) {
    const unknownAnswer = await act(x.deps, owner(x.a, 'owner-a'), unknown, 'key-unknown');
    assert.equal(unknownAnswer.ok, false);
    assert.equal(!unknownAnswer.ok && unknownAnswer.code, 'order_not_found');
    for (const asker of askers) {
      for (const id of [x.orderA, x.orderB, x.orderSibling]) {
        const own = (asker.businessId === x.a.businessId && id === x.orderA) || (asker.businessId === x.b.businessId && id === x.orderB) || (asker.businessId === x.sibling.businessId && id === x.orderSibling);
        if (own) continue;
        const r = await act(x.deps, asker, id, `key-${asker.actorId}-${id}`);
        assert.deepEqual(r, unknownAnswer, `${act.name} by ${asker.actorId} on ${id}`);
      }
    }
    // forged scopes
    for (const forged of [owner({ workspaceId: x.b.workspaceId, businessId: x.a.businessId }, 'forger'), owner({ workspaceId: x.a.workspaceId, businessId: x.b.businessId }, 'forger')]) {
      assert.deepEqual(await act(x.deps, forged, x.orderA, 'forged-1'), unknownAnswer);
      assert.deepEqual(await act(x.deps, forged, x.orderB, 'forged-2'), unknownAnswer);
    }
  }
  assert.equal(await snapshot(x), before, 'no email, grant, fulfilment, order or audit row changed');
  assert.equal(x.w.email.outbox().length, 0);
});

test('actions: the rightful owner can still act, and only on their own order', async () => {
  const x = await setup();
  const r = await resendDelivery(x.deps, owner(x.a, 'owner-a'), x.orderA, 'own-1');
  assert.equal(r.ok && r.outcome, 'sent');
  assert.equal(x.w.email.outbox().length, 1);
  assert.equal(x.w.email.outbox()[0]!.to, 'buyer-a@example.test');
  assert.equal((await x.w.fulfilmentStore.get(x.b.workspaceId, x.orderB)), null, 'B untouched');
  const rb = await reissueAccess(x.deps, owner(x.b, 'owner-b'), x.orderB, 'own-b');
  assert.equal(rb.ok && rb.outcome, 'sent');
  assert.equal(x.w.email.outbox()[1]!.to, 'buyer-b@example.test');
  assert.equal((await x.w.fulfilmentStore.list(x.a.workspaceId)).length, 1);
});

test('a request key used on a foreign order does not block the owner using the same key on their own order', async () => {
  const x = await setup();
  assert.equal((await resendDelivery(x.deps, owner(x.b, 'owner-b'), x.orderA, 'shared-key')).ok, false);
  const r = await resendDelivery(x.deps, owner(x.a, 'owner-a'), x.orderA, 'shared-key');
  assert.equal(r.ok && r.outcome, 'sent');
});

test('nothing about another business leaks through a list, detail or action answer', async () => {
  const x = await setup();
  const tokenB = x.w.tokenIn((await (async () => { await x.w.fulfilment.fulfilPaidOrder({ workspaceId: x.b.workspaceId, orderId: x.orderB }); return x.w.email.outbox().at(-1)!; })()));
  assert.ok(tokenB);
  const out = JSON.stringify([
    await listOwnerOrders(x.deps, x.a), await getOwnerOrder(x.deps, x.a, x.orderB), await resendDelivery(x.deps, owner(x.a, 'owner-a'), x.orderB, 'leak-1'),
    await reissueAccess(x.deps, owner(x.a, 'owner-a'), x.orderB, 'leak-2'),
  ]);
  for (const s of [x.orderB, x.orderSibling, tokenB, 'buyer-b', x.b.businessId, x.b.workspaceId, x.sibling.businessId]) assert.equal(out.includes(s), false, `leaked ${s}`);
});

// Fulfilment hardening (AMP-042): a refund racing a delivery, bounded in-memory growth, and the real route modules failing closed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld, fulfilmentRuntime } from '../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import type { SignedMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import { createMemoryFulfilmentStore, FULFILMENT_AUDIT_CAP, FULFILMENT_MONEY_EVENT_CAP } from '../lib/aimp/fulfilment/store.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';
import { GET as downloadRoute } from '../app/api/aimp/fulfilment/download/[token]/route.ts';
import { POST as lookupRoute } from '../app/api/aimp/fulfilment/orders/lookup/route.ts';
import { POST as supportRoute } from '../app/api/aimp/fulfilment/support/route.ts';
import { POST as refundRoute } from '../app/api/aimp/fulfilment/webhooks/refunds/route.ts';

const START = Date.parse('2026-11-14T10:00:00Z');

test('a refund that lands while the delivery email is being sent wins: access ends revoked and the emailed link is dead', async () => {
  const hook: { refund: SignedMoneyEvent | null; w: FulfilmentWorld | null } = { refund: null, w: null };
  const w = await createFulfilmentWorld({
    now: () => new Date(START), attach: false,
    emailLookup: (flaky) => ({
      outbox: () => flaky.outbox(),
      send: async (input) => {
        if (hook.refund && hook.w) { const ev = hook.refund; hook.refund = null; assert.equal((await hook.w.fulfilment.handleRefundEvent(ev)).outcome, 'refunded'); }
        return flaky.send(input);
      },
    }),
  });
  hook.w = w;
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const order = (await w.orders.get(a.workspaceId, orderId))!;
  hook.refund = signMoneyEvent(w.webhookSecret, { eventId: 'evt_refund_mid_delivery', type: 'charge.refunded', order }, w.now());

  const r = await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId });
  assert.equal(r.outcome, 'revoked');
  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'revoked');
  assert.equal(f.delivery.deliveredAt, null, 'never recorded as delivered');
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.outcome]), [[1, 'abandoned']]);
  assert.equal((await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))?.status, 'revoked');
  assert.equal((await w.orders.get(a.workspaceId, orderId))?.status, 'refunded');
  // the email was already on its way, but its link does not work
  const token = w.tokenIn(w.email.outbox()[0]!);
  assert.ok(token);
  const redeemed = await w.files.redeem(token);
  assert.equal(redeemed.ok, false);
  assert.equal((await w.files.listGrants({ workspaceId: a.workspaceId, businessId: a.businessId }, orderItemId(orderId))).filter((g) => g.revokedAt === null).length, 0);
  // and nothing can deliver it afterwards
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId })).outcome, 'revoked');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'revoked');
  assert.equal(w.email.outbox().length, 1);
});

test('a refund that lands after the fulfilment is recorded but before delivery means nothing is ever sent', async () => {
  const w = await createFulfilmentWorld({ now: () => new Date(START), attach: false });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const ref = { workspaceId: a.workspaceId, orderId };
  assert.equal((await w.fulfilment.recordPaidOrder(ref)).outcome, 'in_progress');
  const order = (await w.orders.get(a.workspaceId, orderId))!;
  assert.equal((await w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId: 'evt_refund_before_delivery', type: 'charge.refunded', order }, w.now()))).outcome, 'refunded');
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref, { trigger: 'job' })).outcome, 'revoked');
  assert.equal((await w.fulfilment.recordPaidOrder(ref)).outcome, 'revoked');
  assert.equal(w.email.attempts(), 0);
  assert.equal((await w.files.listGrants({ workspaceId: a.workspaceId, businessId: a.businessId }, orderItemId(orderId))).length, 0);
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.status, 'revoked');
});

test('the memory store is bounded: the audit log and the refund-event log drop their oldest rows at the cap', async () => {
  const s = createMemoryFulfilmentStore();
  const at = new Date(START).toISOString();
  for (let i = 0; i < FULFILMENT_AUDIT_CAP + 25; i++) {
    await s.appendAudit({ at, event: 'retry_refused', workspaceId: 'ws-1', businessId: 'biz-1', orderId: 'ord-1', fulfilmentId: null, actor: 'owner', reason: null, note: String(i) });
  }
  const audit = await s.listAudit('ws-1');
  assert.equal(audit.length, FULFILMENT_AUDIT_CAP);
  assert.equal(audit[0]!.note, '25');
  assert.equal(audit.at(-1)!.seq, FULFILMENT_AUDIT_CAP + 25);

  const ev = (i: number) => ({ eventId: `evt_${i}`, type: 'charge.dispute.created', kind: 'dispute' as const, workspaceId: 'ws-1', businessId: 'biz-1', orderId: 'ord-1', amountMinor: null, needsOwner: true, outcome: 'needs_owner', note: null, at });
  for (let i = 0; i < FULFILMENT_MONEY_EVENT_CAP + 10; i++) assert.equal(await s.recordMoneyEvent(ev(i)), true);
  assert.equal((await s.listMoneyEvents('ws-1')).length, FULFILMENT_MONEY_EVENT_CAP);
  assert.equal(await s.hasMoneyEvent('evt_0'), false, 'the oldest row was dropped');
  assert.equal(await s.hasMoneyEvent(`evt_${FULFILMENT_MONEY_EVENT_CAP + 9}`), true);
  assert.equal(await s.recordMoneyEvent(ev(FULFILMENT_MONEY_EVENT_CAP + 9)), false, 'a recent event id is still refused as a duplicate');
});

test('the real route modules fail closed: support is 401 for everyone, cross-origin is 403, unsigned events are 400, junk links are 404', async () => {
  const rt = fulfilmentRuntime({}); // the same fixture runtime the routes use outside production
  assert.ok(rt);
  const d = await rt;
  const before = { emails: d.world.email.outbox().length, ordersA: (await d.world.orders.list(d.world.stores.a.workspaceId)).length };
  const { orderId } = await d.world.buy('a');
  const a = d.world.stores.a;
  const url = 'http://localhost:3000/api/aimp/fulfilment';
  const sameOrigin = { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' };
  const post = (path: string, body: unknown, headers: Record<string, string>) => new Request(`${url}/${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
  const sent = d.world.email.outbox().length;

  // support: no owner session is mapped to a store yet, so even a well-formed same-origin call with real ids is refused
  const reissue = { action: 'reissue', orderId, reason: 'Buyer lost the link', workspaceId: a.workspaceId, businessId: a.businessId, actorId: a.scope.actorId };
  const s1 = await supportRoute(post('support', reissue, sameOrigin));
  assert.equal(s1.status, 401);
  assert.equal((await supportRoute(post('support', { action: 'orders' }, sameOrigin))).status, 401);
  assert.equal((await supportRoute(post('support', reissue, { ...sameOrigin, origin: 'https://evil.example' }))).status, 403);
  assert.equal((await supportRoute(post('support', reissue, { host: 'localhost:3000', 'content-type': 'application/json' }))).status, 403);
  assert.equal((await supportRoute(post('support', reissue, { ...sameOrigin, 'content-type': 'text/plain' }))).status, 403);
  assert.equal(d.world.email.outbox().length, sent, 'nothing was reissued');

  // buyer lookup: same-origin JSON only; a match returns the buyer view, a wrong email one generic 404
  const lookup = { storeSlug: a.slug, reference: orderId, email: 'buyer-a@example.test' };
  assert.equal((await lookupRoute(post('orders/lookup', lookup, { ...sameOrigin, origin: 'https://evil.example' }))).status, 403);
  const found = await lookupRoute(post('orders/lookup', lookup, sameOrigin));
  assert.equal(found.status, 200);
  const text = await found.text();
  assert.equal((JSON.parse(text) as { order: { reference: string } }).order.reference, orderId);
  assert.equal(text.includes('buyer-a@example.test') || text.includes('/download/') || text.includes(a.workspaceId), false);
  assert.equal((await lookupRoute(post('orders/lookup', { ...lookup, email: 'other@example.test' }, sameOrigin))).status, 404);
  assert.equal((await lookupRoute(post('orders/lookup', { ...lookup, storeSlug: d.world.stores.b.slug }, sameOrigin))).status, 404);

  // refund webhook: the signature is required and checked before anything else
  const order = (await d.world.orders.get(a.workspaceId, orderId))!;
  const ev = signMoneyEvent(d.world.webhookSecret, { eventId: `evt_route_${orderId}`, type: 'charge.refunded', order }, d.world.now());
  assert.equal((await refundRoute(post('webhooks/refunds', ev.rawBody, {}))).status, 400);
  assert.equal((await refundRoute(post('webhooks/refunds', ev.rawBody, { 'stripe-signature': 't=1,v1=deadbeef' }))).status, 400);
  assert.equal((await d.world.orders.get(a.workspaceId, orderId))?.status, 'paid');

  // download: junk is 404; the emailed link works; after a verified refund it is 410
  const open = (token: string) => downloadRoute(new Request(`${url}/download/${token}`), { params: Promise.resolve({ token }) });
  assert.equal((await open('not-a-token')).status, 404);
  const token = d.world.tokenIn(d.world.email.outbox().at(-1)!);
  assert.ok(token);
  const file = await open(token);
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(a.master.bytes));
  const ok = await refundRoute(post('webhooks/refunds', ev.rawBody, { 'stripe-signature': ev.signature }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { received: true, outcome: 'refunded' });
  assert.equal((await open(token)).status, 410);
  assert.equal((await d.world.orders.list(a.workspaceId)).length, before.ordersA + 1);
});

test('in production without the tools flag there is no runtime, so every fulfilment route answers 503', async () => {
  assert.equal(fulfilmentRuntime({ NODE_ENV: 'production' }), null);
  const g = globalThis as { process: { env: Record<string, string | undefined> } };
  const saved = { node: g.process.env.NODE_ENV, tools: g.process.env.AIMP_TOOLS_ENABLED };
  g.process.env.NODE_ENV = 'production';
  delete g.process.env.AIMP_TOOLS_ENABLED;
  try {
    const headers = { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' };
    const post = () => new Request('http://localhost:3000/api/aimp/fulfilment/x', { method: 'POST', body: '{}', headers });
    for (const route of [supportRoute, lookupRoute, refundRoute]) {
      const res = await route(post());
      assert.equal(res.status, 503);
      assert.match(((await res.json()) as { error: string }).error, /not available right now/);
    }
    assert.equal((await downloadRoute(new Request('http://localhost:3000/api/aimp/fulfilment/download/x'), { params: Promise.resolve({ token: 'x' }) })).status, 503);
  } finally {
    if (saved.node === undefined) delete g.process.env.NODE_ENV; else g.process.env.NODE_ENV = saved.node;
    if (saved.tools !== undefined) g.process.env.AIMP_TOOLS_ENABLED = saved.tools;
  }
});

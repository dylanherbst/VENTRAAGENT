// Fulfilment "delivers once" (AMP-042 rework): a provider timeout after the send, a worker that dies after the send, and a
// double-submitted reissue must each end with ONE email whose link works, and a refund must still leave no working link.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFulfilmentWorld } from '../lib/aimp/fulfilment/demo.ts';
import type { FlakyEmail, FulfilmentWorld, WorldOptions } from '../lib/aimp/fulfilment/demo.ts';
import { createSupportHandler } from '../lib/aimp/fulfilment/handlers.ts';
import { signMoneyEvent } from '../lib/aimp/fulfilment/refund-events.ts';
import { orderItemId } from '../lib/aimp/orders/index.ts';
import type { EmailAdapter } from '../lib/aimp/providers/types.ts';

const START = Date.parse('2026-11-14T10:00:00Z');
const HOUR = 3_600_000;
type SendInput = Parameters<EmailAdapter['send']>[0];
async function world(opts: WorldOptions = {}) {
  const clock = { t: START };
  const w = await createFulfilmentWorld({ now: () => new Date(clock.t), ...opts });
  return { w, clock };
}
const grantsOf = (w: FulfilmentWorld, orderId: string) => w.files.listGrants({ workspaceId: w.stores.a.workspaceId, businessId: w.stores.a.businessId }, orderItemId(orderId));
const activeGrants = async (w: FulfilmentWorld, orderId: string) => (await grantsOf(w, orderId)).filter((g) => g.revokedAt === null);
const tokenOf = (w: FulfilmentWorld, i: number) => { const t = w.tokenIn(w.email.outbox()[i]!); assert.ok(t); return t; };
const reasonOf = async (w: FulfilmentWorld, token: string) => { const r = await w.files.redeem(token); return r.ok ? 'ok' : r.reason; };
async function redeemsMaster(w: FulfilmentWorld, token: string) {
  const r = await w.files.redeem(token);
  assert.ok(r.ok, 'the emailed link works');
  assert.deepEqual(Buffer.from(r.file.bytes), Buffer.from(w.stores.a.master.bytes), 'and returns the bought file');
  return r.grantId;
}
const refund = async (w: FulfilmentWorld, orderId: string, eventId: string) => {
  const order = (await w.orders.get(w.stores.a.workspaceId, orderId))!;
  return w.fulfilment.handleRefundEvent(signMoneyEvent(w.webhookSecret, { eventId, type: 'charge.refunded', order }, w.now()));
};
/** The provider ACCEPTS the message (it is in the outbox) and then the call throws, like a timeout on the response. */
function acceptThenThrow(times: number) {
  const state = { left: times, sent: [] as SendInput[] };
  const emailLookup = (flaky: FlakyEmail): EmailAdapter => ({
    outbox: () => flaky.outbox(),
    send: async (input) => {
      state.sent.push(input);
      const r = await flaky.send(input);
      if (state.left > 0) { state.left -= 1; throw new Error('Fixture timeout after the provider accepted the message.'); }
      return r;
    },
  });
  return { state, emailLookup };
}

test('the provider accepts the email and then times out: the retry ends delivered with ONE email and its link works', async () => {
  const { state, emailLookup } = acceptThenThrow(1);
  const { w, clock } = await world({ emailLookup });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  let f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'failed');
  assert.equal(f.delivery.lastError, 'email_failed');
  assert.equal(w.email.outbox().length, 1, 'the buyer already has the email');
  const firstToken = tokenOf(w, 0);

  clock.t += 60_000;
  const r = await w.fulfilment.retryDelivery(a.scope, orderId);
  assert.equal(r.outcome, 'delivered');
  f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.equal(f.status, 'delivered');
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.outcome, x.error]), [[1, 'failed', 'email_failed'], [2, 'delivered', null]]);

  // exactly one email, although the provider was called twice: the second call carried the same key and the same link
  assert.equal(w.email.attempts(), 2);
  assert.equal(w.email.outbox().length, 1, 'no second email');
  assert.equal(state.sent.length, 2);
  assert.equal(state.sent[0]!.idempotencyKey, state.sent[1]!.idempotencyKey);
  assert.equal(state.sent[0]!.text, state.sent[1]!.text);
  assert.equal(f.delivery.emailMessageId, w.email.outbox()[0]!.id);
  assert.equal(f.delivery.emailIdempotencyKey, state.sent[0]!.idempotencyKey);

  // one grant, used by both attempts, and the link in the one email redeems the right file
  const grants = await grantsOf(w, orderId);
  assert.equal(grants.length, 1, 'the retry reused the grant instead of replacing it');
  assert.equal(grants[0]!.revokedAt, null);
  assert.deepEqual(f.attemptLog.map((x) => x.grantId), [grants[0]!.id, grants[0]!.id]);
  assert.equal((await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId))?.grantId, grants[0]!.id);
  assert.equal(tokenOf(w, 0), firstToken);
  assert.equal(await redeemsMaster(w, firstToken), grants[0]!.id);

  // nothing stored or audited holds the link
  const kept = JSON.stringify([f, await w.fulfilmentStore.getEntitlement(a.workspaceId, orderId), await w.fulfilment.audit(a.scope), w.files.audit({ workspaceId: a.workspaceId, businessId: a.businessId })]);
  assert.equal(kept.includes(firstToken), false);
});

test('a worker that dies after the send but before recording it: the lease takeover sends no second email and the link works', async () => {
  const sent: SendInput[] = [];
  let die = true;
  let reached: () => void = () => {};
  const afterSend = new Promise<void>((resolve) => { reached = resolve; });
  const { w, clock } = await world({
    attach: false, leaseMs: 30_000,
    emailLookup: (flaky) => ({
      outbox: () => flaky.outbox(),
      send: async (input) => {
        sent.push(input);
        const r = await flaky.send(input);
        // The first worker never comes back from the send: it never settles its attempt.
        if (die) { die = false; reached(); return new Promise<never>(() => {}); }
        return r;
      },
    }),
  });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const ref = { workspaceId: a.workspaceId, orderId };
  void w.fulfilment.fulfilPaidOrder(ref, { trigger: 'job' });
  await afterSend;
  assert.equal(w.email.outbox().length, 1, 'the email went out');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, orderId))?.status, 'delivering', 'but nothing was recorded');

  // before the lease ends nobody else may send
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref, { trigger: 'job' })).outcome, 'in_progress');
  assert.equal(sent.length, 1);
  clock.t += 30_000;
  assert.equal((await w.fulfilment.fulfilPaidOrder(ref, { trigger: 'job' })).outcome, 'delivered');

  const f = (await w.fulfilmentStore.get(a.workspaceId, orderId))!;
  assert.deepEqual(f.attemptLog.map((x) => [x.n, x.outcome]), [[1, 'abandoned'], [2, 'delivered']]);
  assert.equal(sent.length, 2, 'the takeover did call the provider');
  assert.equal(sent[0]!.idempotencyKey, sent[1]!.idempotencyKey, 'with the same key');
  assert.equal(sent[0]!.text, sent[1]!.text, 'and the same link');
  assert.equal(w.email.outbox().length, 1, 'so no second email was sent');
  const grants = await grantsOf(w, orderId);
  assert.equal(grants.length, 1);
  assert.equal(await redeemsMaster(w, tokenOf(w, 0)), grants[0]!.id);
  assert.equal(f.attemptLog[1]!.grantId, grants[0]!.id);
});

test('a retry only reuses a WORKING grant: an expired one is replaced, and that new link is a new email', async () => {
  const { state, emailLookup } = acceptThenThrow(1);
  const { w, clock } = await world({ emailLookup });
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const oldToken = tokenOf(w, 0);
  clock.t += 73 * HOUR; // past the 72 hour link life
  assert.equal(await reasonOf(w, oldToken), 'expired');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, orderId)).outcome, 'delivered');
  assert.equal(w.email.outbox().length, 2, 'the first link is dead, so the buyer is sent a working one');
  assert.notEqual(state.sent[0]!.idempotencyKey, state.sent[1]!.idempotencyKey);
  const newToken = tokenOf(w, 1);
  assert.notEqual(newToken, oldToken);
  const grantId = await redeemsMaster(w, newToken);
  const active = await activeGrants(w, orderId);
  assert.deepEqual(active.map((g) => g.id), [grantId], 'still exactly one working link');
  assert.equal((await grantsOf(w, orderId)).length, 2);
});

test('a reissue submitted twice sends one email; a different request is still a new email with a new link', async () => {
  const { w, clock } = await world();
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  const scope = { ...a.scope, actorId: 'support-jo' };
  const emails = () => w.email.outbox().length;
  assert.equal(emails(), 1);

  // one after the other (a double click whose second request arrives after the first finished)
  const r1 = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Buyer deleted the email' });
  assert.ok(r1.ok);
  assert.equal(r1.duplicate, undefined);
  assert.equal(emails(), 2);
  const r2 = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Buyer deleted the email' });
  assert.ok(r2.ok);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.grantId, r1.grantId);
  assert.deepEqual(r2.revokedGrantIds, []);
  assert.equal(r2.fulfilment.reissues, 1);
  assert.equal(emails(), 2, 'the repeat sent nothing');
  assert.equal(await redeemsMaster(w, tokenOf(w, 1)), r1.grantId);
  assert.deepEqual((await activeGrants(w, orderId)).map((g) => g.id), [r1.grantId], 'the repeat did not revoke the link it had just sent');
  const dup = (await w.fulfilment.audit(a.scope)).filter((x) => x.event === 'reissue_duplicate');
  assert.deepEqual(dup.map((x) => [x.actor, x.reason, x.orderId]), [['support-jo', 'Buyer deleted the email', orderId]]);

  // both at the same moment: one sends, the other is told it is already being sent
  const both = await Promise.all([1, 2, 3].map(() => w.fulfilment.reissueAccess(scope, { orderId, reason: 'Wrong address, sending again' })));
  assert.equal(both.filter((r) => r.ok).length, 1);
  assert.deepEqual(both.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code)), ['in_progress', 'in_progress']);
  assert.equal(emails(), 3);
  const sentNow = both.find((r) => r.ok);
  assert.ok(sentNow?.ok);
  assert.equal(await redeemsMaster(w, tokenOf(w, 2)), sentNow.grantId);
  assert.equal(await reasonOf(w, tokenOf(w, 1)), 'revoked', 'a real new reissue still kills the earlier link');
  assert.equal((await activeGrants(w, orderId)).length, 1);

  // the same person and reason again, later, is a deliberate new request
  clock.t += 5 * 60_000;
  const later = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Wrong address, sending again' });
  assert.ok(later.ok);
  assert.equal(later.duplicate, undefined);
  assert.equal(emails(), 4);
  assert.notEqual(later.grantId, sentNow.grantId);

  // a caller-supplied request key: the same key never sends twice, however late the repeat arrives
  const k1 = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Keyed request', requestKey: 'req-0001' });
  assert.ok(k1.ok);
  assert.equal(emails(), 5);
  clock.t += 30 * 60_000;
  const k1again = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Keyed request', requestKey: 'req-0001' });
  assert.ok(k1again.ok);
  assert.equal(k1again.duplicate, true);
  assert.equal(k1again.grantId, k1.grantId);
  assert.equal(emails(), 5);
  const k2 = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Keyed request', requestKey: 'req-0002' });
  assert.ok(k2.ok);
  assert.equal(k2.duplicate, undefined);
  assert.equal(emails(), 6);
  assert.equal(await redeemsMaster(w, tokenOf(w, 5)), k2.grantId);
  assert.equal((await activeGrants(w, orderId)).length, 1);
  const bad = await w.fulfilment.reissueAccess(scope, { orderId, reason: 'Bad key', requestKey: 'has spaces\n' });
  assert.equal(bad.ok === false && bad.code, 'invalid');
  assert.equal(emails(), 6);
});

test('a reissue whose email failed can be submitted again at once, and the support route passes the request key through', async () => {
  const { w } = await world();
  const a = w.stores.a;
  const { orderId } = await w.buy('a');
  w.email.failNext(1);
  const failed = await w.fulfilment.reissueAccess(a.scope, { orderId, reason: 'Link lost', requestKey: 'req-a' });
  assert.equal(failed.ok === false && failed.code, 'email_failed');
  const again = await w.fulfilment.reissueAccess(a.scope, { orderId, reason: 'Link lost', requestKey: 'req-a' });
  assert.ok(again.ok, 'a request that sent nothing is not treated as already sent');
  assert.equal(again.duplicate, undefined);
  assert.equal(w.email.outbox().length, 2);

  const route = createSupportHandler(() => w.fulfilment, { originOk: () => true, authorize: () => a.scope });
  const post = (body: unknown) => new Request('http://x.test/api', { method: 'POST', body: JSON.stringify(body) });
  const body = { action: 'reissue', orderId, reason: 'Sent from the form', requestKey: 'form-1' };
  const first = await route(post(body));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, status: 'delivered', reissues: 2 });
  const second = await route(post(body));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, status: 'delivered', reissues: 2, duplicate: true });
  assert.equal(w.email.outbox().length, 3, 'the double submit emailed one link');
  assert.equal((await route(post({ ...body, requestKey: 7 }))).status, 400);
  assert.equal(w.email.outbox().length, 3);
});

test('refunds still end with no working link: after a retried delivery, between a failed attempt and its retry, and after a repeated reissue', async () => {
  // refund after a delivery that needed a retry (the grant was reused, not replaced)
  const one = acceptThenThrow(1);
  const { w } = await world({ emailLookup: one.emailLookup });
  const a = w.stores.a;
  const first = await w.buy('a');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, first.orderId)).outcome, 'delivered');
  const token = tokenOf(w, 0);
  assert.equal((await activeGrants(w, first.orderId)).length, 1);
  assert.equal((await refund(w, first.orderId, 'evt_once_refund_1')).outcome, 'refunded');
  assert.equal(await reasonOf(w, token), 'revoked');
  assert.equal((await activeGrants(w, first.orderId)).length, 0);
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, first.orderId))?.status, 'revoked');
  assert.equal((await w.fulfilmentStore.getEntitlement(a.workspaceId, first.orderId))?.status, 'revoked');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, first.orderId)).outcome, 'revoked');
  assert.equal(w.email.outbox().length, 1);

  // refund between the failed attempt and the retry: the retry must not revive or re-send the grant of the failed attempt
  one.state.left = 1;
  const second = await w.buy('a');
  assert.equal((await w.fulfilmentStore.get(a.workspaceId, second.orderId))?.status, 'failed');
  const sentToken = tokenOf(w, 1);
  assert.equal(await reasonOf(w, sentToken), 'ok');
  const calls = w.email.attempts();
  assert.equal((await refund(w, second.orderId, 'evt_once_refund_2')).outcome, 'refunded');
  assert.equal((await w.fulfilment.retryDelivery(a.scope, second.orderId)).outcome, 'revoked');
  assert.equal((await w.fulfilment.fulfilPaidOrder({ workspaceId: a.workspaceId, orderId: second.orderId }, { trigger: 'job' })).outcome, 'revoked');
  assert.equal(w.email.attempts(), calls, 'the provider was not called again');
  assert.equal(await reasonOf(w, sentToken), 'revoked');
  assert.equal((await activeGrants(w, second.orderId)).length, 0);
  assert.equal((await grantsOf(w, second.orderId)).length, 1, 'no new grant was issued for a refunded order');

  // refund after a reissue and its repeat: the reissued link dies and a further repeat is refused, not answered as a duplicate
  const third = await w.buy('a');
  const r1 = await w.fulfilment.reissueAccess(a.scope, { orderId: third.orderId, reason: 'Buyer lost it', requestKey: 'req-refund' });
  assert.ok(r1.ok);
  const reissued = tokenOf(w, w.email.outbox().length - 1);
  assert.equal(await reasonOf(w, reissued), 'ok');
  assert.equal((await refund(w, third.orderId, 'evt_once_refund_3')).outcome, 'refunded');
  assert.equal(await reasonOf(w, reissued), 'revoked');
  assert.equal((await activeGrants(w, third.orderId)).length, 0);
  const emails = w.email.outbox().length;
  const after = await w.fulfilment.reissueAccess(a.scope, { orderId: third.orderId, reason: 'Buyer lost it', requestKey: 'req-refund' });
  assert.equal(after.ok === false && after.code, 'order_refunded');
  assert.equal(w.email.outbox().length, emails);
});

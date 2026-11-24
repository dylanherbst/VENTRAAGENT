// The exact steps /tools/aimp-fulfilment runs (the page's actions call these same functions), in the order the page walks them:
// paid order -> delivered -> replay (no duplicate) -> fail + retry -> reissue -> refund.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadHandler } from '../lib/aimp/files/handler.ts';
import {
  createFulfilmentWorld, demoBuy, demoMoneyEvent, demoReissue, demoReplayPaid, demoReplayRefund, demoRetry, DOWNLOAD_PATH, fulfilmentRuntime, isStoreKey,
} from '../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentDemo } from '../lib/aimp/fulfilment/demo.ts';

async function demo(): Promise<FulfilmentDemo> {
  return { world: await createFulfilmentWorld(), lastPaidEvent: null, lastRefundEvent: null, counter: 0 };
}

test('test page walk: paid -> delivered -> replay -> fail + retry -> reissue -> refund, on fixtures', async () => {
  const d = await demo();
  const w = d.world;
  const a = w.stores.a;
  const status = async (orderId: string) => (await w.fulfilment.listStoreOrders(a.scope)).find((r) => r.orderId === orderId)!;
  const download = createDownloadHandler(() => w.files);
  const open = (token: string | null) => download(new Request(`http://localhost${DOWNLOAD_PATH}/${token}`), { params: Promise.resolve({ token: token ?? '' }) });

  // paid order -> delivered
  assert.equal(await demoReplayPaid(d), 'No payment event to replay yet.');
  const first = await demoBuy(d, 'a');
  assert.match(first.message, /Payment webhook answered 200 \(paid\)\. Fulfilment is delivered after 1 attempt\(s\); 1 email\(s\)/);
  assert.equal((await status(first.orderId)).fulfilmentStatus, 'delivered');
  const firstLink = w.tokenIn(w.email.outbox()[0]!);
  const file = await open(firstLink);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') ?? '', /^attachment; filename=/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(a.master.bytes));

  // replay: no duplicate
  assert.match(await demoReplayPaid(d), /\(duplicate_event\)\. Emails sent by the replay: 0\./);
  assert.equal(w.email.outbox().length, 1);
  assert.equal((await w.fulfilmentStore.list(a.workspaceId)).length, 1);

  // fail + retry
  const second = await demoBuy(d, 'a', { failDelivery: true });
  assert.match(second.message, /Fulfilment is failed after 1 attempt\(s\); 1 email\(s\)/);
  assert.equal((await status(second.orderId)).lastError, 'email_failed');
  assert.match(await demoRetry(d, 'a', second.orderId), /^Retry: delivered\. Attempts used: 2 of 5\./);
  assert.match(await demoRetry(d, 'a', second.orderId), /^Retry: already_delivered\./);
  assert.equal(w.email.outbox().length, 2);

  // reissue: refused for the other store, then done for the right one
  assert.match(await demoReissue(d, 'b', first.orderId, 'Buyer lost the email'), /^Reissue refused \(order_not_found\)/);
  assert.match(await demoReissue(d, 'a', first.orderId, ''), /^Reissue refused \(invalid\)/);
  assert.match(await demoReissue(d, 'a', first.orderId, 'Buyer lost the email'), /^Reissued: a fresh link was emailed and 1 earlier link\(s\) stopped working\./);
  assert.equal(w.email.outbox().length, 3);
  assert.equal((await open(firstLink)).status, 410, 'the old link is gone');
  const newLink = w.tokenIn(w.email.outbox()[2]!);
  assert.equal((await open(newLink)).status, 200);

  // dispute and partial refund only go to the owner; a full refund withdraws access; its replay changes nothing
  assert.match(await demoMoneyEvent(d, 'a', first.orderId, 'dispute'), /\(needs_owner\)\. Fulfilment is delivered/);
  assert.match(await demoMoneyEvent(d, 'a', first.orderId, 'partial'), /\(needs_owner\)/);
  assert.equal((await open(newLink)).status, 200);
  assert.match(await demoMoneyEvent(d, 'a', first.orderId, 'refund'), /Refund webhook answered 200 \(refunded\)\. Fulfilment is revoked/);
  assert.match(await demoReplayRefund(d), /\(duplicate_event\)/);
  assert.equal((await open(newLink)).status, 410);
  const row = await status(first.orderId);
  assert.deepEqual([row.orderStatus, row.fulfilmentStatus], ['refunded', 'revoked']);
  assert.match(await demoReissue(d, 'a', first.orderId, 'Asking after the refund'), /^Reissue refused \(order_refunded\)/);
  assert.match(await demoRetry(d, 'a', first.orderId), /^Retry: revoked\./);
  assert.equal(await demoMoneyEvent(d, 'b', first.orderId, 'refund'), 'That order was not found.');
  // the second order was never touched, and store B saw none of it
  assert.equal((await status(second.orderId)).fulfilmentStatus, 'delivered');
  assert.deepEqual(await w.fulfilment.listStoreOrders(w.stores.b.scope), []);
  assert.equal(w.email.outbox().length, 3);
  assert.equal(isStoreKey('a') && isStoreKey('b') && !isStoreKey('c'), true);
});

test('the fulfilment demo runtime is off in production unless the tools flag is set', () => {
  assert.equal(fulfilmentRuntime({ NODE_ENV: 'production' }), null);
  assert.equal(fulfilmentRuntime({ NODE_ENV: 'production', AIMP_TOOLS_ENABLED: '0' }), null);
});

'use server';
import { notFound, redirect } from 'next/navigation';
import { demoBuy, demoMoneyEvent, demoReissue, demoReplayPaid, demoReplayRefund, demoRetry, fulfilmentRuntime, isStoreKey } from '../../../lib/aimp/fulfilment/demo.ts';
import type { FulfilmentDemo } from '../../../lib/aimp/fulfilment/demo.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/aimp-fulfilment?msg=${encodeURIComponent(msg.slice(0, 600))}` : '/tools/aimp-fulfilment');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');

/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
async function guard(): Promise<FulfilmentDemo> {
  const p = fulfilmentRuntime();
  if (!p) notFound();
  return p;
}
/** Runs one demo step and shows its message. Unexpected errors become one safe line. */
async function step(run: (d: FulfilmentDemo) => Promise<string>): Promise<never> {
  const d = await guard();
  let msg: string;
  try { msg = await run(d); } catch (e) { msg = e instanceof Error && /demo is limited/.test(e.message) ? e.message : 'That step could not be run.'; }
  return back(msg);
}
const storeOf = (f: FormData, name = 'store'): 'a' | 'b' => { const v = field(f, name); return isStoreKey(v) ? v : 'a'; };

export async function buy(f: FormData): Promise<void> {
  await step(async (d) => (await demoBuy(d, storeOf(f), { failDelivery: field(f, 'fail') === '1' })).message);
}
export async function replayPaid(): Promise<void> { await step((d) => demoReplayPaid(d)); }
export async function retry(f: FormData): Promise<void> {
  await step((d) => demoRetry(d, storeOf(f), field(f, 'orderId'), { failDelivery: field(f, 'fail') === '1' }));
}
export async function reissue(f: FormData): Promise<void> {
  await step((d) => demoReissue(d, storeOf(f, 'as'), field(f, 'orderId'), field(f, 'reason')));
}
export async function moneyEvent(f: FormData): Promise<void> {
  const kind = field(f, 'kind');
  await step((d) => demoMoneyEvent(d, storeOf(f), field(f, 'orderId'), kind === 'partial' || kind === 'dispute' ? kind : 'refund'));
}
export async function replayRefund(): Promise<void> { await step((d) => demoReplayRefund(d)); }
export async function lookup(f: FormData): Promise<void> {
  await step(async (d) => {
    const v = await d.world.fulfilment.lookupBuyerOrder({ storeSlug: d.world.stores[storeOf(f)].slug, reference: field(f, 'reference'), email: field(f, 'email') });
    return v ? `Buyer lookup: order ${v.reference} is ${v.orderStatus}; delivery: ${v.delivery}.` : 'Buyer lookup: no order matches that reference and email in that store.';
  });
}

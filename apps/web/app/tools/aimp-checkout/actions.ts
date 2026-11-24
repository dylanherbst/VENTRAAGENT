'use server';
import { notFound, redirect } from 'next/navigation';
import { checkoutRuntime } from '../../../lib/aimp/checkout/demo.ts';
import type { CheckoutRuntime } from '../../../lib/aimp/checkout/demo.ts';
import { paySessionWithFixture } from '../../../lib/aimp/checkout/fixture-events.ts';
import { createCheckoutHandler, createPaymentWebhookHandler } from '../../../lib/aimp/checkout/handlers.ts';
import { signPayload } from '../../../lib/aimp/checkout/signature.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/aimp-checkout?msg=${encodeURIComponent(msg)}` : '/tools/aimp-checkout');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');

/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
async function guard(): Promise<CheckoutRuntime> {
  const p = checkoutRuntime();
  if (!p) notFound();
  return p;
}

const postEvent = async (rt: CheckoutRuntime, rawBody: string, signature: string): Promise<string> => {
  const res = await createPaymentWebhookHandler(() => rt.checkout)(new Request('http://localhost/api/aimp/webhooks/payments', { method: 'POST', body: rawBody, headers: { 'stripe-signature': signature } }));
  const j = (await res.json()) as { outcome?: string };
  return `Webhook answered ${res.status}${j.outcome ? ` (${j.outcome})` : ''}.`;
};

/** Goes through the same HTTP handler as the real route. The "browser" also claims a price and a seller; both are ignored. */
export async function startCheckout(f: FormData): Promise<void> {
  const rt = await guard();
  const row = rt.listings.find((l) => l.key === field(f, 'listing'));
  if (!row) return back('Choose a listing.');
  const res = await createCheckoutHandler(() => rt.checkout)(new Request('http://localhost/api/aimp/checkout', {
    method: 'POST',
    body: JSON.stringify({
      storeSlug: row.storeSlug, listingId: row.listingId, buyerEmail: field(f, 'email'), idempotencyKey: field(f, 'key'),
      priceMinor: Number(field(f, 'clientPriceMinor')), sellerAccountId: field(f, 'clientSeller'),
    }),
  }));
  const j = (await res.json()) as { error?: string; orderId?: string; amountMinor?: number; replayed?: boolean };
  back(res.ok ? `Checkout ${res.status}: pending order ${j.orderId} for ${j.amountMinor} cents${j.replayed ? ' (same order returned for the same key)' : ''}. Client price and seller were ignored.` : `Checkout refused ${res.status}: ${j.error ?? ''}`);
}

/** The fixture provider takes the payment for a session and sends the signed event. */
export async function payOrder(f: FormData): Promise<void> {
  const rt = await guard();
  const order = await rt.orders.get('demo-workspace', field(f, 'orderId'));
  if (!order?.checkoutSessionId) return back('That order has no checkout session.');
  const adapter = rt.registry.payments.adapter;
  if (!adapter) return back('Payments are off.');
  try {
    const ev = await paySessionWithFixture(adapter, order.checkoutSessionId, rt.webhookSecret, new Date());
    rt.lastEvent = ev;
    back(await postEvent(rt, ev.rawBody, ev.signature));
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // the redirect
    back('Could not send the payment event.');
  }
}

export async function replayEvent(): Promise<void> {
  const rt = await guard();
  if (!rt.lastEvent) return back('No event to replay yet.');
  back(`Replayed ${rt.lastEvent.eventId}. ${await postEvent(rt, rt.lastEvent.rawBody, rt.lastEvent.signature)}`);
}

/** A "paid" event signed with the wrong secret: must be rejected and change nothing. */
export async function sendForgedEvent(f: FormData): Promise<void> {
  const rt = await guard();
  const order = await rt.orders.get('demo-workspace', field(f, 'orderId'));
  if (!order?.checkoutSessionId) return back('That order has no checkout session.');
  const now = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({ id: `evt_forged_${now}`, type: 'checkout.session.completed', created: now, data: { object: { id: order.checkoutSessionId, amount_total: order.amountMinor, currency: 'aud', payment_status: 'paid' } } });
  back(`Forged event: ${await postEvent(rt, rawBody, signPayload('whsec_wrong_secret', rawBody, now))}`);
}

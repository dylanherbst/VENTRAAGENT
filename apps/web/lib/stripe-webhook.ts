import { createHmac, timingSafeEqual } from 'node:crypto';

export type OrderRecord = { eventId: string; sessionId: string; amountMinor: number; currency: string; paid: boolean; customerEmail: string | null; createdAt: string };
export const SIGNATURE_TOLERANCE_SECONDS = 300;

// Verifies a Stripe-Signature header (t=timestamp,v1=hmac) against the RAW request body. Never parse the body before this passes.
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!secret || !/^whsec_[A-Za-z0-9]{8,}$/.test(secret)) throw new Error('Webhook secret is not configured.');
  if (!header) throw new Error('Missing signature.');
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || !signatures.length) throw new Error('Malformed signature.');
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) throw new Error('Signature timestamp is outside the allowed window.');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const ok = signatures.some(sig => {
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    return timingSafeEqual(Buffer.from(sig, 'hex'), expected);
  });
  if (!ok) throw new Error('Signature does not match.');
}
export function signForTest(rawBody: string, secret: string, t: number): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

// Maps a verified checkout.session.completed or async_payment_succeeded event to an order. Other events return null.
export function orderFromEvent(event: unknown): OrderRecord | null {
  const e = event as { id?: unknown; type?: unknown; created?: unknown; livemode?: unknown; data?: { object?: Record<string, unknown> } } | null;
  if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') throw new Error('Invalid event.');
  if (e.livemode === true) throw new Error('Live-mode event refused: this integration is test mode only.');
  if (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded') return null;
  const s = e.data?.object;
  if (!s || typeof s.id !== 'string' || !Number.isSafeInteger(s.amount_total) || typeof s.currency !== 'string') throw new Error('Invalid checkout session.');
  const email = (s.customer_details as { email?: unknown } | undefined)?.email;
  return { eventId: e.id, sessionId: s.id, amountMinor: s.amount_total as number, currency: s.currency.toUpperCase(), paid: s.payment_status === 'paid', customerEmail: typeof email === 'string' ? email : null, createdAt: new Date((typeof e.created === 'number' ? e.created : Date.now() / 1000) * 1000).toISOString() };
}

// Idempotency: Stripe retries events, so the same event id must produce one order.
export function createOrderLedger() {
  const seen = new Map<string, OrderRecord>();
  return {
    record(order: OrderRecord): { duplicate: boolean; order: OrderRecord } {
      const existing = seen.get(order.eventId);
      if (existing) return { duplicate: true, order: existing };
      seen.set(order.eventId, order);
      if (seen.size > 1000) seen.delete(seen.keys().next().value as string);
      return { duplicate: false, order };
    },
    list: () => [...seen.values()],
  };
}

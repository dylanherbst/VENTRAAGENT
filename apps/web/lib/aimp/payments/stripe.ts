// Stripe Checkout adapter (Stripe API v1, form-encoded, Bearer secret key, Idempotency-Key header). The fetch function is injected, so
// tests never touch the network. NOT connected: needs STRIPE_SECRET_KEY. Two jobs only:
//  1. createSession: start a hosted Checkout Session for exactly one product at a price WE decided (never a client-sent price).
//  2. verifyPaid: ask Stripe directly whether a session is paid, for the right amount and currency, so a paid page or webhook alone is
//     never trusted. The existing checkout service still marks orders paid only from signature-verified events; this is the second check.
import type { FetchLike } from '../social/ayrshare.ts';

export const STRIPE_BASE = 'https://api.stripe.com/v1';
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isHttps = (u: string): boolean => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

/** 'test' for sk_test_ / rk_test_ keys, 'live' for sk_live_ / rk_live_, null for anything else (refused). */
export function keyMode(key: string): 'test' | 'live' | null {
  return /^(sk|rk)_test_[A-Za-z0-9]{8,}$/.test(key) ? 'test' : /^(sk|rk)_live_[A-Za-z0-9]{8,}$/.test(key) ? 'live' : null;
}

export interface SessionInput {
  amountCents: number; currency: string; productName: string; successUrl: string; cancelUrl: string;
  buyerEmail: string;
  /** Our own order id; comes back on the event so the order can be found. */
  orderId: string;
  idempotencyKey: string;
}
export type SessionResult = { ok: true; sessionId: string; url: string } | { ok: false; message: string };

export function encodeSession(i: SessionInput): { ok: true; body: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(i.amountCents) || i.amountCents < 50 || i.amountCents > 2_000_000) errors.push('The price is out of range.');
  if (!/^[a-z]{3}$/.test(i.currency)) errors.push('Currency must be a 3-letter lowercase code.');
  if (!i.productName.trim() || i.productName.length > 250) errors.push('The product name is missing or too long.');
  if (!isHttps(i.successUrl) || !isHttps(i.cancelUrl)) errors.push('Return links must be https.');
  if (!/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(i.buyerEmail)) errors.push('The email address looks wrong.');
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(i.orderId)) errors.push('The order id is invalid.');
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(i.idempotencyKey)) errors.push('A stable key is needed so a retry cannot charge twice.');
  if (errors.length) return { ok: false, errors };
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', i.successUrl); p.set('cancel_url', i.cancelUrl);
  p.set('customer_email', i.buyerEmail);
  p.set('client_reference_id', i.orderId);
  p.set('metadata[orderId]', i.orderId);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', i.currency);
  p.set('line_items[0][price_data][unit_amount]', String(i.amountCents));
  p.set('line_items[0][price_data][product_data][name]', i.productName);
  return { ok: true, body: p.toString() };
}

export function createStripe(deps: { secretKey: string; fetch: FetchLike }) {
  const mode = keyMode(deps.secretKey);
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${deps.secretKey}`, ...extra });
  const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });
  return {
    mode,
    async createSession(i: SessionInput): Promise<SessionResult> {
      if (!mode) return bad('The Stripe key is missing or not in the right format.');
      const enc = encodeSession(i);
      if (!enc.ok) return bad(enc.errors.join(' '));
      let res;
      try {
        res = await deps.fetch(`${STRIPE_BASE}/checkout/sessions`, { method: 'POST', headers: headers({ 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': i.idempotencyKey }), body: enc.body });
      } catch { return bad('Could not reach Stripe. Nothing was charged.'); }
      const j = obj(await res.json().catch(() => ({})));
      const id = str(j.id), url = str(j.url);
      if ((res.status < 200 || res.status >= 300) || !id || !url || !isHttps(url)) return bad('Stripe did not start the payment. Nothing was charged.');
      return { ok: true, sessionId: id, url };
    },
    /** Server-side check against Stripe itself. True only when paid, for exactly this amount and currency, for this order. */
    async verifyPaid(sessionId: string, expect: { amountCents: number; currency: string; orderId: string }): Promise<{ paid: boolean; reason: string }> {
      if (!mode) return { paid: false, reason: 'Stripe is not connected.' };
      if (!/^cs_(test|live)_[A-Za-z0-9]{6,}$/.test(sessionId)) return { paid: false, reason: 'Bad session id.' };
      let res;
      try { res = await deps.fetch(`${STRIPE_BASE}/checkout/sessions/${sessionId}`, { method: 'GET', headers: headers() }); } catch { return { paid: false, reason: 'Could not reach Stripe.' }; }
      const j = obj(await res.json().catch(() => ({})));
      if ((res.status < 200 || res.status >= 300)) return { paid: false, reason: 'Stripe could not find that session.' };
      if (str(j.payment_status) !== 'paid') return { paid: false, reason: 'Not paid yet.' };
      if (num(j.amount_total) !== expect.amountCents || str(j.currency) !== expect.currency) return { paid: false, reason: 'The amount or currency does not match the order.' };
      if (str(j.client_reference_id) !== expect.orderId) return { paid: false, reason: 'The session belongs to a different order.' };
      return { paid: true, reason: 'Paid.' };
    },
  };
}

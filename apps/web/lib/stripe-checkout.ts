import { offerCurrencies } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';

export type CheckoutRequest = { name: string; amountMinor: number; currency: OfferCurrency; successUrl: string; cancelUrl: string };
export type CheckoutResult = { mode: 'TEST'; sessionId: string; url: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// Payments are TEST MODE ONLY. A live secret key (sk_live_ or rk_live_) is refused here, before any network call.
export function assertTestKey(key: string | undefined): string {
  if (!key) throw new Error('Stripe test key is not configured.');
  if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(key)) throw new Error('Only a Stripe TEST key (sk_test_…) is accepted. Live payments need the owner’s explicit approval.');
  return key;
}
function httpUrl(value: string, label: string): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error(`${label} must be a full http(s) address.`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${label} must be a full http(s) address.`);
  return u.toString();
}
export function checkoutErrors(r: CheckoutRequest): string[] {
  const errors: string[] = [];
  if (!r.name.trim() || r.name.length > 160) errors.push('Offer name must be 1–160 characters.');
  if (!Number.isSafeInteger(r.amountMinor) || r.amountMinor < 50 || r.amountMinor > 99_999_999) errors.push('Price must be between 0.50 and 999,999.99.');
  if (!(offerCurrencies as readonly string[]).includes(r.currency)) errors.push('Choose a supported currency.');
  return errors;
}
export function checkoutBody(r: CheckoutRequest): string {
  const errors = checkoutErrors(r);
  if (errors.length) throw new Error(errors.join(' '));
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', httpUrl(r.successUrl, 'Success address'));
  p.set('cancel_url', httpUrl(r.cancelUrl, 'Cancel address'));
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', r.currency.toLowerCase());
  p.set('line_items[0][price_data][unit_amount]', String(r.amountMinor));
  p.set('line_items[0][price_data][product_data][name]', r.name.trim());
  return p.toString();
}
export async function createTestCheckout(r: CheckoutRequest, key: string | undefined, fetcher: Fetch = fetch as unknown as Fetch, signal?: AbortSignal): Promise<CheckoutResult> {
  const secret = assertTestKey(key);
  const body = checkoutBody(r);
  const res = await fetcher('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal });
  const data = (await res.json().catch(() => null)) as { id?: unknown; url?: unknown; livemode?: unknown } | null;
  if (!res.ok || !data || typeof data.id !== 'string' || typeof data.url !== 'string') throw new Error('Stripe could not create the test checkout. Check the test key and details.');
  if (data.livemode === true) throw new Error('Stripe returned a live-mode session. Refusing: this integration is test mode only.');
  return { mode: 'TEST', sessionId: data.id, url: data.url };
}

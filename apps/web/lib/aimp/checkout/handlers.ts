// HTTP handlers for POST /api/aimp/checkout and POST /api/aimp/webhooks/payments (AMP-041). Plain Request -> Response so they
// are unit-tested without a server. Errors are short and never echo input, secrets or internals.
import type { CheckoutRefusal, CheckoutService } from './service.ts';

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: HEADERS });

export type CheckoutLookup = () => Promise<CheckoutService | null> | CheckoutService | null;

const MAX_CHECKOUT_BYTES = 4_096;
const MAX_EVENT_BYTES = 65_536;

const STATUS: Record<CheckoutRefusal, number> = {
  invalid: 400, store_not_found: 404, listing_not_available: 404,
  provider_off: 409, seller_not_found: 409, seller_not_ready: 409, payments_unavailable: 503, session_failed: 502,
};

async function readText(request: Request, max: number): Promise<string | null> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(len) && len > max) return null;
  const text = await request.text();
  return text.length > max ? null : text;
}

async function service(get: CheckoutLookup): Promise<CheckoutService | null> {
  try { return await get(); } catch { return null; }
}

/** The body may carry a price or seller; it is ignored: only these four fields are copied out. */
export function createCheckoutHandler(get: CheckoutLookup) {
  return async function POST(request: Request): Promise<Response> {
    const svc = await service(get);
    if (!svc) return json(503, { error: 'Checkout is not available right now.' });
    let text: string | null;
    try { text = await readText(request, MAX_CHECKOUT_BYTES); } catch { return json(400, { error: 'Could not read the request.' }); }
    if (text === null) return json(413, { error: 'That request is too large.' });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'Send JSON.' }); }
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : '');
    let r;
    try {
      r = await svc.startCheckout({ storeSlug: s(b.storeSlug), listingId: s(b.listingId), buyerEmail: s(b.buyerEmail), idempotencyKey: s(b.idempotencyKey) });
    } catch { return json(500, { error: 'Something went wrong. Nothing was charged.' }); }
    if (!r.ok) return json(STATUS[r.code], { error: r.message, code: r.code });
    return json(r.replayed ? 200 : 201, { orderId: r.orderId, checkoutUrl: r.checkoutUrl, amountMinor: r.amountMinor, currency: r.currency, replayed: r.replayed });
  };
}

/** Reads the RAW body (the signature covers the exact bytes) and applies a verified provider event. */
export function createPaymentWebhookHandler(get: CheckoutLookup) {
  return async function POST(request: Request): Promise<Response> {
    const svc = await service(get);
    if (!svc) return json(503, { error: 'Webhooks are not available right now.' });
    let raw: string | null;
    try { raw = await readText(request, MAX_EVENT_BYTES); } catch { return json(400, { error: 'Could not read the request.' }); }
    if (raw === null) return json(413, { error: 'That request is too large.' });
    const r = await svc.handlePaymentEvent({ rawBody: raw, signature: request.headers.get('stripe-signature') });
    if (r.outcome === 'bad_signature' || r.outcome === 'invalid') return json(400, { received: false, error: 'Rejected.' });
    if (r.outcome === 'amount_mismatch' || r.outcome === 'not_pending') return json(422, { received: false, outcome: r.outcome });
    // paid, duplicate, already paid, unsupported type and unknown session are all acknowledged so the provider stops retrying.
    return json(200, { received: true, outcome: r.outcome });
  };
}

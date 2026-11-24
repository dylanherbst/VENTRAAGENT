import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin } from '../../../lib/request-security';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../lib/request-body';
import { checkoutErrors, createTestCheckout } from '../../../lib/stripe-checkout';
import { clientKey, createRateLimiter } from '../../../lib/rate-limit';
import { offerCurrencies } from '../../../lib/local-offers';
import type { OfferCurrency } from '../../../lib/local-offers';
import { frozenReply } from '../../../lib/scope-freeze';
export const dynamic = 'force-dynamic';
// TEST MODE ONLY: createTestCheckout refuses any non-test Stripe key. Success and cancel addresses are built here, never taken from the request.
// Checkout is anonymous, so the key is the client address hint; a global ceiling still bounds the total if that hint is spoofed.
const limit = createRateLimiter(10, 10 * 60_000);
const globalLimit = createRateLimiter(200, 10 * 60_000);
export async function POST(req: NextRequest) {
  const paused = frozenReply('checkout'); if (paused) return paused; // scope freeze: docs/agents/SCOPE_FREEZE.md
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
  if (!sameOrigin(req.headers.get('origin'), req.headers.get('host'), req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN) || !req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Use a same-origin JSON request.' }, 403);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return reply({ error: 'Test checkout is not connected: no Stripe test key is configured.', configured: false, mode: 'DEMO' }, 503);
  const rate = limit(clientKey(req.headers.get('x-forwarded-for')));
  const globalRate = rate.allowed ? globalLimit('checkout') : rate;
  if (!globalRate.allowed) return reply({ error: 'Too many checkout attempts. Try again later.' }, 429, { 'Retry-After': String(globalRate.retryAfterSeconds) });
  try {
    const input = JSON.parse(await readBoundedRequestBody(req));
    const currency = String(input?.currency ?? '') as OfferCurrency;
    const request = { name: String(input?.name ?? ''), amountMinor: Number(input?.amountMinor), currency, successUrl: `${req.nextUrl.origin}/tools/checkout?status=success`, cancelUrl: `${req.nextUrl.origin}/tools/checkout?status=cancelled` };
    const errors = checkoutErrors(request);
    if (errors.length || !(offerCurrencies as readonly string[]).includes(currency)) return reply({ error: errors.join(' ') || 'Choose a supported currency.' }, 400);
    return reply(await createTestCheckout(request, key, undefined, req.signal));
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return reply({ error: 'Request too large.' }, 413);
    if (error instanceof SyntaxError) return reply({ error: 'Invalid JSON.' }, 400);
    return reply({ error: error instanceof Error && /^(Only a Stripe TEST key|Stripe )/.test(error.message) ? error.message : 'Checkout could not be created. Please retry.' }, 502);
  }
}

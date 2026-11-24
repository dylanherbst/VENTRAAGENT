// Stripe webhook for AI reply credit purchases. Signature checked over the raw body with STRIPE_SETTER_WEBHOOK_SECRET, then Stripe is
// asked directly whether the session is paid for the exact pack price. Credits are added once per purchase.
import { handleCreditWebhook } from '../../../../../lib/aimp/setter/billing';
import { live, setterStripe } from '../../../../start/_server/setter-runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const stripe = setterStripe(), rt = live(), secret = process.env.STRIPE_SETTER_WEBHOOK_SECRET ?? '';
  if (!stripe || !rt || !secret) return new Response('Not configured', { status: 503 });
  const raw = await req.text();
  if (raw.length > 65_536) return new Response('Too large', { status: 413 });
  const r = await handleCreditWebhook({ store: rt.store, stripe, webhookSecret: secret, now: () => new Date() }, raw, req.headers.get('stripe-signature'));
  return new Response(r.status === 200 ? 'ok' : 'rejected', { status: r.status });
}

// Start buying AI reply credits (Stripe Checkout). DEMO LIMIT: the workspace comes from the posted business id checked against the demo
// runtime; with real auth it MUST come from the signed-in owner's session. 503 until STRIPE_SECRET_KEY and the setter keys are set.
import { randomBytes } from 'node:crypto';
import { startCreditPurchase } from '../../../../../../lib/aimp/setter/billing';
import { availability, checkBusiness } from '../../../../../start/_server/runtime';
import { live, setterStripe } from '../../../../../start/_server/setter-runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const stripe = setterStripe(), rt = live();
  if (!stripe || !rt) return Response.json({ ok: false, message: 'Buying credits is not switched on yet.' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { business?: unknown; packId?: unknown; email?: unknown };
  if (!availability().available || !checkBusiness(body.business)) return Response.json({ ok: false, message: 'Unknown business.' }, { status: 404 });
  const base = process.env.INSTAGRAM_REDIRECT_URI ? new URL(process.env.INSTAGRAM_REDIRECT_URI).origin : new URL(req.url).origin;
  const r = await startCreditPurchase({ store: rt.store, stripe, newId: () => randomBytes(9).toString('base64url'), now: () => new Date() },
    { workspaceId: body.business, packId: body.packId, email: typeof body.email === 'string' ? body.email : '', returnBase: `${base}/app/${body.business}/setter` });
  return r.ok ? Response.json({ ok: true, url: r.url }) : Response.json({ ok: false, message: r.message }, { status: 400 });
}

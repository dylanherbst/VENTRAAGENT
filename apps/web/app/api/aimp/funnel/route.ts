// Anonymous shop funnel beacon: { shop: "<business id>" | slug: "<store slug>", step: "visit" | "checkout_click", session }. No cookies,
// no IP stored. Unknown shops are ignored. Always answers 204 so the beacon reveals nothing about which shops exist.
import { funnelStore, funnelSteps, type FunnelStep } from '../../../../lib/aimp/funnel/funnel';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (!availability().available) return done;
  const raw = await req.text().catch(() => '');
  if (raw.length > 500) return done;
  let b: { shop?: unknown; slug?: unknown; step?: unknown; session?: unknown };
  try { b = JSON.parse(raw); } catch { return done; }
  if (!funnelSteps.includes(b.step as FunnelStep) || typeof b.session !== 'string') return done;
  let business: string | null = null;
  if (checkBusiness(b.shop)) business = b.shop;
  else if (typeof b.slug === 'string' && b.slug.length < 80) {
    for (const [biz, slug] of runtime().slugs) if (slug === b.slug) { business = biz; break; }
  }
  if (business) funnelStore().record(business, b.step as FunnelStep, b.session, new Date());
  return done;
}

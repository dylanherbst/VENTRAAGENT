// Starts Business Login for Instagram. DEMO LIMIT: the business comes from the query and is checked against the demo runtime; with real
// auth it MUST come from the signed-in owner's session and workspace membership.
import { randomBytes } from 'node:crypto';
import { oauthConfigFromEnv, authorizeUrl } from '../../../../../lib/aimp/setter/oauth';
import { availability, checkBusiness } from '../../../../start/_server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const env = oauthConfigFromEnv(process.env);
  if (!env.ok) return Response.json({ ok: false, message: 'Instagram connection is not set up yet.', missing: env.missing }, { status: 503 });
  const business = new URL(req.url).searchParams.get('business');
  if (!availability().available || !checkBusiness(business)) return Response.json({ ok: false, message: 'Unknown business.' }, { status: 404 });
  const nonce = randomBytes(18).toString('base64url');
  const res = Response.redirect(authorizeUrl(env.cfg, business, nonce, Date.now()), 302);
  const out = new Response(null, { status: 302, headers: res.headers });
  out.headers.append('set-cookie', `aimp_ig_nonce=${nonce}; Path=/api/integrations/instagram; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return out;
}

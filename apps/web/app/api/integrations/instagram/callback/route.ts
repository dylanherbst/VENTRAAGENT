// OAuth callback: verify state + nonce cookie, exchange the code server side, seal the token, save the connection. Auto-send stays off:
// the connection starts with threadOwnershipConfirmed=false and the setter in draft_only.
import { exchangeCode, fetchProfile, oauthConfigFromEnv, checkState } from '../../../../../lib/aimp/setter/oauth';
import { parseKey, seal } from '../../../../../lib/aimp/setter/crypto';
import { defaultConfig } from '../../../../../lib/aimp/setter/pipeline';
import { grantTrial } from '../../../../../lib/aimp/setter/billing';
import { live } from '../../../../start/_server/setter-runtime';

export const dynamic = 'force-dynamic';

const back = (business: string | null, status: string) => Response.redirect(new URL(`/app/${business ?? ''}/setter?connect=${status}`, process.env.INSTAGRAM_REDIRECT_URI ?? 'http://localhost:3000'), 302);

export async function GET(req: Request): Promise<Response> {
  const env = oauthConfigFromEnv(process.env);
  const rt = live();
  const key = parseKey(process.env.SETTER_TOKEN_KEY);
  if (!env.ok || !rt || !key) return Response.json({ ok: false, message: 'Instagram connection is not set up yet.' }, { status: 503 });
  const q = new URL(req.url).searchParams;
  const nonce = /(?:^|;\s*)aimp_ig_nonce=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1] ?? null;
  const ws = checkState(env.cfg, q.get('state'), nonce, Date.now());
  if (!ws) return Response.json({ ok: false, message: 'The sign-in link expired or was not started here. Please try again.' }, { status: 400 });
  if (q.get('error')) return back(ws, 'denied');
  const t = await exchangeCode(env.cfg, q.get('code') ?? '', (u, i) => fetch(u, i));
  if (!t.ok) return back(ws, 'failed');
  if (!t.scopes.includes('instagram_business_manage_messages')) return back(ws, 'missing_permission');
  const me = await fetchProfile(t.accessToken, (u, i) => fetch(u, i), process.env.META_GRAPH_VERSION);
  if (!me.ok) return back(ws, 'failed');
  const saved = rt.store.saveConnection({
    workspaceId: ws, igAccountId: me.igAccountId, username: me.username, tokenSealed: seal(key, t.accessToken),
    tokenExpiresAt: new Date(Date.now() + t.expiresInS * 1000).toISOString(), scopes: t.scopes, status: 'active', threadOwnershipConfirmed: false, connectedAt: new Date().toISOString(),
  });
  if (!saved.ok) return back(ws, 'owned_elsewhere');
  if (!rt.store.config(ws)) rt.store.saveConfig(defaultConfig(ws, new Date()));
  grantTrial(rt.store, ws, new Date().toISOString()); // once per workspace (ledger ref 'trial')
  return back(ws, 'ok');
}

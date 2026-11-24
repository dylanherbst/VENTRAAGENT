// Business Login for Instagram (official OAuth). URLs and params from developers.facebook.com (checked 22 Nov 2026).
import { readSigned, signValue } from './crypto.ts';
import { SCOPES_REQUESTED } from './types.ts';
import type { FetchLike } from './sender.ts';

export interface OAuthConfig { appId: string; appSecret: string; redirectUri: string; stateSecret: string }

export function oauthConfigFromEnv(env: Record<string, string | undefined>): { ok: true; cfg: OAuthConfig } | { ok: false; missing: string[] } {
  const need = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_REDIRECT_URI', 'SETTER_STATE_SECRET'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) return { ok: false, missing };
  return { ok: true, cfg: { appId: env.INSTAGRAM_APP_ID!, appSecret: env.INSTAGRAM_APP_SECRET!, redirectUri: env.INSTAGRAM_REDIRECT_URI!, stateSecret: env.SETTER_STATE_SECRET! } };
}

const STATE_TTL_MS = 10 * 60 * 1000;

/** State binds the workspace and a random nonce (also stored in an httpOnly cookie) and expires in 10 minutes. */
export function authorizeUrl(cfg: OAuthConfig, workspaceId: string, nonce: string, nowMs: number): string {
  const state = signValue(cfg.stateSecret, `${workspaceId}:${nonce}`, nowMs + STATE_TTL_MS);
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES_REQUESTED.join(','));
  u.searchParams.set('state', state);
  u.searchParams.set('enable_fb_login', 'false');
  return u.toString();
}

/** Returns the workspace only if the state is ours, unexpired, and matches the browser's nonce cookie. */
export function checkState(cfg: OAuthConfig, state: string | null, cookieNonce: string | null, nowMs: number): string | null {
  if (!state || !cookieNonce) return null;
  const v = readSigned(cfg.stateSecret, state, nowMs);
  if (!v) return null;
  const i = v.lastIndexOf(':');
  return i > 0 && v.slice(i + 1) === cookieNonce ? v.slice(0, i) : null;
}

export type TokenResult = { ok: true; accessToken: string; userId: string; scopes: string[]; expiresInS: number } | { ok: false; message: string };

/** code -> short-lived token -> long-lived (60 day) token, all server side. */
export async function exchangeCode(cfg: OAuthConfig, rawCode: string, f: FetchLike): Promise<TokenResult> {
  const code = rawCode.replace(/#_$/, '');
  if (!/^[A-Za-z0-9_\-.]{10,1000}$/.test(code)) return { ok: false, message: 'Bad authorization code.' };
  const body = new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code });
  let r1;
  try { r1 = await f('https://api.instagram.com/oauth/access_token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }); } catch { return { ok: false, message: 'Could not reach Instagram.' }; }
  const j1 = (await r1.json().catch(() => ({}))) as { data?: { access_token?: unknown; user_id?: unknown; permissions?: unknown }[] };
  const d = j1.data?.[0];
  if (r1.status !== 200 || typeof d?.access_token !== 'string') return { ok: false, message: 'Instagram did not accept the sign-in.' };
  const scopes = typeof d.permissions === 'string' ? d.permissions.split(',').map((s) => s.trim()) : Array.isArray(d.permissions) ? d.permissions.filter((s): s is string => typeof s === 'string') : [];
  const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: cfg.appSecret, access_token: d.access_token });
  let r2;
  try { r2 = await f(`https://graph.instagram.com/access_token?${q}`, { method: 'GET', headers: {} }); } catch { return { ok: false, message: 'Could not reach Instagram.' }; }
  const j2 = (await r2.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  if (r2.status !== 200 || typeof j2.access_token !== 'string' || typeof j2.expires_in !== 'number') return { ok: false, message: 'Instagram did not give a long-lived token.' };
  return { ok: true, accessToken: j2.access_token, userId: String(d.user_id ?? ''), scopes, expiresInS: j2.expires_in };
}

export async function refreshToken(token: string, f: FetchLike): Promise<{ ok: true; accessToken: string; expiresInS: number } | { ok: false; message: string }> {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  let r;
  try { r = await f(`https://graph.instagram.com/refresh_access_token?${q}`, { method: 'GET', headers: {} }); } catch { return { ok: false, message: 'Could not reach Instagram.' }; }
  const j = (await r.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  return r.status === 200 && typeof j.access_token === 'string' && typeof j.expires_in === 'number' ? { ok: true, accessToken: j.access_token, expiresInS: j.expires_in } : { ok: false, message: 'Refresh failed. The owner must reconnect.' };
}

/** The professional account id and username for a token. UNVERIFIED assumption: `user_id` here is the same id webhooks send as entry[].id
 *  and the send path uses as <IG_ID>. Confirm with the first real connection before enabling auto-send. */
export async function fetchProfile(token: string, f: FetchLike, graphVersion = 'v25.0'): Promise<{ ok: true; igAccountId: string; username: string } | { ok: false }> {
  const q = new URLSearchParams({ fields: 'user_id,username', access_token: token });
  try {
    const r = await f(`https://graph.instagram.com/${graphVersion}/me?${q}`, { method: 'GET', headers: {} });
    const j = (await r.json().catch(() => ({}))) as { user_id?: unknown; username?: unknown };
    const id = typeof j.user_id === 'string' || typeof j.user_id === 'number' ? String(j.user_id) : '';
    return r.status === 200 && /^\d{1,30}$/.test(id) ? { ok: true, igAccountId: id, username: typeof j.username === 'string' ? j.username.slice(0, 60) : '' } : { ok: false };
  } catch { return { ok: false }; }
}

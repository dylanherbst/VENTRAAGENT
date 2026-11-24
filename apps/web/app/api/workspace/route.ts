import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseClient } from '../../../lib/supabase/client';
import { checkedImport, checkedOffer, checkedProfile, uuid } from '../../../lib/workspace-validation';
import { clientKey, routeLimits } from '../../../lib/rate-limit';
import { sameOrigin } from '../../../lib/request-security';
import { readBoundedRequestBody, RequestBodyTooLarge } from '../../../lib/request-body';
import type { Session } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
// O2-3: session cookies are scoped to /api so every authenticated API (workspace, front-office, ...) receives them.
// Cookies set by older builds used /api/workspace; they are expired explicitly so a stale token can't shadow the new one.
const SESSION_COOKIE_PATH = '/api';
const LEGACY_SESSION_COOKIE_PATH = '/api/workspace';
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: SESSION_COOKIE_PATH };
function expireLegacyCookies(out: NextResponse) {
  // Appended after cookies.set/delete: ResponseCookies is keyed by name, so a second same-name entry would replace the first.
  const secure = cookieOptions.secure ? '; Secure' : '';
  for (const name of ['lp-access', 'lp-refresh']) {
    out.headers.append('Set-Cookie', `${name}=; Path=${LEGACY_SESSION_COOKIE_PATH}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Strict${secure}`);
  }
  return out;
}
function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
}
function sessionCookies(out: NextResponse, session: Session | null) {
  if (!session) {
    // Clear with path-matched delete so attributes align with how the cookies were set.
    out.cookies.delete({ name: 'lp-access', ...cookieOptions });
    out.cookies.delete({ name: 'lp-refresh', ...cookieOptions });
    return expireLegacyCookies(out);
  }
  const accessMaxAge = Number.isFinite(session.expires_in) && session.expires_in > 0 ? session.expires_in : 3600;
  out.cookies.set('lp-access', session.access_token, { ...cookieOptions, maxAge: accessMaxAge });
  out.cookies.set('lp-refresh', session.refresh_token, { ...cookieOptions, maxAge: 60 * 60 * 24 * 7 });
  return expireLegacyCookies(out);
}
/**
 * Only business workspaces are listed: lab sandboxes (workspaces.kind = 'lab', migration 202611110001) never appear in a
 * picker. Rows are read with `*` so this works whether or not the database has the kind column yet (without it, no lab
 * can exist); any kind other than 'business' is left out (fails closed). Only id and name are returned.
 */
function businessWorkspaces(rows: unknown): { id: string; name: string }[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    if ('kind' in r && r.kind !== 'business') return [];
    return typeof r.id === 'string' && typeof r.name === 'string' ? [{ id: r.id, name: r.name }] : [];
  });
}
async function handle(req: NextRequest) {
  let renewed: Session | null = null;
  const finish = (body: unknown, status = 200) => {
    const out = response(body, status);
    return renewed ? sessionCookies(out, renewed) : out;
  };
  try {
    if (req.method === 'POST' && (!sameOrigin(req.headers.get('origin'), req.headers.get('host'), req.nextUrl.protocol, process.env.LAUNCHPAD_APP_ORIGIN) || !req.headers.get('content-type')?.startsWith('application/json'))) return response({ error: 'Request origin or content type is invalid.' }, 403);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return response({ error: 'Account storage is not connected yet. Your browser drafts are unchanged.', configured: false }, 503);
    let input: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const raw = await readBoundedRequestBody(req);
      try { input = JSON.parse(raw); } catch { return response({ error: 'Request must contain valid JSON.' }, 400); }
      if (!input || Array.isArray(input) || typeof input !== 'object') return response({ error: 'Invalid request.' }, 400);
    }
    const client = createSupabaseClient();
    if (input.action === 'login' || input.action === 'signup') {
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      // Bound invalid signup/login before calling Auth; never echo provider field details.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) return response({ error: 'Use a valid email and a password of 12–128 characters.' }, 400);
      const attempts = routeLimits.signInByClient(clientKey(req.headers.get('x-forwarded-for')));
      const byEmail = attempts.allowed ? routeLimits.signInByEmail(email.toLowerCase()) : attempts;
      if (!byEmail.allowed) return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429, headers: { 'Cache-Control': 'no-store, private', 'Retry-After': String(byEmail.retryAfterSeconds) } });
      const result = input.action === 'signup' ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) return sessionCookies(response({ error: 'Unable to sign in or create an account. Check your details, email confirmation and try again.' }, 401), null);
      return sessionCookies(response({ signedIn: !!result.data.session, message: result.data.session ? 'Signed in.' : 'Check your email to confirm your account, then sign in.' }), result.data.session);
    }
    const access = req.cookies.get('lp-access')?.value;
    const refresh = req.cookies.get('lp-refresh')?.value;
    // Validate with Auth; never trust a decoded cookie or user-supplied actor ID.
    let actor = access ? await client.auth.getUser(access) : null;
    if ((!actor || actor.error) && refresh) {
      const result = await client.auth.refreshSession({ refresh_token: refresh });
      if (!result.error && result.data.session) {
        renewed = result.data.session;
        actor = await client.auth.getUser(renewed.access_token);
      }
    }
    if (!actor?.data.user || actor.error) return sessionCookies(response({ error: 'Please sign in. Your session may have expired.', signedIn: false }, 401), null);
    const requests = routeLimits.workspaceRequests(actor.data.user.id);
    if (!requests.allowed) return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429, headers: { 'Cache-Control': 'no-store, private', 'Retry-After': String(requests.retryAfterSeconds) } });
    const token = renewed?.access_token ?? access!;
    const db = createSupabaseClient({ fetch: (url, init) => {
      const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers, cache: 'no-store' });
    } });
    if (input.action === 'logout') {
      // Revoke with the user JWT via GoTrue /logout (same path GoTrueClient uses internally).
      // No service-role secret is involved; cookies are cleared only after Auth accepts revoke.
      const { error } = await db.auth.admin.signOut(token, 'local');
      if (error) return finish({ error: 'Sign-out could not be confirmed. Please retry.' }, 502);
      return sessionCookies(response({ signedIn: false, message: 'Signed out.' }), null);
    }
    // DB checks Auth session existence as well as current membership on every call.
    const active = await db.rpc('session_active');
    if (active.error) return finish({ error: 'Account storage is unavailable. Please retry.', signedIn: true }, 503);
    if (!active.data) return sessionCookies(response({ error: 'Session revoked. Sign in again.', signedIn: false }, 401), null);
    if (req.method === 'GET') {
      const listed = await db.from('workspaces').select('*');
      if (listed.error) return finish({ error: 'Unable to load workspaces. Please retry.' }, 503);
      const workspaces = { data: businessWorkspaces(listed.data) };
      const w = req.nextUrl.searchParams.get('workspace');
      if (!w) return finish({ signedIn: true, workspaces: workspaces.data });
      uuid(w);
      // A lab sandbox is never opened as a business workspace here (same answer as a non-member).
      if (!workspaces.data.some(x => x.id === w)) return finish({ error: 'Workspace access is unavailable.' }, 403);
      const member = await db.from('memberships').select('role').eq('workspace_id', w).eq('user_id', actor.data.user.id).eq('active', true).maybeSingle();
      if (member.error || !member.data) return finish({ error: 'Workspace access is unavailable.' }, 403);
      const [profile, offers] = await Promise.all([db.from('business_profiles').select('data,revision').eq('workspace_id', w).maybeSingle(), db.from('offers').select('id,data,revision').eq('workspace_id', w).order('id')]);
      if (profile.error || offers.error) return finish({ error: 'Unable to load saved work. Please retry.' }, 503);
      return finish({ signedIn: true, workspaces: workspaces.data, role: member.data.role, profile: profile.data, offers: offers.data });
    }
    if (input.action === 'createWorkspace') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 160) return finish({ error: 'Workspace name must be 1–160 characters.' }, 400);
      const result = await db.rpc('create_workspace', { workspace_name: name });
      return result.error ? finish({ error: 'Unable to create workspace. Please retry.' }, 409) : finish({ workspace: result.data });
    }
    const w = uuid(input.workspace);
    const role = await db.rpc('workspace_role', { w });
    if (role.error || role.data !== 'owner') return finish({ error: 'Only an active workspace owner may save or import. Staff have read-only access.' }, 403);
    let result;
    if (input.action === 'import') {
      const payload = checkedImport(input.payload);
      result = await db.rpc('import_drafts', { w, payload });
    } else if (input.action === 'profile') {
      const payload = checkedProfile(input.profile);
      if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new Error('Refresh before saving.');
      result = await db.rpc('save_profile', { w, payload, expected_revision: input.revision });
    } else if (input.action === 'offer') {
      const profile = await db.from('business_profiles').select('data').eq('workspace_id', w).single();
      if (profile.error) return finish({ error: 'Save a business profile first.' }, 409);
      const payload = checkedOffer(input.offer, checkedProfile(profile.data.data));
      if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new Error('Refresh before saving.');
      result = await db.rpc('save_offer', { w, offer_id: uuid(input.id), payload, expected_revision: input.revision });
    } else return finish({ error: 'Unknown action.' }, 400);
    return result.error ? finish({ error: 'Save was not committed. The workspace may have changed or an import conflicts. Refresh and retry; browser drafts are unchanged.' }, 409) : finish({ saved: true, result: result.data });
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return response({ error: error.message }, 413);
    // Validation errors are safe; provider/internal messages and credentials are never returned.
    const message = error instanceof Error && /^(Complete a valid|Business fields|Offer is invalid|Import |Duplicate local|Choose a valid|Refresh before)/.test(error.message) ? error.message : 'Unable to complete this request. Please retry.';
    return finish({ error: message }, 400);
  }
}
export const GET = handle;
export const POST = handle;

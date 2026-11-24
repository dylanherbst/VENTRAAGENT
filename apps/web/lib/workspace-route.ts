import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSupabaseClient } from './supabase/client';
import { apiError } from './api-errors';
import type { ApiErrorCode } from './api-errors';
import { uuid } from './workspace-validation';
import type { workspaceLimits } from './rate-limit';

// Shared plumbing for the read-only /api/workspace/* routes (team, export, search, activity). Behaviour matches what each route did inline:
// config check, cookie, Auth user, per-user rate limit, session_active, then RLS-backed reads under the caller's own token. No service key.
export const privateHeaders = { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export function apiReply(code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const { body, status } = apiError(code, message, extra);
  return NextResponse.json(body, { status, headers: { ...privateHeaders, ...headers } });
}
export const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type Db = ReturnType<typeof createSupabaseClient>;
export type OpenedWorkspace = { db: Db; userId: string; workspace: string };
type Messages = { signedOut: string };

/** Step 1: configuration and cookie. Returns the access token or a ready error response. */
export function preflight(req: NextRequest, messages: Messages): { token: string } | NextResponse {
  if (!supabaseConfigured()) return apiReply('not_configured', 'Account storage is not connected yet.', { configured: false });
  const token = req.cookies.get('lp-access')?.value;
  if (!token) return apiReply('signed_out', messages.signedOut, { signedIn: false });
  return { token };
}
/** Step 2: workspace id, Auth user, rate limit, live session. Any failure is a ready, safe response. */
export async function openWorkspace(req: NextRequest, token: string, limiter: typeof workspaceLimits[keyof typeof workspaceLimits]): Promise<OpenedWorkspace | NextResponse> {
  let workspace: string;
  try { workspace = uuid(req.nextUrl.searchParams.get('workspace')); } catch { return apiReply('invalid_request', 'Choose a valid workspace.'); }
  try {
    const auth = await createSupabaseClient().auth.getUser(token);
    if (auth.error || !auth.data.user) return apiReply('signed_out', 'Sign in again.', { signedIn: false });
    const rate = limiter(auth.data.user.id);
    if (!rate.allowed) return apiReply('rate_limited', 'Too many requests. Try again shortly.', {}, { 'Retry-After': String(rate.retryAfterSeconds) });
    const db = createSupabaseClient({ fetch: (url, init) => { const h = new Headers(init?.headers); h.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers: h, cache: 'no-store' }); } });
    const active = await db.rpc('session_active');
    if (active.error) return apiReply('storage_unavailable', 'Account storage is unavailable. Please retry.');
    if (!active.data) return apiReply('session_revoked', 'Session revoked. Sign in again.', { signedIn: false });
    return { db, userId: auth.data.user.id, workspace };
  } catch { return apiReply('invalid_request', 'Invalid request.'); }
}
/** RLS hides other workspaces and returns an empty list, so an empty result must be checked against membership. Null means the caller is a member. */
export async function requireMembership(ws: OpenedWorkspace, failMessage: string): Promise<NextResponse | null> {
  const member = await ws.db.from('memberships').select('user_id').eq('workspace_id', ws.workspace).eq('user_id', ws.userId).eq('active', true);
  if (member.error) return apiReply('storage_unavailable', failMessage);
  if (!member.data?.length) return apiReply('no_workspace_access', 'Workspace access is unavailable.');
  return null;
}
export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;

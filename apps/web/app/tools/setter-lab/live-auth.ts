// Server-only helpers for the Setter Lab "Live AI Test" action (task A-23b). Not a 'use server' module on purpose:
// nothing here is callable from the browser. actions.ts reads the session cookie and passes the token in.
//
// The caller for runLiveLabTurn is built ONLY from a Supabase user verified on the server: auth.getUser(token) and the
// session_active RPC under the caller's own token (same checks as lib/workspace-route.ts). No userId from the client.
import { createSupabaseClient } from '../../../lib/supabase/client';
import { LIVE_NEEDS_USER, LIVE_NOT_CONFIGURED } from '../../../lib/front-office/setter/lab-live';
import type { LabCaller } from '../../../lib/front-office/setter/lab-live';

export const SIGN_IN_FOR_LIVE = 'Sign in to use Live AI Test. Demo mode works without signing in.';
export const ACCOUNT_NOT_CONNECTED = 'Sign in to use Live AI Test. Account sign-in is not connected on this server yet, so only Demo mode works.';
export const SIGN_IN_CHECK_FAILED = 'Could not check your sign-in right now. Try again, or use Demo mode.';
export const LIVE_FAILED = 'Live AI Test failed. Try again, or use Demo mode.';

/** Live AI connection state as the page shows it. Known only from what the last live call returned (no env in the client). */
export type LiveAiState = 'unknown' | 'configured' | 'not_configured';
export type CallerResult = { caller: LabCaller; error: null } | { caller: null; error: string };

type AuthClient = { auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> } };
type SessionClient = { rpc(name: 'session_active'): PromiseLike<{ data: unknown; error: unknown }> };
export type VerifyDeps = {
  configured?: () => boolean;
  authClient?: () => AuthClient;
  sessionClient?: (token: string) => SessionClient;
};

const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const defaultSessionClient = (token: string): SessionClient => createSupabaseClient({
  fetch: (url, init) => { const h = new Headers(init?.headers); h.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers: h, cache: 'no-store' }); },
});

/** Maps a session token (from the httpOnly lp-access cookie, read on the server) to a verified caller or a plain error. */
export async function verifiedCaller(token: string | undefined | null, deps: VerifyDeps = {}): Promise<CallerResult> {
  if (!(deps.configured ?? supabaseConfigured)()) return { caller: null, error: ACCOUNT_NOT_CONNECTED };
  if (typeof token !== 'string' || !token) return { caller: null, error: SIGN_IN_FOR_LIVE };
  try {
    const auth = await (deps.authClient ?? (() => createSupabaseClient() as unknown as AuthClient))().auth.getUser(token);
    const id = auth.data?.user?.id;
    if (auth.error || typeof id !== 'string' || !id) return { caller: null, error: SIGN_IN_FOR_LIVE };
    const active = await (deps.sessionClient ?? defaultSessionClient)(token).rpc('session_active');
    if (active.error) return { caller: null, error: SIGN_IN_CHECK_FAILED };
    if (active.data !== true) return { caller: null, error: SIGN_IN_FOR_LIVE };
    return { caller: { userId: id }, error: null };
  } catch { return { caller: null, error: SIGN_IN_CHECK_FAILED }; }
}

/** Plain-English message and the Live AI state for an error thrown by runLiveLabTurn. Unknown errors become a generic
 * message so nothing unexpected reaches the browser. */
export function liveError(e: unknown): { error: string; liveAi: LiveAiState } {
  const msg = e instanceof Error ? e.message : '';
  if (msg === LIVE_NEEDS_USER) return { error: SIGN_IN_FOR_LIVE, liveAi: 'unknown' };
  if (msg === LIVE_NOT_CONFIGURED) return { error: LIVE_NOT_CONFIGURED, liveAi: 'not_configured' };
  if (msg.startsWith("Today's Live AI Test limit")) return { error: msg.slice(0, 300), liveAi: 'configured' };
  return { error: LIVE_FAILED, liveAi: 'unknown' };
}

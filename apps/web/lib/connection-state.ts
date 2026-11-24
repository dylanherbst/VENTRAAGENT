export type ConnectionState = { mode: 'DEMO' | 'LIVE'; label: string; detail: string };

// Maps the real response of GET /api/workspace to an honest indicator. Never reports LIVE unless a signed-in session was verified.
export function accountConnection(status: number | null, body: unknown): ConnectionState {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (status === 200 && b.signedIn === true) return { mode: 'LIVE', label: 'Account connected', detail: 'Signed in. Account saves use your workspace.' };
  if (status === 401) return { mode: 'DEMO', label: 'Account reachable, signed out', detail: 'Sign in to save to your account. Browser drafts still work.' };
  if (status === 503 && b.configured === false) return { mode: 'DEMO', label: 'Account storage not connected', detail: 'Supabase is not configured here. Work is saved in this browser only.' };
  if (status === null) return { mode: 'DEMO', label: 'Account status unknown', detail: 'Could not reach the account service. Browser drafts are unchanged.' };
  return { mode: 'DEMO', label: 'Account unavailable', detail: 'The account service returned an error. Browser drafts are unchanged.' };
}

import { NextRequest, NextResponse } from 'next/server';
import { integrationStatus } from '../../../../lib/integration-status';
import { createRateLimiter } from '../../../../lib/rate-limit';
import { createSupabaseClient } from '../../../../lib/supabase/client';
import { SIGN_IN_MESSAGE, statusRateKey } from '../../../../lib/status-access';
export const dynamic = 'force-dynamic';
// Exposes no secret: only states and plain-English text. Rate limited so it cannot be used to amplify probes.
const limit = createRateLimiter(30, 60_000);

function probeAllowed(raw: string | undefined): URL | null {
  try {
    const u = new URL(raw ?? '');
    if (u.username || u.password) return null;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u;
  } catch { /* not a URL */ }
  return null;
}
async function supabaseHealth(raw: string | undefined): Promise<'ok' | 'failed' | 'skipped'> {
  const base = probeAllowed(raw);
  if (!base) return 'skipped';
  try {
    const res = await fetch(`${base.origin}/auth/v1/health`, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(1500), headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '' } });
    return res.status === 200 ? 'ok' : 'failed';
  } catch { return 'failed'; }
}
export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
  const signedOut = () => NextResponse.json({ error: SIGN_IN_MESSAGE, signedIn: false }, { status: 401, headers });
  const env = process.env;
  const token = req.cookies.get('lp-access')?.value;
  if (!token || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return signedOut();
  let userId: string;
  try {
    const auth = await createSupabaseClient().auth.getUser(token);
    if (auth.error || !auth.data.user) return signedOut();
    userId = auth.data.user.id;
    const db = createSupabaseClient({ fetch: (url, init) => { const h = new Headers(init?.headers); h.set('Authorization', 'Bearer ' + token); return fetch(url, { ...init, headers: h, cache: 'no-store' }); } });
    const active = await db.rpc('session_active');
    if (active.error) return NextResponse.json({ error: 'Account storage is unavailable. Please retry.' }, { status: 503, headers });
    if (!active.data) return signedOut();
  } catch { return signedOut(); }
  const rate = limit(statusRateKey(userId, req.headers.get('x-forwarded-for')));
  if (!rate.allowed) return NextResponse.json({ error: 'Too many checks. Try again shortly.' }, { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } });
  const probe = await supabaseHealth(env.NEXT_PUBLIC_SUPABASE_URL);
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'OPENAI_API_KEY', 'OPENAI_MODEL'] as const;
  const items = integrationStatus(Object.fromEntries(names.map(n => [n, env[n]])), { supabaseHealth: probe });
  return NextResponse.json({ checkedAt: new Date().toISOString(), items }, { headers });
}

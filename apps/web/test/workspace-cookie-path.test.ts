// O2-3: session cookies must reach every authenticated API (e.g. /api/front-office/*), not only /api/workspace.
// Cookies left by older builds at Path=/api/workspace are expired so a stale token never shadows the new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { USER, call, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';

const { GET, POST } = await import('../app/api/workspace/route.ts');
const ORIGIN = 'http://localhost:3000';
const cookieLines = (h: Headers) => h.getSetCookie();
const find = (lines: string[], name: string, path: string) => lines.find(l => l.startsWith(name + '=') && new RegExp(`Path=${path.replace(/\//g, '\\/')}(;|$)`, 'i').test(l));

test('sign-in sets lp-access and lp-refresh at Path=/api and expires the legacy /api/workspace cookies', async () => {
  const restoreEnv = setEnv({ ...configuredEnv, LAUNCHPAD_APP_ORIGIN: ORIGIN });
  const fake = installFakeSupabase();
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/auth/v1/token') {
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer',
        user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    const req = makeRequest('/api/workspace', { method: 'POST', cookie: null, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.1' },
      body: JSON.stringify({ action: 'login', email: 'cookie-path@example.com', password: 'a-long-enough-password' }) });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const lines = cookieLines(res.headers);
    assert.match(find(lines, 'lp-access', '/api') ?? '', /^lp-access=new-access;/);
    assert.match(find(lines, 'lp-refresh', '/api') ?? '', /^lp-refresh=new-refresh;/);
    for (const l of lines.filter(x => /Path=\/api(;|$)/i.test(x))) { assert.match(l, /HttpOnly/i); assert.match(l, /SameSite=Strict/i); }
    for (const name of ['lp-access', 'lp-refresh']) assert.match(find(lines, name, '/api/workspace') ?? '', /Max-Age=0/i, `${name} legacy cookie expired`);
  } finally { globalThis.fetch = inner; fake.restore(); restoreEnv(); }
});

test('an invalid session clears the cookies at both the new and the legacy path', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ authUser: 'invalid' });
  try {
    const r = await call(GET, '/api/workspace');
    assert.equal(r.status, 401);
    const lines = cookieLines(r.headers);
    for (const name of ['lp-access', 'lp-refresh']) {
      assert.ok(find(lines, name, '/api'), `${name} cleared at /api`);
      assert.match(find(lines, name, '/api/workspace') ?? '', /Max-Age=0/i, `${name} cleared at /api/workspace`);
    }
  } finally { fake.restore(); restoreEnv(); }
});

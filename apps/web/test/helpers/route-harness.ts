import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server.js';

// Next route files use extensionless relative imports (bundler resolution); Node needs the extension, and next/server needs .js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.startsWith('file:')) {
      for (const ext of ['.ts', '/index.ts']) {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});

export const W = '11111111-1111-4111-8111-111111111111';
export const USER = '22222222-2222-4222-8222-222222222222';
export const BASE = 'http://localhost:3000';
export const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'LAUNCHPAD_APP_ORIGIN'] as const;

export type FakeOptions = {
  authUser?: 'ok' | 'invalid' | 'down';
  sessionActive?: boolean | 'error';
  rpc?: Record<string, { status?: number; body: unknown }>;
  tables?: Record<string, unknown[] | 'error'>;
};
export type FakeCall = { method: string; path: string; search: string };

/** Fake global fetch that emulates the Supabase endpoints the routes use. Returns the call log and a restore function. */
export function installFakeSupabase(opts: FakeOptions = {}) {
  const real = globalThis.fetch;
  const calls: FakeCall[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    calls.push({ method, path: url.pathname, search: url.search });
    if (url.pathname === '/auth/v1/user') {
      if (opts.authUser === 'down') throw new TypeError('fetch failed');
      if (opts.authUser === 'invalid') return json(401, { code: 401, msg: 'invalid JWT' });
      return json(200, { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.slice('/rest/v1/rpc/'.length);
      if (name === 'session_active') {
        if (opts.sessionActive === 'error') return json(500, { message: 'boom' });
        return json(200, opts.sessionActive ?? true);
      }
      const r = opts.rpc?.[name];
      return r ? json(r.status ?? 200, r.body) : json(404, { message: 'no such rpc' });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      const rows = opts.tables?.[table];
      if (rows === 'error') return json(500, { message: 'boom' });
      return json(200, rows ?? []);
    }
    if (url.pathname === '/auth/v1/health') return json(200, { ok: true });
    return json(404, {});
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** Sets or clears the Supabase env for a test and returns a restore function. */
export function setEnv(values: Partial<Record<typeof ENV_KEYS[number], string | undefined>>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}
export const configuredEnv = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' };

export function makeRequest(path: string, init: { method?: string; cookie?: string | null; headers?: Record<string, string>; body?: string } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (init.cookie !== null) headers.set('cookie', 'lp-access=' + (init.cookie ?? 'token-abc'));
  if (!headers.has('host')) headers.set('host', 'localhost:3000');
  return new NextRequest(BASE + path, { method: init.method ?? 'GET', headers, body: init.body });
}
type Handler = (req: NextRequest) => Promise<Response>;
export async function call(handler: Handler, path: string, init?: Parameters<typeof makeRequest>[1]) {
  const res = await handler(makeRequest(path, init));
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: Record<string, any> = {};
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body, text };
}

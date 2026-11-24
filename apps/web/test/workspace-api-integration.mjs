// REAL application HTTP API cookie lifecycle against an isolated loopback Next server + local Supabase.
// Does not claim PGlite fixture coverage. Expects a managed server (see scripts/s01-api-integration).
// TEST_SUPABASE_SECRET_KEY is required for staff fixtures and must arrive only via the test process env.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertLoopbackHttpUrl } from '../lib/loopback-url.ts';

const base = process.env.TEST_APP_ORIGIN;
const supabaseUrl = process.env.TEST_SUPABASE_URL;
const publishable = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.TEST_SUPABASE_SECRET_KEY;
if (!base || !supabaseUrl || !publishable) {
  console.error('BLOCKED: set TEST_APP_ORIGIN, TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY (loopback only). No API integration checks ran.');
  process.exit(2);
}
if (!secret) {
  console.error('BLOCKED: TEST_SUPABASE_SECRET_KEY required for staff membership fixtures (local admin only). Suite incomplete — exit 2.');
  process.exit(2);
}
let origin;
try {
  origin = assertLoopbackHttpUrl(base, 'TEST_APP_ORIGIN').origin;
  assertLoopbackHttpUrl(supabaseUrl, 'TEST_SUPABASE_URL');
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const suffix = randomUUID();
const emailA = `api-a-${suffix}@example.invalid`;
const emailB = `api-b-${suffix}@example.invalid`;
const passwordA = randomBytes(24).toString('base64url');
const passwordB = randomBytes(24).toString('base64url');
const authOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Minimal cookie jar scoped to /api/workspace path semantics. */
function createJar() {
  const map = new Map();
  const attrs = new Map();
  return {
    store(res) {
      const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      const fallback = res.headers.get('set-cookie');
      const lines = raw.length ? raw : fallback ? [fallback] : [];
      for (const line of lines) {
        const [pair, ...directives] = line.split(';').map((p) => p.trim());
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const meta = Object.fromEntries(directives.map((d) => {
          const i = d.indexOf('=');
          return i < 0 ? [d.toLowerCase(), true] : [d.slice(0, i).toLowerCase(), d.slice(i + 1)];
        }));
        const cleared = meta['max-age'] === '0' || /^Thu, 01 Jan 1970/i.test(String(meta.expires || '')) || value === '';
        if (cleared) {
          map.delete(name);
          attrs.delete(name);
        } else {
          map.set(name, value);
          attrs.set(name, meta);
        }
      }
    },
    header() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    get(name) { return map.get(name); },
    attr(name) { return attrs.get(name); },
    snapshot() { return { map: new Map(map), attrs: new Map(attrs) }; },
    restore(snap) {
      map.clear(); attrs.clear();
      for (const [k, v] of snap.map) map.set(k, v);
      for (const [k, v] of snap.attrs) attrs.set(k, v);
    },
    clear() { map.clear(); attrs.clear(); },
  };
}

function assertSessionCookieAttrs(jar, name, { secure }) {
  const meta = jar.attr(name);
  assert.ok(meta, `${name} Set-Cookie attributes missing`);
  assert.equal(meta.httponly, true, `${name} must be HttpOnly`);
  assert.equal(String(meta.samesite).toLowerCase(), 'strict', `${name} must be SameSite=Strict`);
  assert.equal(meta.path, '/api/workspace', `${name} path must be /api/workspace`);
  if (secure) assert.equal(meta.secure, true, `${name} must be Secure in production NODE_ENV`);
  else assert.equal(meta.secure, undefined, `${name} must not set Secure outside production`);
}

async function api(jar, { method = 'GET', body, workspace } = {}) {
  const url = new URL('/api/workspace', origin);
  if (workspace) url.searchParams.set('workspace', workspace);
  const headers = { Accept: 'application/json' };
  const cookie = jar.header();
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Origin = origin;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  jar.store(res);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: 'non-json', raw: text }; }
  return { res, data };
}

const profile = {
  version: 1, id: 'local-business', name: 'API studio', primary: 'education', pathways: ['education'],
  stage: 'idea', industry: '', location: '', audience: 'Designers', goal: 'Teach', expertise: 'Design',
  educationOffer: 'Course', businessType: 'Physical services', website: '', channels: '', completed: [], toolNotes: {},
};
const offerId = randomUUID();
const offer = {
  version: 1, id: offerId, profileId: 'local-business', name: 'Workshop', audience: 'Designers',
  outcome: 'Ship', delivery: 'Live', kind: 'education', currency: 'AUD', amountMinor: 5000,
};

const jarA = createJar();
const jarB = createJar();
const expectSecure = process.env.NODE_ENV === 'production';

try {
  // Invalid signup → no session; then valid signup recovers on a clean jar.
  const recoveryJar = createJar();
  const bad = await api(recoveryJar, { method: 'POST', body: { action: 'signup', email: 'not-an-email', password: 'short' } });
  assert.equal(bad.res.status, 400);
  assert.equal(recoveryJar.get('lp-access'), undefined);
  assert.equal(recoveryJar.get('lp-refresh'), undefined);
  const recovered = await api(recoveryJar, {
    method: 'POST',
    body: { action: 'signup', email: `recover-${suffix}@example.invalid`, password: randomBytes(24).toString('base64url') },
  });
  assert.equal(recovered.res.status, 200, recovered.data.error);
  assert.equal(recovered.data.signedIn, true);
  assert.ok(recoveryJar.get('lp-access'));
  await api(recoveryJar, { method: 'POST', body: { action: 'logout' } });

  const signupA = await api(jarA, { method: 'POST', body: { action: 'signup', email: emailA, password: passwordA } });
  assert.equal(signupA.res.status, 200, signupA.data.error);
  assert.equal(signupA.data.signedIn, true);
  assert.ok(jarA.get('lp-access'));
  assert.ok(jarA.get('lp-refresh'));
  assertSessionCookieAttrs(jarA, 'lp-access', { secure: expectSecure });
  assertSessionCookieAttrs(jarA, 'lp-refresh', { secure: expectSecure });

  const signupB = await api(jarB, { method: 'POST', body: { action: 'signup', email: emailB, password: passwordB } });
  assert.equal(signupB.res.status, 200, signupB.data.error);
  assert.equal(signupB.data.signedIn, true);

  // Foreign Origin denied.
  const foreign = await fetch(new URL('/api/workspace', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.invalid', Cookie: jarA.header() },
    body: JSON.stringify({ action: 'createWorkspace', name: 'nope' }),
  });
  assert.equal(foreign.status, 403);

  const created = await api(jarA, { method: 'POST', body: { action: 'createWorkspace', name: `API A ${suffix}` } });
  assert.equal(created.res.status, 200, created.data.error);
  const workspaceA = created.data.workspace;
  assert.ok(workspaceA);

  const createdB = await api(jarB, { method: 'POST', body: { action: 'createWorkspace', name: `API B ${suffix}` } });
  assert.equal(createdB.res.status, 200, createdB.data.error);
  const workspaceB = createdB.data.workspace;

  const saveProfile = await api(jarA, { method: 'POST', body: { action: 'profile', workspace: workspaceA, profile, revision: 0 } });
  assert.equal(saveProfile.res.status, 200, saveProfile.data.error);
  const saveOffer = await api(jarA, { method: 'POST', body: { action: 'offer', workspace: workspaceA, id: offerId, offer, revision: 0 } });
  assert.equal(saveOffer.res.status, 200, saveOffer.data.error);

  const stale = await api(jarA, { method: 'POST', body: { action: 'offer', workspace: workspaceA, id: offerId, offer: { ...offer, amountMinor: 1 }, revision: 0 } });
  assert.equal(stale.res.status, 409);

  const loaded = await api(jarA, { workspace: workspaceA });
  assert.equal(loaded.res.status, 200, loaded.data.error);
  assert.equal(loaded.data.role, 'owner');
  assert.equal(loaded.data.offers?.[0]?.data?.amountMinor, 5000);
  assert.equal(loaded.data.offers?.[0]?.revision, 1);

  // Cross-workspace isolation before staff grant.
  assert.equal((await api(jarB, { workspace: workspaceA })).res.status, 403);
  assert.equal((await api(jarB, { method: 'POST', body: { action: 'offer', workspace: workspaceA, id: offerId, offer, revision: 1 } })).res.status, 403);

  // Staff fixture: resolve B from existing access cookie — no extra login session.
  const admin = createClient(supabaseUrl, secret, authOpts);
  const accessB = jarB.get('lp-access');
  assert.ok(accessB);
  const identity = createClient(supabaseUrl, publishable, authOpts);
  const userB = await identity.auth.getUser(accessB);
  assert.ifError(userB.error);
  assert.ok(userB.data.user?.id);
  assert.ifError((await admin.from('memberships').insert({
    workspace_id: workspaceA, user_id: userB.data.user.id, role: 'staff', active: true,
  })).error);

  const staffRead = await api(jarB, { workspace: workspaceA });
  assert.equal(staffRead.res.status, 200, staffRead.data.error);
  assert.equal(staffRead.data.role, 'staff');
  assert.equal(staffRead.data.offers?.length, 1);
  assert.equal((await api(jarB, { method: 'POST', body: { action: 'offer', workspace: workspaceA, id: offerId, offer: { ...offer, amountMinor: 9 }, revision: 1 } })).res.status, 403);

  // Import into empty workspace B as owner B — must succeed and be idempotent (no 401 tolerance).
  const importPayload = { profile, offers: [offer] };
  const imported = await api(jarB, { method: 'POST', body: { action: 'import', workspace: workspaceB, payload: importPayload } });
  assert.equal(imported.res.status, 200, imported.data.error);
  assert.equal(imported.data.saved, true);
  assert.equal(imported.data.result, 'imported');
  const importedAgain = await api(jarB, { method: 'POST', body: { action: 'import', workspace: workspaceB, payload: importPayload } });
  assert.equal(importedAgain.res.status, 200, importedAgain.data.error);
  assert.equal(importedAgain.data.result, 'already_imported');
  const loadB = await api(jarB, { workspace: workspaceB });
  assert.equal(loadB.res.status, 200, loadB.data.error);
  assert.equal(loadB.data.offers?.length, 1);
  const overwrite = await api(jarB, {
    method: 'POST',
    body: { action: 'import', workspace: workspaceB, payload: { profile, offers: [{ ...offer, id: randomUUID(), amountMinor: 1 }] } },
  });
  assert.equal(overwrite.res.status, 409);
  assert.equal((await api(jarB, { workspace: workspaceB })).data.offers?.[0]?.data?.amountMinor, 5000);

  // Anonymous denial.
  assert.equal((await api(createJar(), { workspace: workspaceA })).res.status, 401);

  // Duplicate signup via API: local Auth 422 → route returns 401, no session cookies.
  const dupJar = createJar();
  const dup = await api(dupJar, { method: 'POST', body: { action: 'signup', email: emailA, password: passwordA } });
  assert.equal(dup.res.status, 401);
  assert.equal(typeof dup.data.error, 'string');
  assert.equal(dupJar.get('lp-access'), undefined);
  assert.equal(dupJar.get('lp-refresh'), undefined);

  // Logout clears cookies; retained access-only cookie (no refresh) must be denied after revoke.
  const retained = jarA.snapshot();
  const logout = await api(jarA, { method: 'POST', body: { action: 'logout' } });
  assert.equal(logout.res.status, 200, logout.data.error);
  assert.equal(jarA.get('lp-access'), undefined);
  assert.equal(jarA.get('lp-refresh'), undefined);
  assert.equal((await api(jarA)).res.status, 401);

  const accessOnly = createJar();
  accessOnly.restore({ map: new Map([['lp-access', retained.map.get('lp-access')]]), attrs: new Map() });
  assert.equal((await api(accessOnly, { workspace: workspaceA })).res.status, 401);

  const revokedJar = createJar();
  revokedJar.restore(retained);
  assert.equal((await api(revokedJar, { workspace: workspaceA })).res.status, 401);

  // Relogin restores persistence.
  const login = await api(jarA, { method: 'POST', body: { action: 'login', email: emailA, password: passwordA } });
  assert.equal(login.res.status, 200, login.data.error);
  assert.ok(jarA.get('lp-access'));
  const again = await api(jarA, { workspace: workspaceA });
  assert.equal(again.res.status, 200, again.data.error);
  assert.equal(again.data.offers?.[0]?.data?.amountMinor, 5000);

  console.log('PASS: REAL application HTTP API cookie lifecycle — invalid→valid recovery, cookie attrs, signup/login, origin denial, save/load, stale revision, cross-workspace isolation, staff read-only, import success/idempotent/no-overwrite, duplicate 401, access-only revoke denial, relogin.');
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally {
  for (const jar of [jarA, jarB]) {
    if (jar.get('lp-access') || jar.get('lp-refresh')) {
      try { await api(jar, { method: 'POST', body: { action: 'logout' } }); }
      catch { /* best-effort */ }
    }
    jar.clear();
  }
}

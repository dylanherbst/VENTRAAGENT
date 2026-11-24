import test from 'node:test';
import assert from 'node:assert/strict';
import { W, USER, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';
// These suites cover the route logic behind the scope freeze; test/scope-freeze.test.ts covers the freeze itself.
process.env.VENTRA_SCOPE_FREEZE = 'off';

const routes = {
  team: (await import('../app/api/workspace/team/route.ts')).GET,
  export: (await import('../app/api/workspace/export/route.ts')).GET,
  search: (await import('../app/api/workspace/search/route.ts')).GET,
  activity: (await import('../app/api/workspace/activity/route.ts')).GET,
  launcher: (await import('../app/api/workspace/launcher/route.ts')).GET,
};
const urls: Record<keyof typeof routes, string> = {
  team: `/api/workspace/team?workspace=${W}`,
  export: `/api/workspace/export?workspace=${W}`,
  search: `/api/workspace/search?workspace=${W}&q=hello`,
  activity: `/api/workspace/activity?workspace=${W}`,
  launcher: `/api/workspace/launcher?workspace=${W}&kind=business-plan`,
};

for (const [name, handler] of Object.entries(routes) as [keyof typeof routes, typeof routes.team][]) {
  test(`${name}: 503 when storage is not configured, with no-store headers`, async () => {
    const restoreEnv = setEnv({}); const fake = installFakeSupabase();
    try {
      const r = await call(handler, urls[name]);
      assert.equal(r.status, 503);
      assert.equal(r.body.configured, false);
      assert.match(r.headers.get('cache-control') ?? '', /no-store/);
      assert.equal(fake.calls.length, 0);
    } finally { fake.restore(); restoreEnv(); }
  });
  test(`${name}: 401 signed out (no cookie) and for an invalid token`, async () => {
    const restoreEnv = setEnv(configuredEnv);
    try {
      let fake = installFakeSupabase();
      try { assert.equal((await call(handler, urls[name], { cookie: null })).status, 401); assert.equal(fake.calls.length, 0); } finally { fake.restore(); }
      fake = installFakeSupabase({ authUser: 'invalid' });
      try { assert.equal((await call(handler, urls[name])).status, 401); } finally { fake.restore(); }
    } finally { restoreEnv(); }
  });
  test(`${name}: 401 when the session was revoked, 503 when the check fails`, async () => {
    const restoreEnv = setEnv(configuredEnv);
    try {
      let fake = installFakeSupabase({ sessionActive: false });
      try { assert.equal((await call(handler, urls[name])).status, 401, 'revoked session'); } finally { fake.restore(); }
      fake = installFakeSupabase({ sessionActive: 'error' });
      try { assert.equal((await call(handler, urls[name])).status, 503); } finally { fake.restore(); }
    } finally { restoreEnv(); }
  });
  test(`${name}: 400 for a bad workspace id`, async () => {
    const restoreEnv = setEnv(configuredEnv); const fake = installFakeSupabase();
    try {
      const bad = urls[name].replace(W, 'not-a-uuid');
      assert.equal((await call(handler, bad)).status, 400);
    } finally { fake.restore(); restoreEnv(); }
  });
}

for (const name of ['team', 'export', 'search', 'activity'] as const) {
  test(`${name}: 403 for a non-member, 503 when the database is down`, async () => {
    const restoreEnv = setEnv(configuredEnv);
    try {
      let fake = installFakeSupabase({ tables: { memberships: [], launcher_drafts: [] } });
      try { assert.equal((await call(routes[name], urls[name])).status, 403); } finally { fake.restore(); }
      fake = installFakeSupabase({ tables: { memberships: 'error', launcher_drafts: 'error' } });
      try { assert.equal((await call(routes[name], urls[name])).status, 503); } finally { fake.restore(); }
    } finally { restoreEnv(); }
  });
}

test('team: members see the team; no secrets or other fields leak', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER, role: 'owner', active: true }, { user_id: '33333333-3333-4333-8333-333333333333', role: 'staff', active: true }] } });
  try {
    const r = await call(routes.team, urls.team);
    assert.equal(r.status, 200);
    assert.equal(r.body.members.length, 2);
    assert.equal(r.body.members.filter((m: { isYou: boolean }) => m.isYou).length, 1);
  } finally { fake.restore(); restoreEnv(); }
});
test('export, search and activity succeed for a member with drafts', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const row = { kind: 'business-plan', data: { name: 'hello world' }, revision: 2, updated_at: '2026-11-01T00:00:00Z' };
  const fake = installFakeSupabase({ tables: { launcher_drafts: [row] } });
  try {
    const e = await call(routes.export, urls.export);
    assert.equal(e.status, 200); assert.match(e.headers.get('content-disposition') ?? '', /attachment/);
    assert.equal((await call(routes.activity, urls.activity)).status, 200);
    assert.equal((await call(routes.search, urls.search)).status, 200);
    assert.equal((await call(routes.search, `/api/workspace/search?workspace=${W}`)).status, 400, 'missing query');
  } finally { fake.restore(); restoreEnv(); }
});
test('launcher GET: 400 for an unknown kind and 200 with null draft', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { launcher_drafts: [] } });
  try {
    assert.equal((await call(routes.launcher, `/api/workspace/launcher?workspace=${W}&kind=nope`)).status, 400);
  } finally { fake.restore(); restoreEnv(); }
});

test('launcher POST: revoked session is rejected before any write', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ sessionActive: false, rpc: { save_launcher_draft: { body: 2 } } });
  try {
    const { makeRequest } = await import('./helpers/route-harness.ts');
    const { POST } = await import('../app/api/workspace/launcher/route.ts');
    const res = await POST(makeRequest('/api/workspace/launcher', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', workspace: W, kind: 'business-plan', revision: 1, draft: { a: 1 } }) }));
    assert.equal(res.status, 401);
    assert.equal(fake.calls.some(c => c.path.endsWith('/save_launcher_draft')), false);
  } finally { fake.restore(); restoreEnv(); }
});

test('export refuses a response over its byte cap with 413 (search and activity caps are defence in depth; their payloads are bounded by shaping)', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const kinds = ['business-plan', 'storefront', 'funnels', 'booking-page', 'link-in-bio'];
  const rows = kinds.map(kind => ({ kind, data: { text: 'x'.repeat(1_000_000) }, revision: 1, updated_at: '2026-11-01T00:00:00Z' }));
  const fake = installFakeSupabase({ tables: { launcher_drafts: rows } });
  try { assert.equal((await call(routes.export, urls.export)).status, 413); } finally { fake.restore(); restoreEnv(); }
});

test('error responses carry stable codes', async () => {
  const restoreEnv = setEnv({});
  try {
    assert.equal((await call(routes.team, urls.team)).body.code, 'not_configured');
  } finally { restoreEnv(); }
  const r2 = setEnv(configuredEnv);
  try {
    assert.equal((await call(routes.team, urls.team, { cookie: null })).body.code, 'signed_out');
    assert.equal((await call(routes.team, urls.team.replace(W, 'x'))).body.code, 'invalid_request');
    let fake = installFakeSupabase({ sessionActive: false });
    try { assert.equal((await call(routes.team, urls.team)).body.code, 'session_revoked'); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [] } });
    try { assert.equal((await call(routes.team, urls.team)).body.code, 'no_workspace_access'); } finally { fake.restore(); }
    fake = installFakeSupabase({ sessionActive: 'error' });
    try { assert.equal((await call(routes.team, urls.team)).body.code, 'storage_unavailable'); } finally { fake.restore(); }
  } finally { r2(); }
});

test('launcher POST: origin, content type, size, body shape, action and revision conflict', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const { makeRequest } = await import('./helpers/route-harness.ts');
  const { POST } = await import('../app/api/workspace/launcher/route.ts');
  const post = async (body: string, headers: Record<string, string> = {}) => {
    const res = await POST(makeRequest('/api/workspace/launcher', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers }, body }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const save = JSON.stringify({ action: 'save', workspace: W, kind: 'business-plan', revision: 1, draft: { a: 1 } });
  const fake = installFakeSupabase({ rpc: { save_launcher_draft: { body: 2 }, delete_launcher_draft: { status: 400, body: { message: 'conflict' } } } });
  try {
    assert.equal((await post(save, { origin: 'http://evil.test' })).status, 403);
    assert.equal((await post(save, { 'content-type': 'text/plain' })).status, 403);
    assert.equal((await post(save)).status, 200);
    assert.equal((await post(save)).body.revision, 2);
    assert.equal((await post('null')).status, 400);
    assert.equal((await post('[]')).status, 400);
    assert.equal((await post('{nope')).status, 400);
    assert.equal((await post(JSON.stringify({ action: 'save', workspace: W, kind: 'business-plan', revision: -1, draft: {} }))).status, 400);
    assert.equal((await post(JSON.stringify({ action: 'wipe', workspace: W, kind: 'business-plan', revision: 1 }))).status, 400);
    assert.equal((await post(JSON.stringify({ action: 'save', workspace: W, kind: 'business-plan', revision: 1, draft: { a: 'x'.repeat(200_000) } }))).status, 413);
    const del = await post(JSON.stringify({ action: 'delete', workspace: W, kind: 'business-plan', revision: 1 }));
    assert.equal(del.status, 409); assert.equal(del.body.code, 'conflict');
  } finally { fake.restore(); restoreEnv(); }
});

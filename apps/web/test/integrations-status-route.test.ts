import test from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { GET } = await import('../app/api/integrations/status/route.ts');
const url = '/api/integrations/status';

test('status: 401 without a cookie, without Supabase config, and for an invalid token', async () => {
  let restore = setEnv(configuredEnv);
  try {
    let fake = installFakeSupabase();
    try { const r = await call(GET, url, { cookie: null }); assert.equal(r.status, 401); assert.equal(r.body.signedIn, false); } finally { fake.restore(); }
    fake = installFakeSupabase({ authUser: 'invalid' });
    try { assert.equal((await call(GET, url)).status, 401); } finally { fake.restore(); }
    fake = installFakeSupabase({ authUser: 'down' });
    try { assert.equal((await call(GET, url)).status, 401); } finally { fake.restore(); }
    fake = installFakeSupabase({ sessionActive: false });
    try { assert.equal((await call(GET, url)).status, 401, 'revoked'); } finally { fake.restore(); }
  } finally { restore(); }
  restore = setEnv({});
  try { assert.equal((await call(GET, url)).status, 401); } finally { restore(); }
});
test('status: 503 when the session check fails', async () => {
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase({ sessionActive: 'error' });
  try { assert.equal((await call(GET, url)).status, 503); } finally { fake.restore(); restore(); }
});
test('status: 200 lists items with no secret values, then 429 after the per-user limit', async () => {
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase();
  try {
    const first = await call(GET, url);
    assert.equal(first.status, 200);
    assert.ok(Array.isArray(first.body.items));
    assert.equal(first.text.includes('test-publishable-key'), false);
    let last = first;
    for (let i = 0; i < 40 && last.status === 200; i++) last = await call(GET, url);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
  } finally { fake.restore(); restore(); }
});

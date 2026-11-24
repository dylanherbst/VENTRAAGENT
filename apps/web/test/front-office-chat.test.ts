import test from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const chat = await import('../app/api/front-office/chat/route.ts');
const CH = '44444444-4444-4444-8444-444444444444', KEY = 'k'.repeat(40), V = 'v_abcdefghijklmnop';
const post = (body: unknown, origin = 'http://localhost:3000') => ({ method: 'POST', cookie: null, headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const keys = ['FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_ORIGINS', 'FRONT_OFFICE_CHAT_LIVE', 'ANTHROPIC_API_KEY', 'FRONT_OFFICE_MODEL'];
function chatEnv(extra: Record<string, string> = {}) {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { FRONT_OFFICE_CHAT_CHANNEL_ID: CH, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY }, extra);
  return () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

test('chat: not connected, foreign origins, bad input', async () => {
  let restore = setEnv(configuredEnv); let env = chatEnv({ FRONT_OFFICE_CHAT_CHANNEL_ID: 'nope' });
  try { assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh' }))).status, 503); } finally { env(); }
  env = chatEnv();
  try {
    assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh' }, 'https://evil.example'))).status, 403);
    assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: 'short', message: 'hi', id: 'abcdefgh' }))).status, 400);
    assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: '', id: 'abcdefgh' }))).status, 400);
    assert.equal((await call(chat.OPTIONS, '/api/front-office/chat', { method: 'OPTIONS', cookie: null, headers: { origin: 'https://evil.example' } })).status, 403);
  } finally { env(); restore(); }
  restore = setEnv(configuredEnv); env = chatEnv({ FRONT_OFFICE_CHAT_ORIGINS: 'https://ventra.com.au' });
  try {
    const pre = await call(chat.OPTIONS, '/api/front-office/chat', { method: 'OPTIONS', cookie: null, headers: { origin: 'https://ventra.com.au' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://ventra.com.au');
  } finally { env(); restore(); }
});
test('chat: recorded but not answered until the owner turns chat live; opt-out confirmed; history', async () => {
  const restore = setEnv(configuredEnv); const env = chatEnv();
  try {
    let fake = installFakeSupabase({ rpc: { fo_ingest: { body: { contact: 'c1', state: 'new', created: true, duplicate: false, optedOut: false } }, fo_log_dispatch: { body: null } } });
    try {
      const r = await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'Do you work with gyms?', id: 'abcdefgh' }));
      assert.equal(r.status, 200); assert.equal(r.body.live, false); assert.equal(r.body.reply, null); assert.match(r.body.note, /with the team/);
      assert.deepEqual(fake.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => c.path), ['/rest/v1/rpc/fo_ingest', '/rest/v1/rpc/fo_log_dispatch']);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ rpc: { fo_ingest: { body: { contact: 'c1', state: 'new', created: false, duplicate: false, optedOut: true } }, fo_log_outbound: { body: 'm1' } } });
    try {
      const r = await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'stop', id: 'abcdefgi' }));
      assert.match(r.body.reply, /unsubscribed/);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ rpc: { fo_chat_history: { body: [{ direction: 'inbound', body: 'hi', at: 'x' }] } } });
    try {
      const h = await call(chat.GET, `/api/front-office/chat?visitor=${V}`, { cookie: null });
      assert.equal(h.status, 200); assert.equal(h.body.messages.length, 1);
    } finally { fake.restore(); }
  } finally { env(); restore(); }
});

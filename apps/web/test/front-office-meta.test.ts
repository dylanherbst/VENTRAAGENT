import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { verifyMetaSignature, verifyChallenge, parseMetaWebhook, inReplyWindow, metaConfigFromEnv, metaSender, autoSendOn } = await import('../lib/front-office/meta.ts');
const route = await import('../app/api/front-office/meta/webhook/route.ts');
const CH = '66666666-6666-4666-8666-666666666666', KEY = 'k'.repeat(40), SECRET = 'app-secret-test';
const sign = (raw: string) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
const dm = (over: Record<string, unknown> = {}) => ({ object: 'instagram', entry: [{ id: '17841400000000001', messaging: [{ sender: { id: '1234567890123' }, recipient: { id: '17841400000000001' }, timestamp: 1793900000000, message: { mid: 'aWdfZAG1faXRlbToxOk1lc3NhZA', text: 'How much are intro classes?' }, ...over }] }] });

test('signatures and webhook verification', () => {
  const raw = JSON.stringify(dm());
  assert.equal(verifyMetaSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyMetaSignature(raw + ' ', sign(raw), SECRET), false);
  assert.equal(verifyMetaSignature(raw, null, SECRET), false);
  assert.equal(verifyMetaSignature(raw, sign(raw), ''), false);
  assert.equal(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' }), 'tok'), '12345');
  assert.equal(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '12345' }), 'tok'), null);
  assert.equal(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '<x>' }), 'tok'), null);
});
test('parsing: only real DMs from people; echoes, reads and bad ids ignored', () => {
  assert.deepEqual(parseMetaWebhook(dm()).map(e => [e.kind, e.sender, e.text]), [['instagram', '1234567890123', 'How much are intro classes?']]);
  assert.equal(parseMetaWebhook(dm({ message: { mid: 'm1234567890', text: 'hi', is_echo: true } })).length, 0, 'our own replies');
  assert.equal(parseMetaWebhook(dm({ message: undefined, read: { mid: 'x' } })).length, 0, 'read receipts');
  assert.equal(parseMetaWebhook(dm({ sender: { id: 'abc' } })).length, 0);
  assert.equal(parseMetaWebhook({ ...dm(), object: 'page' })[0].kind, 'messenger');
  assert.equal(parseMetaWebhook(dm({ message: { mid: 'm1234567890', attachments: [{ type: 'image' }] } }))[0].text, '(sent an attachment)');
  assert.deepEqual(parseMetaWebhook({ object: 'whatsapp_business_account' }), []);
});
test('24-hour window, config and auto-send gate', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(inReplyWindow('2026-11-05T12:30:00Z', now), true);
  assert.equal(inReplyWindow('2026-11-05T11:59:00Z', now), false);
  assert.equal(inReplyWindow(null, now), false);
  assert.equal(metaConfigFromEnv({ INSTAGRAM_ACCESS_TOKEN: 't' }), null, 'graph version required, never guessed');
  assert.equal(autoSendOn({}), false);
});
test('send API: Instagram and Messenger request shapes; errors carry no token', async () => {
  const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  const f = (async (u: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(u), auth: (init?.headers as Record<string, string>).Authorization, body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ message_id: 'mid.1' }), { status: 200 }); }) as typeof fetch;
  const send = metaSender({ graphVersion: 'v23.0', instagramToken: 'ig-token', messengerToken: 'page-token' }, f);
  await send('instagram', '1234567890123', 'Hi!');
  await send('messenger', '1234567890123', 'Hi!');
  assert.equal(calls[0].url, 'https://graph.instagram.com/v23.0/me/messages'); assert.equal(calls[0].auth, 'Bearer ig-token');
  assert.deepEqual(calls[0].body, { recipient: { id: '1234567890123' }, message: { text: 'Hi!' } });
  assert.equal(calls[1].url, 'https://graph.facebook.com/v23.0/me/messages'); assert.equal(calls[1].body.messaging_type, 'RESPONSE');
  const bad = metaSender({ graphVersion: 'v23.0', instagramToken: 'secret-token', messengerToken: null }, (async () => new Response('{}', { status: 400 })) as typeof fetch);
  await assert.rejects(bad('instagram', '1234567890123', 'x'), (e: Error) => /400/.test(e.message) && !/secret-token/.test(e.message));
  await assert.rejects(bad('messenger', '1234567890123', 'x'), /not connected/);
});
test('webhook route: handshake, refuses unsigned posts, records a signed DM and answers 200', async () => {
  const keys = ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'ANTHROPIC_API_KEY'] as const;
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const restore = setEnv(configuredEnv);
  try {
    for (const k of keys) delete process.env[k];
    process.env.META_VERIFY_TOKEN = 'tok';
    const hs = await call(route.GET, '/api/front-office/meta/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=777', { cookie: null });
    assert.equal(hs.status, 200); assert.equal(hs.text, '777');
    const path = `/api/front-office/meta/webhook?channel=${CH}&key=${KEY}`, raw = JSON.stringify(dm());
    assert.equal((await call(route.POST, path, { method: 'POST', cookie: null, body: raw })).status, 503, 'no app secret');
    process.env.META_APP_SECRET = SECRET;
    assert.equal((await call(route.POST, path, { method: 'POST', cookie: null, body: raw, headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } })).status, 403);
    const fake = installFakeSupabase({ rpc: { fo_ingest: { body: { contact: 'c1', state: 'new', created: true, duplicate: false, optedOut: false } }, fo_log_dispatch: { body: null } } });
    try {
      const ok = await call(route.POST, path, { method: 'POST', cookie: null, body: raw, headers: { 'x-hub-signature-256': sign(raw) } });
      assert.equal(ok.status, 200); assert.equal(ok.text, 'EVENT_RECEIVED');
      assert.deepEqual(fake.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => c.path), ['/rest/v1/rpc/fo_ingest', '/rest/v1/rpc/fo_log_dispatch']);
    } finally { fake.restore(); }
  } finally { restore(); for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});

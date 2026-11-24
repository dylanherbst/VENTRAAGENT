import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { runnerSecrets, runnerAuthorized, runnerChannels } = await import('../lib/front-office/jobs.ts');
const route = await import('../app/api/front-office/jobs/run/route.ts');

const CRON = 'c'.repeat(40), OWN = 'o'.repeat(40), CH = '33333333-3333-4333-8333-333333333333', KEY = 'k'.repeat(48);
const KEYS = ['CRON_SECRET', 'FRONT_OFFICE_CRON_SECRET', 'FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY'] as const;
const CH2 = '44444444-4444-4444-8444-444444444444', CH3 = '55555555-5555-4555-8555-555555555555';
function withEnv(values: Partial<Record<typeof KEYS[number], string>>) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
  return () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}
const auth = (s: string | null): { cookie: null; headers: Record<string, string> } => ({ cookie: null, headers: s ? { authorization: 'Bearer ' + s } : {} });

test('runner secrets: only values of 32+ characters count, both names accepted', () => {
  assert.deepEqual(runnerSecrets({ CRON_SECRET: 'short', FRONT_OFFICE_CRON_SECRET: OWN }), [OWN]);
  assert.deepEqual(runnerSecrets({ CRON_SECRET: ` ${CRON} ` }), [CRON], 'pasted spaces trimmed');
  assert.deepEqual(runnerSecrets({}), []);
  assert.equal(runnerAuthorized('Bearer ' + CRON, [OWN, CRON]), true);
  assert.equal(runnerAuthorized('Bearer ' + CRON.slice(1), [CRON]), false);
  assert.equal(runnerAuthorized(null, [CRON]), false);
  assert.equal(runnerAuthorized(CRON, [CRON]), false, 'Bearer prefix required');
});

test('job runner: GET (Vercel Cron) and POST share auth and run', async () => {
  const path = '/api/front-office/jobs/run';
  const restoreSb = setEnv(configuredEnv);
  let restore = withEnv({});
  try {
    assert.equal((await call(route.GET, path, auth(CRON))).status, 503, 'nothing configured');
    restore(); restore = withEnv({ CRON_SECRET: CRON });
    assert.equal((await call(route.GET, path, auth(null))).status, 401);
    assert.equal((await call(route.GET, path, auth(OWN))).status, 401);
    assert.equal((await call(route.GET, path, auth(CRON))).status, 503, 'channel not configured');
    restore(); restore = withEnv({ CRON_SECRET: CRON, FRONT_OFFICE_CRON_SECRET: OWN, FRONT_OFFICE_CHANNEL_ID: CH, FRONT_OFFICE_CHANNEL_KEY: KEY });
    const fake = installFakeSupabase({ rpc: { fo_claim_jobs: { body: [] } } });
    try {
      for (const [h, s] of [[route.GET, CRON], [route.POST, OWN], [route.GET, OWN], [route.POST, CRON]] as const) {
        const r = await call(h, path, { ...auth(s), method: h === route.POST ? 'POST' : 'GET' });
        assert.equal(r.status, 200); assert.equal(r.body.ran, 0);
        assert.equal(r.headers.get('cache-control'), 'no-store');
      }
      assert.ok(fake.calls.every(c => c.path === '/rest/v1/rpc/fo_claim_jobs'));
    } finally { fake.restore(); }
  } finally { restore(); restoreSb(); }
});

test('vercel.json schedules the runner every minute', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(cfg.crons, [{ path: '/api/front-office/jobs/run', schedule: '* * * * *' }]);
});

test('runner channels: SMS, chat and email pairs, skipping bad or duplicate ones', () => {
  assert.deepEqual(runnerChannels({}), []);
  assert.deepEqual(runnerChannels({ FRONT_OFFICE_CHAT_CHANNEL_ID: CH2, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_EMAIL_CHANNEL_ID: CH3, FRONT_OFFICE_EMAIL_CHANNEL_KEY: 'short' }).map(c => c.name), ['web-chat']);
  assert.deepEqual(runnerChannels({ FRONT_OFFICE_CHANNEL_ID: CH, FRONT_OFFICE_CHANNEL_KEY: KEY, FRONT_OFFICE_CHAT_CHANNEL_ID: CH, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_EMAIL_CHANNEL_ID: CH3, FRONT_OFFICE_EMAIL_CHANNEL_KEY: KEY }).map(c => c.name), ['sms', 'email']);
  assert.deepEqual(runnerChannels({ FRONT_OFFICE_CHANNEL_ID: 'not-a-uuid', FRONT_OFFICE_CHANNEL_KEY: KEY }), []);
});

test('job runner: claims jobs on each configured channel', async () => {
  const restoreSb = setEnv(configuredEnv);
  const restore = withEnv({ CRON_SECRET: CRON, FRONT_OFFICE_CHAT_CHANNEL_ID: CH2, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_EMAIL_CHANNEL_ID: CH3, FRONT_OFFICE_EMAIL_CHANNEL_KEY: KEY });
  const fake = installFakeSupabase({ rpc: { fo_claim_jobs: { body: [] } } });
  try {
    const r = await call(route.GET, '/api/front-office/jobs/run', auth(CRON));
    assert.equal(r.status, 200); assert.equal(r.body.channels, 2); assert.equal(r.body.failedChannels, 0);
    assert.equal(fake.calls.filter(c => c.path === '/rest/v1/rpc/fo_claim_jobs').length, 2);
  } finally { fake.restore(); restore(); restoreSb(); }
});

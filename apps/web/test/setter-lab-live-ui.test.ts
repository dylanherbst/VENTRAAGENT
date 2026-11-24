// Setter Lab Live AI Test UI layer (task A-23b): the server-verified caller, the error mapping and the display helpers.
// No network: Supabase is faked through injected clients, and runLiveLabTurn is reached only to prove it refuses.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { verifiedCaller, liveError, SIGN_IN_FOR_LIVE, ACCOUNT_NOT_CONNECTED, SIGN_IN_CHECK_FAILED, LIVE_FAILED } = await import('../app/tools/setter-lab/live-auth.ts');
const { formatAud, turnBadge, turnUsageLine, usageTodayLine } = await import('../app/tools/setter-lab/format.ts');
const { LIVE_NEEDS_USER, LIVE_NOT_CONFIGURED, liveCapReached, runLiveLabTurn } = await import('../lib/front-office/setter/lab-live.ts');
const { newLab } = await import('../lib/front-office/setter/lab.ts');
const { getLabUsage, sendMessage } = await import('../app/tools/setter-lab/actions.ts');
type LabTurnUsage = import('../lib/front-office/setter/lab.ts').LabTurnUsage;

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

const ID = '22222222-2222-4222-8222-222222222222';
const auth = (r: { user?: { id: string } | null; error?: unknown; throws?: boolean }, seen: string[] = []) => () => ({
  auth: { async getUser(token: string) { seen.push(token); if (r.throws) throw new Error('down'); return { data: { user: r.user ?? null }, error: r.error ?? null }; } },
});
const session = (data: unknown, error: unknown = null, seen: string[] = []) => (token: string) => ({ rpc: async () => { seen.push(token); return { data, error }; } });
const on = () => true;

test('verifiedCaller: a verified user with a live session becomes the caller, using the server token only', async () => {
  const a: string[] = [], s: string[] = [];
  const r = await verifiedCaller('tok-1', { configured: on, authClient: auth({ user: { id: ID } }, a), sessionClient: session(true, null, s) });
  assert.deepEqual(r, { caller: { userId: ID }, error: null });
  assert.deepEqual(a, ['tok-1']); assert.deepEqual(s, ['tok-1']);
});

test('verifiedCaller: no cookie, invalid token, revoked session or no Supabase config means no caller', async () => {
  let calls = 0;
  const counting = () => { calls++; return auth({ user: { id: ID } })(); };
  assert.deepEqual(await verifiedCaller(undefined, { configured: on, authClient: counting }), { caller: null, error: SIGN_IN_FOR_LIVE });
  assert.deepEqual(await verifiedCaller('', { configured: on, authClient: counting }), { caller: null, error: SIGN_IN_FOR_LIVE });
  assert.equal(calls, 0, 'no auth call without a token');
  assert.deepEqual(await verifiedCaller('t', { configured: () => false, authClient: counting }), { caller: null, error: ACCOUNT_NOT_CONNECTED });
  assert.equal(calls, 0);
  assert.deepEqual(await verifiedCaller('t', { configured: on, authClient: auth({ user: null, error: new Error('invalid JWT') }) }), { caller: null, error: SIGN_IN_FOR_LIVE });
  assert.deepEqual(await verifiedCaller('t', { configured: on, authClient: auth({ user: { id: ID } }), sessionClient: session(false) }), { caller: null, error: SIGN_IN_FOR_LIVE });
  assert.deepEqual(await verifiedCaller('t', { configured: on, authClient: auth({ user: { id: ID } }), sessionClient: session(null, { message: 'x' }) }), { caller: null, error: SIGN_IN_CHECK_FAILED });
  assert.deepEqual(await verifiedCaller('t', { configured: on, authClient: auth({ throws: true }) }), { caller: null, error: SIGN_IN_CHECK_FAILED });
});

test('sendLiveMessage takes no user id: its signature is (state, message, mode) only', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../app/tools/setter-lab/actions.ts', import.meta.url), 'utf8');
  assert.match(src, /export async function sendLiveMessage\(state: LabState, message: string, mode: OperatingMode\)/);
  assert.match(src, /verifiedCaller\(token\)/);
  assert.doesNotMatch(src, /userId/);
});

test('the engine refuses a missing caller with no model call, and liveError maps it to the sign-in message', async () => {
  const env = { ANTHROPIC_API_KEY: 'x', FRONT_OFFICE_MODEL: 'claude-sonnet-4-5' };
  await assert.rejects(runLiveLabTurn(newLab(), { message: 'hi' }, null, { env, fetch: async () => { throw new Error('must not be called'); } }), (e: Error) => e.message === LIVE_NEEDS_USER);
  assert.deepEqual(liveError(new Error(LIVE_NEEDS_USER)), { error: SIGN_IN_FOR_LIVE, liveAi: 'unknown' });
  assert.match(SIGN_IN_FOR_LIVE, /^Sign in to use Live AI Test/);
});

test('liveError: not configured, cap reached, and anything else in plain English', () => {
  assert.deepEqual(liveError(new Error(LIVE_NOT_CONFIGURED)), { error: LIVE_NOT_CONFIGURED, liveAi: 'not_configured' });
  const cap = liveCapReached(5);
  assert.deepEqual(liveError(new Error(cap)), { error: cap, liveAi: 'configured' });
  assert.deepEqual(liveError(new Error('ECONNRESET sk-ant-secret at /internal/path')), { error: LIVE_FAILED, liveAi: 'unknown' });
  assert.deepEqual(liveError('weird'), { error: LIVE_FAILED, liveAi: 'unknown' });
});

const usage = (o: Partial<LabTurnUsage> = {}): LabTurnUsage => ({ estimate: true, model: 'claude-sonnet-4-5', priceKnown: true, calls: 2, inputTokens: 1200, outputTokens: 150, latencyMs: 1834.6, costAud: 0.009068, usageReported: true, note: '', ...o });

test('formatAud keeps sub-cent costs visible and clamps bad values', () => {
  assert.equal(formatAud(0), 'A$0.00');
  assert.equal(formatAud(5), 'A$5.00');
  assert.equal(formatAud(0.009068), 'A$0.0091');
  assert.equal(formatAud(1.234), 'A$1.23');
  assert.equal(formatAud(-1), 'A$0.00');
  assert.equal(formatAud(NaN), 'A$?');
});

test('turn badge: LIVE only for a live turn with usage; scripted turns are always DEMO with no usage line', () => {
  assert.equal(turnBadge({ model: 'live', usage: usage() }), 'LIVE');
  assert.equal(turnBadge({ model: 'scripted' }), 'DEMO');
  assert.equal(turnBadge({ model: 'scripted', usage: usage() }), 'DEMO');
  assert.equal(turnBadge({ model: 'live' }), 'DEMO');
  assert.equal(turnUsageLine({ model: 'scripted' }), null);
  const line = turnUsageLine({ model: 'live', usage: usage() })!;
  assert.match(line, /Tokens in 1200 \/ out 150/);
  assert.match(line, /latency 1835 ms/);
  assert.match(line, /estimated cost A\$0\.0091/);
  assert.doesNotMatch(line, /PRICE UNKNOWN/);
  assert.match(turnUsageLine({ model: 'live', usage: usage({ priceKnown: false, usageReported: false, calls: 1 }) })!, /1 model call;.*PRICE UNKNOWN.*worst case counted/);
});

test('getLabUsage returns today\'s estimate and the usage line shows spent / cap / remaining', async () => {
  const u = await getLabUsage();
  assert.equal(u.estimate, true);
  assert.equal(u.timeZone, 'Australia/Perth');
  assert.equal(typeof u.capAud, 'number');
  assert.equal(u.persistent, false);
  assert.match(u.note, /resets on restart/);
  const line = usageTodayLine({ ...u, day: '2026-11-11', spentAud: 1.5, capAud: 5, remainingAud: 3.5 });
  assert.equal(line, 'Today (2026-11-11, Australia/Perth): spent A$1.50 of A$5.00 cap, A$3.50 remaining (estimate)');
});

test('sendLiveMessage outside a signed-in request returns a plain error, no state and no network call', async () => {
  const { sendLiveMessage } = await import('../app/tools/setter-lab/actions.ts');
  const r = await sendLiveMessage(newLab(), 'hi', 'automatic');
  assert.equal(r.state, null);
  assert.ok(r.error === SIGN_IN_CHECK_FAILED || r.error === SIGN_IN_FOR_LIVE || r.error === ACCOUNT_NOT_CONNECTED, String(r.error));
});

test('demo sendMessage is unchanged: anonymous, scripted, and its turns are DEMO', async () => {
  const r = await sendMessage(newLab('owner_approval'), 'Hi, I run a gym in Fremantle.', 'owner_approval');
  assert.equal(r.error, null);
  const t = r.state!.turns.at(-1)!;
  assert.equal(t.model, 'scripted');
  assert.equal(t.usage, undefined);
  assert.equal(turnBadge(t), 'DEMO');
});

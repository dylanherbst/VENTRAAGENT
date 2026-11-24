import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETWORK_FAILURE, PASSWORD_MAX, PASSWORD_MIN, START_DRAFT_KEY, authRequestBody, finderHref, flowStepNumber, flowSteps, flowTotal,
  interpretAuthResponse, parseAuthMode, startRoutes, validateCredentials,
} from '../app/start/flow.ts';
import { toProfile } from '../lib/aimp/onboarding/model.ts';
import { DEMO_DRAFT_KEY, createMemoryStore } from '../lib/aimp/onboarding/store.ts';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';

const good = 'correct horse battery';

test('the flow has three numbered steps in order', () => {
  assert.deepEqual([...flowSteps], ['account', 'tour', 'goals']);
  assert.equal(flowTotal, 3);
  assert.deepEqual(flowSteps.map(flowStepNumber), [1, 2, 3]);
  assert.equal(startRoutes.finder, '/tools/opportunity-finder');
});

test('sign-in mode comes from the query string and defaults to sign-up', () => {
  assert.equal(parseAuthMode('login'), 'login');
  assert.equal(parseAuthMode('signin'), 'login');
  assert.equal(parseAuthMode('signup'), 'signup');
  assert.equal(parseAuthMode(undefined), 'signup');
  assert.equal(parseAuthMode(['login']), 'signup');
});

test('credentials follow the same rules as the workspace endpoint', () => {
  assert.equal(PASSWORD_MIN, 12);
  assert.equal(PASSWORD_MAX, 128);
  assert.deepEqual(validateCredentials('  me@example.com ', good, 'signup'), { ok: true, email: 'me@example.com', password: good });
  assert.equal(validateCredentials('me@example.com', 'x'.repeat(12), 'login').ok, true);
  assert.equal(validateCredentials('me@example.com', 'x'.repeat(128), 'login').ok, true);
  for (const [email, password] of [['', good], ['nope', good], ['a b@example.com', good], ['me@example', good], [`${'a'.repeat(250)}@b.co`, good], ['me@example.com', ''], ['me@example.com', 'short'], ['me@example.com', 'x'.repeat(129)]] as const) {
    assert.equal(validateCredentials(email, password, 'signup').ok, false, `${email} / ${password.length} chars`);
  }
});

test('credential errors are specific, plain and per field', () => {
  const both = validateCredentials('', '', 'signup');
  assert.equal(both.ok, false);
  if (!both.ok) {
    assert.equal(both.errors.email, 'Enter your email address.');
    assert.match(both.errors.password ?? '', /at least 12 characters/);
  }
  const short = validateCredentials('me@example.com', 'seven77', 'login');
  if (!short.ok) {
    assert.equal(short.errors.email, undefined);
    assert.equal(short.errors.password, 'Use at least 12 characters. You have 7.');
  }
  const login = validateCredentials('me@example.com', '', 'login');
  if (!login.ok) assert.equal(login.errors.password, 'Enter your password.');
});

test('the request body is exactly what the endpoint reads', () => {
  assert.deepEqual(JSON.parse(authRequestBody('login', 'me@example.com', good)), { action: 'login', email: 'me@example.com', password: good });
  assert.deepEqual(JSON.parse(authRequestBody('signup', 'me@example.com', good)), { action: 'signup', email: 'me@example.com', password: good });
});

test('only a 200 with signedIn true counts as signed in', () => {
  assert.equal(interpretAuthResponse(200, { signedIn: true, message: 'Signed in.' }, 'login').kind, 'signed-in');
  assert.equal(interpretAuthResponse(200, { signedIn: true }, 'signup').kind, 'signed-in');
  for (const body of [{ signedIn: 'true' }, { signedIn: 1 }, {}, null, 'ok', []]) {
    assert.notEqual(interpretAuthResponse(200, body, 'login').kind, 'signed-in');
  }
  assert.notEqual(interpretAuthResponse(401, { signedIn: true }, 'login').kind, 'signed-in');
});

test('sign-up without a session asks the person to confirm their email', () => {
  const r = interpretAuthResponse(200, { signedIn: false, message: 'Check your email to confirm your account, then sign in.' }, 'signup');
  assert.equal(r.kind, 'confirm-email');
  assert.match(r.message, /confirm/);
  // A sign-in that returns 200 without a session is not treated as success or as "check your email".
  assert.equal(interpretAuthResponse(200, { signedIn: false }, 'login').kind, 'failed');
});

test('endpoint errors map to honest messages', () => {
  const notConnected = interpretAuthResponse(503, { error: 'Account storage is not connected yet. Your browser drafts are unchanged.', configured: false }, 'signup');
  assert.equal(notConnected.kind, 'not-connected');
  assert.match(notConnected.message, /nothing was created/);
  const limited = interpretAuthResponse(429, { error: 'Too many attempts. Try again in a few minutes.' }, 'login');
  assert.deepEqual(limited, { kind: 'rate-limited', message: 'Too many attempts. Try again in a few minutes.' });
  assert.equal(interpretAuthResponse(401, { error: 'Unable to sign in or create an account. Check your details, email confirmation and try again.' }, 'login').kind, 'rejected');
  assert.equal(interpretAuthResponse(400, { error: 'Use a valid email and a password of 12–128 characters.' }, 'signup').message, 'Use a valid email and a password of 12–128 characters.');
  assert.match(interpretAuthResponse(401, null, 'login').message, /could not sign you in/);
  assert.match(interpretAuthResponse(401, {}, 'signup').message, /could not create that account/);
  for (const status of [403, 404, 413, 500, 502]) assert.equal(interpretAuthResponse(status, { error: 'x' }, 'login').kind, 'failed');
  assert.equal(NETWORK_FAILURE.kind, 'failed');
});

test('no outcome message promises income', () => {
  const messages = [
    interpretAuthResponse(200, { signedIn: true }, 'login'), interpretAuthResponse(200, {}, 'signup'), interpretAuthResponse(503, {}, 'login'),
    interpretAuthResponse(429, {}, 'login'), interpretAuthResponse(401, {}, 'login'), interpretAuthResponse(500, {}, 'login'), NETWORK_FAILURE,
  ].map((o) => o.message);
  for (const m of messages) {
    assert.ok(m.length > 0);
    assert.doesNotMatch(m, /earn|income|profit|guarantee|\$/i);
  }
});

test('the start flow keeps its own draft, separate from the demo test page', () => {
  assert.notEqual(START_DRAFT_KEY, DEMO_DRAFT_KEY);
  const store = createMemoryStore();
  store.save(START_DRAFT_KEY, 'hours', { budgetMinor: 25_000 });
  assert.equal(store.load(DEMO_DRAFT_KEY).status, 'empty');
  const resumed = store.load(START_DRAFT_KEY);
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.step, 'hours');
  assert.deepEqual(resumed.answers, { budgetMinor: 25_000 });
});

test('the finished profile becomes an Opportunity Finder link the page can read back', () => {
  const done = toProfile({ budgetMinor: 25_050, weeklyHours: 6, interests: ['Pets', 'Home & decor'], skills: [], effort: 'medium' });
  assert.equal(done.ok, true);
  if (!done.ok) return;
  const href = finderHref(done.profile);
  const url = new URL(href, 'http://localhost');
  assert.equal(url.pathname, '/tools/opportunity-finder');
  assert.equal(url.searchParams.get('budget'), '250.50');
  assert.equal(url.searchParams.get('hours'), '6');
  assert.equal(url.searchParams.get('interests'), 'Pets, Home & decor');
  assert.equal(url.searchParams.get('skills'), '');
  assert.equal(url.searchParams.get('effort'), 'medium');
  // Parse it the way app/tools/opportunity-finder/page.tsx does and run the real finder.
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const result = findOpportunities({
    budgetMinor: Math.round(Number(url.searchParams.get('budget')) * 100), weeklyHours: Number(url.searchParams.get('hours')),
    interests: list(url.searchParams.get('interests') ?? ''), skills: list(url.searchParams.get('skills') ?? ''), preferredEffort: url.searchParams.get('effort'),
  }, { now: () => new Date('2026-11-14T00:00:00Z'), mode: 'fixture' });
  assert.ok(result);
  const whole = toProfile({ budgetMinor: 5_000, weeklyHours: 3, interests: ['cooking'], skills: ['design'], effort: 'low' });
  if (whole.ok) assert.equal(new URL(finderHref(whole.profile), 'http://localhost').searchParams.get('budget'), '50');
});

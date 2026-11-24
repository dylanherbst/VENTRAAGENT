import assert from 'node:assert/strict';
import test from 'node:test';
import { businessModels } from '../lib/aimp/contracts.ts';
import { getBlueprint } from '../lib/aimp/preview/blueprints.ts';
import { HANDOFF_MAX_LENGTH, decodeHandoff, encodeHandoff, signupHref, type HandoffChoices } from '../lib/aimp/plant/handoff.ts';

const model = businessModels[0];
const niche = getBlueprint(model).niches[0].id;
const good: HandoffChoices = { model, niche, seed: 7, plan: 'launch' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const raw = (over: Record<string, unknown> = {}) => ({ v: 1, m: model, n: niche, s: 7, p: 'launch', ...over });

test('round trip for every model, first niche and plan', () => {
  for (const m of businessModels) {
    for (const plan of ['discover', 'launch', 'autopilot', 'scale'] as const) {
      const c: HandoffChoices = { model: m, niche: getBlueprint(m).niches[0].id, seed: 999, plan };
      assert.deepEqual(decodeHandoff(encodeHandoff(c)), c);
    }
  }
});

test('encoded value is compact and URL safe', () => {
  const v = encodeHandoff(good);
  assert.ok(v && v.length < 160 && /^[A-Za-z0-9_-]+$/.test(v));
  assert.equal(encodeURIComponent(v), v);
});

test('malformed input returns null', () => {
  for (const bad of [undefined, null, 5, {}, '', 'not base64!', '%%%', 'e30', b64('text'), b64([1]), b64(null), 'AAAA']) assert.equal(decodeHandoff(bad), null);
});

test('oversized input returns null', () => {
  assert.equal(decodeHandoff('a'.repeat(HANDOFF_MAX_LENGTH + 1)), null);
  assert.equal(decodeHandoff(b64(raw({ pad: 'x'.repeat(HANDOFF_MAX_LENGTH) }))), null);
});

test('wrong or missing version returns null', () => {
  assert.equal(decodeHandoff(b64(raw({ v: 2 }))), null);
  assert.equal(decodeHandoff(b64(raw({ v: '1' }))), null);
  const noVersion: Record<string, unknown> = raw();
  delete noVersion.v;
  assert.equal(decodeHandoff(b64(noVersion)), null);
});

test('unknown fields are dropped, not passed through', () => {
  const out = decodeHandoff(b64(raw({ email: 'a@b.co', html: '<b>x</b>', extra: 1 })));
  assert.deepEqual(out, good);
  assert.deepEqual(Object.keys(out ?? {}).sort(), ['model', 'niche', 'plan', 'seed']);
});

test('invalid, overlong or markup values are rejected', () => {
  assert.equal(decodeHandoff(b64(raw({ m: 'made-up-model' }))), null);
  assert.equal(decodeHandoff(b64(raw({ n: 'no-such-niche' }))), null);
  assert.equal(decodeHandoff(b64(raw({ n: '<script>alert(1)</script>' }))), null);
  assert.equal(decodeHandoff(b64(raw({ n: 'a'.repeat(60) }))), null);
  assert.equal(decodeHandoff(b64(raw({ p: 'enterprise' }))), null);
  for (const s of [-1, 1000, 1.5, '7', null]) assert.equal(decodeHandoff(b64(raw({ s }))), null);
});

test('encodeHandoff refuses invalid choices', () => {
  assert.equal(encodeHandoff({ ...good, niche: 'nope' }), null);
  assert.equal(encodeHandoff({ ...good, seed: 5000 }), null);
  assert.equal(encodeHandoff({ ...good, plan: 'x' as never }), null);
});

test('launch link goes to /start and decodes back to the same choices', () => {
  const href = signupHref(good);
  const url = new URL(href, 'https://example.test');
  assert.equal(url.pathname, '/start');
  assert.equal(url.searchParams.get('from'), 'build');
  assert.deepEqual(decodeHandoff(url.searchParams.get('preview')), good);
});

test('launch link falls back to plain /start for invalid choices', () => {
  assert.equal(signupHref({ ...good, niche: 'nope' }), '/start?from=build');
});

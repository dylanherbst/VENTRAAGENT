import assert from 'node:assert/strict';
import test from 'node:test';
import { parseActivityResponse, shapeActivity } from '../lib/account-activity.ts';

const row = (kind: unknown, o: Record<string, unknown> = {}) => ({ kind, revision: 2, updated_at: '2026-11-03T00:00:00.000Z', ...o });

test('known kinds only, newest first, with plain names and links', () => {
  const out = shapeActivity([row('storefront', { updated_at: '2026-11-01T00:00:00.000Z' }), row('funnels', { updated_at: '2026-11-03T00:00:00.000Z' }), row('courses'), row(5)]);
  assert.deepEqual(out.map(e => e.kind), ['funnels', 'storefront']);
  assert.equal(out[0].label, 'Funnels');
  assert.equal(out[0].href, '/grow?tab=funnels');
  assert.deepEqual(Object.keys(out[0]).sort(), ['href', 'kind', 'label', 'revision', 'updatedAt']);
});
test('malformed rows are dropped and bad times become null and sort last', () => {
  const out = shapeActivity([row('storefront', { revision: -1 }), row('funnels', { revision: 1.5 }), null, 'x', row('storefront', { updated_at: 'nonsense' }), row('lead-scoring')]);
  assert.deepEqual(out.map(e => [e.kind, e.updatedAt === null]), [['lead-scoring', false], ['storefront', true]]);
});
test('non-array input gives nothing; ties are ordered by kind', () => {
  for (const v of [null, undefined, {}, 'x']) assert.deepEqual(shapeActivity(v), []);
  const same = { updated_at: '2026-11-03T00:00:00.000Z' };
  assert.deepEqual(shapeActivity([row('storefront', same), row('funnels', same)]).map(e => e.kind), ['funnels', 'storefront']);
});
test('a kind with no registry entry still shows a readable name', () => {
  const out = shapeActivity([row('notification-prefs')]);
  assert.equal(out[0].label, 'notification prefs');
});
test('parser accepts the route shape and rejects others', () => {
  const entries = shapeActivity([row('storefront')]);
  assert.equal(parseActivityResponse({ signedIn: true, entries })?.length, 1);
  assert.equal(parseActivityResponse({ signedIn: false, entries }), null);
  assert.equal(parseActivityResponse({ signedIn: true, entries: [{ kind: 1 }] }), null);
  assert.equal(parseActivityResponse(null), null);
});
test('describeEntry uses plain wording', async () => {
  const { describeEntry } = await import('../lib/account-activity.ts');
  const [a, b] = shapeActivity([row('storefront', { revision: 1 }), row('funnels', { revision: 4 })]);
  assert.equal(describeEntry(b), 'Storefront: first saved');
  assert.equal(describeEntry(a), 'Funnels: updated (save number 4)');
});

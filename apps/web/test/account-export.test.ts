import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountExport, exportFileName, parseAccountExport } from '../lib/account-export.ts';

const at = '2026-11-04T01:02:03.000Z';
const row = (kind: unknown, o: Record<string, unknown> = {}) => ({ kind, data: { version: 1 }, revision: 2, updated_at: '2026-11-03T00:00:00.000Z', ...o });

test('known kinds are exported sorted, with only the public fields', () => {
  const out = buildAccountExport([row('storefront'), row('business-plan', { extra: 'x', workspace_id: 'w' })], 'w1', at);
  assert.equal(out.draftCount, 2);
  assert.deepEqual(out.drafts.map(d => d.kind), ['business-plan', 'storefront']);
  assert.deepEqual(Object.keys(out.drafts[0]).sort(), ['data', 'kind', 'revision', 'updatedAt']);
  assert.equal(out.workspaceId, 'w1');
  assert.equal(out.exportedAt, at);
});
test('unknown kinds and malformed rows are dropped', () => {
  const out = buildAccountExport([row('courses'), row(5), row('storefront', { revision: -1 }), row('storefront', { revision: 1.5 }), null, 'x', row('storefront', { data: undefined })], 'w1', at);
  assert.equal(out.draftCount, 0);
  assert.deepEqual(out.drafts, []);
});
test('non-array input and missing timestamp are handled', () => {
  for (const v of [null, undefined, {}, 'x']) assert.equal(buildAccountExport(v, 'w1', at).draftCount, 0);
  assert.equal(buildAccountExport([row('storefront', { updated_at: null })], 'w1', at).drafts[0].updatedAt, null);
});
test('file name is date based and safe', () => {
  assert.equal(exportFileName(at), 'ventra-data-2026-11-04.json');
  assert.doesNotMatch(exportFileName('../../x"y'), /[/"]/);
});
test('parser accepts the route shape and rejects others', () => {
  const good = buildAccountExport([row('storefront')], 'w1', at);
  assert.ok(parseAccountExport(JSON.parse(JSON.stringify(good))));
  assert.equal(parseAccountExport({ ...good, draftCount: 9 }), null);
  assert.equal(parseAccountExport({ ...good, format: 'other' }), null);
  assert.equal(parseAccountExport(null), null);
  assert.equal(parseAccountExport({ error: 'Sign in' }), null);
});

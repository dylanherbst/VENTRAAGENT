import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountExport } from '../lib/account-export.ts';
import { isWritable, parseImportFile, planImport, runImport } from '../lib/account-import.ts';
import { checkedDraftRaw } from '../lib/launcher-drafts.ts';
import type { RemoteLauncherDraft } from '../lib/launcher-drafts.ts';

const at = '2026-11-04T01:02:03.000Z';
const row = (kind: string, revision: number, data: unknown = { version: 1, n: kind }) => ({ kind, data, revision, updated_at: at });
const file = (rows: unknown[]) => JSON.stringify(buildAccountExport(rows, 'w1', at));
const remote = (kind: 'storefront', revision: number, data: unknown): RemoteLauncherDraft => ({ kind, revision, updatedAt: null, raw: JSON.stringify(data) });

test('a round trip file parses with every valid item', () => {
  const p = parseImportFile(file([row('storefront', 3), row('business-plan', 1)]));
  assert.equal(p.items.length, 2);
  assert.equal(p.rejected.length, 0);
  assert.equal(p.workspaceId, 'w1');
});
test('unusable files are refused with a message', () => {
  for (const t of ['', '   ', 'nope', '[]', '{"format":"other"}', JSON.stringify({ format: 'ventra-account-export', version: 1, exportedAt: at, workspaceId: 'w', draftCount: 2, drafts: [] })]) assert.throws(() => parseImportFile(t));
  assert.throws(() => parseImportFile('x'.repeat(5_000_001)), /too large/);
});
test('bad single drafts are rejected, the rest kept', () => {
  const body = { format: 'ventra-account-export', version: 1, exportedAt: at, workspaceId: 'w1', draftCount: 6, drafts: [
    { kind: 'storefront', revision: 2, data: { version: 1 } },
    { kind: 'courses', revision: 1, data: { a: 1 } },
    { kind: 'funnels', revision: 0, data: { a: 1 } },
    { kind: 'booking-page', revision: 1, data: [1] },
    { kind: 'storefront', revision: 5, data: { version: 1 } },
    null,
  ] };
  const p = parseImportFile(JSON.stringify(body));
  assert.deepEqual(p.items.map(i => i.kind), ['storefront']);
  assert.equal(p.rejected.length, 5);
});
test('oversized draft data is rejected', () => {
  const p = parseImportFile(file([row('storefront', 1, { text: 'a'.repeat(130000) })]));
  assert.equal(p.items.length, 0);
  assert.match(p.rejected[0].reason, /too large/);
});
test('plan compares with the account copy', () => {
  const p = parseImportFile(file([row('storefront', 3, { b: 1, a: 2 })]));
  const plan = (r: RemoteLauncherDraft | null) => planImport(p, new Map([['storefront', r]]))[0];
  assert.equal(plan(null).status, 'new');
  assert.equal(plan(null).accountRevision, 0);
  assert.equal(plan(remote('storefront', 9, { a: 2, b: 1 })).status, 'unchanged', 'key order does not matter');
  assert.equal(plan(remote('storefront', 2, { a: 1 })).status, 'older-in-account');
  assert.equal(plan(remote('storefront', 3, { a: 1 })).status, 'newer-in-account', 'same revision with different data is a conflict and is kept');
  assert.equal(plan(remote('storefront', 7, { a: 1 })).status, 'newer-in-account');
  assert.equal(isWritable(plan(remote('storefront', 7, { a: 1 }))), false);
});
test('runner never writes newer or unchanged copies and replaces older only when chosen', async () => {
  const p = parseImportFile(file([row('storefront', 3), row('funnels', 3), row('booking-page', 3), row('business-plan', 3)]));
  const plan = planImport(p, new Map([
    ['storefront', null], ['funnels', { kind: 'funnels', revision: 1, updatedAt: null, raw: '{"x":1}' }],
    ['booking-page', { kind: 'booking-page', revision: 8, updatedAt: null, raw: '{"x":1}' }],
    ['business-plan', { kind: 'business-plan', revision: 3, updatedAt: null, raw: JSON.stringify({ version: 1, n: 'business-plan' }) }],
  ] as never));
  const calls: [string, number][] = [];
  const save = async (_w: string, kind: string, _raw: string, rev: number) => { calls.push([kind, rev]); return rev + 1; };
  const without = await runImport('w', plan, false, { save: save as never });
  assert.deepEqual(calls, [['storefront', 0]]);
  assert.deepEqual(without.map(o => o.result), ['skipped', 'skipped', 'skipped', 'saved']);
  calls.length = 0;
  const withReplace = await runImport('w', plan, true, { save: save as never });
  assert.deepEqual(calls, [['funnels', 1], ['storefront', 0]], 'the expected revision is the one seen when planning');
  assert.equal(withReplace[0].result, 'skipped');
});
test('a failed save is reported for that item only', async () => {
  const p = parseImportFile(file([row('storefront', 1), row('funnels', 1)]));
  const plan = planImport(p, new Map());
  const save = async (_w: string, kind: string) => { if (kind === 'funnels') throw new Error('Revision conflict'); return 1; };
  const out = await runImport('w', plan, false, { save: save as never });
  assert.deepEqual(out.map(o => o.result).sort(), ['failed', 'saved']);
  assert.match(out.find(o => o.result === 'failed')!.message, /conflict/);
});
test('size limits count bytes, not UTF-16 units', () => {
  // 2,000,000 euro signs are 2M UTF-16 units but 6M bytes.
  assert.throws(() => parseImportFile('€'.repeat(2_000_000)), /too large/);
  // 50,000 four-byte emoji are 100,000 units but 200,000 bytes: over the 128,000 draft limit.
  assert.throws(() => checkedDraftRaw(JSON.stringify({ a: '\u{1F600}'.repeat(50_000) })), /too large/);
  assert.deepEqual(checkedDraftRaw(JSON.stringify({ a: '€'.repeat(1000) })), { a: '€'.repeat(1000) });
});
test('plan flags a file exported from a different workspace', () => {
  const p = parseImportFile(file([row('storefront', 3)]));
  assert.equal(planImport(p, new Map())[0].otherWorkspace, false, 'no target given');
  assert.equal(planImport(p, new Map(), 'w1')[0].otherWorkspace, false);
  assert.equal(planImport(p, new Map(), 'W1')[0].otherWorkspace, false, 'case-insensitive');
  assert.equal(planImport(p, new Map(), '11111111-1111-4111-8111-111111111111')[0].otherWorkspace, true);
});

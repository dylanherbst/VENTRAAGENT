import assert from 'node:assert/strict';
import test from 'node:test';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';
import {
  buildPreview, createMemoryStore, editSelection, ideaIdOf, loadSelection, saveSelection, selectIdea, selectionKey, selectionToNewBusiness,
  type SelectDeps, type StorageLike,
} from '../lib/aimp/selection/index.ts';

const now = () => new Date('2026-11-14T00:00:00.000Z');
const profile = { budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' };
const ideas = findOpportunities(profile, { now }).ideas;
const [first, second] = [ideas[0]!, ideas[1]!];
const WS = '8b0a3a52-1c5e-4a56-9a64-0d3a2d6f7c11';

function deps(): SelectDeps {
  let n = 0;
  const hex = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  return { store: createMemoryStore(), now, newId: () => hex(++n) };
}

test('preview shows sample product, brand placeholder, storefront sketch, costs, labelled price assumptions and owner actions', () => {
  const r = buildPreview(first);
  assert.ok(r.ok);
  const p = r.preview;
  assert.equal(p.ideaId, ideaIdOf(first));
  assert.ok(p.sampleProduct.title.length > 3 && p.sampleProduct.totalPages > 0 && p.sampleProduct.formats.length > 0);
  assert.equal(p.brand.isPlaceholder, true);
  assert.match(p.brand.name, /placeholder/i);
  assert.equal(p.storefront.isSketch, true);
  assert.ok(p.storefront.blocks.length >= 4);
  assert.ok(p.costs.lines.length > 0);
  assert.equal(p.costs.totalMinor, p.costs.lines.reduce((n, l) => n + l.amountMinor, 0));
  assert.equal(p.costs.totalMinor, first.estimatedStartupCostMinor);
  assert.match(p.priceAssumptions.label, /^Assumption/);
  assert.ok(p.priceAssumptions.afterCardFeeMinor < p.priceAssumptions.priceMinor);
  assert.ok(p.priceAssumptions.afterCardFeeAndGstMinor < p.priceAssumptions.afterCardFeeMinor);
  assert.ok(p.ownerActions.length >= 3);
  for (const a of p.ownerActions) assert.ok(a.ownerAction.length > 5);
  assert.ok(p.notes.some((n) => /does not promise sales or income/.test(n)));
});

test('preview is deterministic', () => {
  assert.deepEqual(buildPreview(first), buildPreview(first));
});

test('selecting creates one business and one queued build job', async () => {
  const d = deps();
  const r = await selectIdea(WS, first, undefined, d);
  assert.ok(r.ok);
  assert.equal(r.created, true);
  assert.equal(r.selection.key, selectionKey(WS, ideaIdOf(first)));
  assert.equal(r.selection.business.status, 'draft');
  assert.equal(r.selection.business.workspaceId, WS);
  assert.equal(r.selection.job.type, 'build_business');
  assert.equal(r.selection.job.status, 'queued');
  assert.equal(r.selection.job.businessId, r.selection.business.id);
  assert.equal(r.selection.job.idempotencyKey, r.selection.key);
  assert.equal(r.selection.revision, 1);
  assert.equal((await d.store.list(WS)).length, 1);
});

test('same idea twice, double-click and re-submit give one business and one job', async () => {
  const d = deps();
  const a = await selectIdea(WS, first, undefined, d);
  const b = await selectIdea(WS, first, undefined, d);
  const [c, e] = await Promise.all([selectIdea(WS, first, undefined, d), selectIdea(WS, first, { pricePointMinor: 2500 }, d)]);
  assert.ok(a.ok && b.ok && c.ok && e.ok);
  assert.equal(a.created, true);
  for (const r of [b, c, e]) { assert.equal(r.created, false); assert.equal(r.selection.business.id, a.selection.business.id); assert.equal(r.selection.job.id, a.selection.job.id); }
  assert.equal((await d.store.list(WS)).length, 1);
  assert.equal(e.selection.inputs.pricePointMinor, a.selection.inputs.pricePointMinor, 're-submit with other inputs does not change the saved record');
});

test('simultaneous first selections create exactly one record', async () => {
  const d = deps();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => selectIdea(WS, first, undefined, d)));
  assert.equal(rs.filter((r) => r.ok && r.created).length, 1);
  assert.equal(new Set(rs.map((r) => r.ok && r.selection.job.id)).size, 1);
  assert.equal((await d.store.list(WS)).length, 1);
});

test('a different idea, or the same idea in another workspace, is a separate record', async () => {
  const d = deps();
  const a = await selectIdea(WS, first, undefined, d);
  const b = await selectIdea(WS, second, undefined, d);
  const c = await selectIdea('other-workspace', first, undefined, d);
  assert.ok(a.ok && b.ok && c.ok);
  assert.ok(a.created && b.created && c.created);
  assert.equal(new Set([a, b, c].map((r) => r.selection.business.id)).size, 3);
  assert.equal(new Set([a, b, c].map((r) => r.selection.job.id)).size, 3);
  assert.equal((await d.store.list(WS)).length, 2);
  assert.equal((await d.store.list('other-workspace')).length, 1, 'list is tenant-scoped');
  assert.deepEqual((await d.store.list('other-workspace')).map((r) => r.key), [c.selection.key]);
  assert.equal((await d.store.list('nobody')).length, 0);
});

test('edits persist on the same record without a second business or job', async () => {
  const d = deps();
  const a = await selectIdea(WS, first, undefined, d);
  assert.ok(a.ok);
  const e = await editSelection(WS, first, { pricePointMinor: 1900, audience: 'Busy parents of toddlers', niche: 'Toddler meal planner' }, d);
  assert.ok(e.ok);
  assert.equal(e.selection.business.id, a.selection.business.id);
  assert.equal(e.selection.job.id, a.selection.job.id);
  assert.equal(e.selection.revision, 2);
  assert.equal(e.selection.business.niche, 'Toddler meal planner');
  assert.equal(e.preview.priceAssumptions.priceMinor, 1900);
  const again = await selectIdea(WS, first, undefined, d);
  assert.ok(again.ok);
  assert.equal(again.created, false);
  assert.equal(again.selection.inputs.pricePointMinor, 1900);
  assert.equal(again.preview.inputs.audience, 'Busy parents of toddlers');
  const loaded = await loadSelection(WS, first, d);
  assert.equal(loaded?.selection.revision, 2);
  assert.equal((await d.store.list(WS)).length, 1);
});

test('invalid edits are rejected in plain English and leave the record unchanged', async () => {
  const d = deps();
  await selectIdea(WS, first, undefined, d);
  const bad = await editSelection(WS, first, { pricePointMinor: 5 }, d);
  assert.ok(!bad.ok);
  assert.match(bad.errors[0]!.message, /Price point must be between/);
  const loaded = await loadSelection(WS, first, d);
  assert.equal(loaded?.selection.revision, 1);
});

test('edit before selecting is refused; edits before saving are shown by the preview', async () => {
  const d = deps();
  const e = await editSelection(WS, first, { pricePointMinor: 1500 }, d);
  assert.ok(!e.ok);
  const pre = buildPreview(first, { pricePointMinor: 1500 });
  assert.ok(pre.ok);
  assert.equal(pre.preview.priceAssumptions.priceMinor, 1500);
  const sel = await selectIdea(WS, first, { pricePointMinor: 1500 }, d);
  assert.ok(sel.ok);
  assert.equal(sel.selection.inputs.pricePointMinor, 1500);
});

test('invalid ideas and workspaces are rejected and nothing is saved', async () => {
  const d = deps();
  for (const bad of [null, undefined, 'idea', {}, { niche: 'x' }, { ...first, niche: '' }, { ...first, blueprint: { id: 'nope', version: '1.0.0' } }, { ...first, blueprint: { id: first.blueprint.id, version: '9.9.9' } }]) {
    const r = await selectIdea(WS, bad, undefined, d);
    assert.ok(!r.ok, JSON.stringify(bad));
    assert.ok(r.errors.length > 0);
  }
  const ws = await selectIdea('', first, undefined, d);
  assert.ok(!ws.ok);
  assert.equal(ws.errors[0]!.field, 'workspaceId');
  const inputs = await selectIdea(WS, first, { weeklyHours: 0 }, d);
  assert.ok(!inputs.ok);
  assert.equal((await d.store.list(WS)).length, 0);
});

test('browser-backed demo store persists and reloads, and stays idempotent after reload', async () => {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const a = { ...deps(), store: createMemoryStore({ storage }) };
  assert.equal(a.store.kind, 'browser');
  const first1 = await selectIdea(WS, first, undefined, a);
  const b = { ...deps(), store: createMemoryStore({ storage }) };
  const first2 = await selectIdea(WS, first, undefined, b);
  assert.ok(first1.ok && first2.ok);
  assert.equal(first2.created, false);
  assert.equal(first2.selection.business.id, first1.selection.business.id);
  assert.equal(createMemoryStore().kind, 'memory');
  assert.equal(createMemoryStore({ storage: { getItem: () => '{bad', setItem: () => { throw new Error('full'); } } }).kind, 'browser');
});

test('two store instances on one storage (two tabs) give one business and one job', async () => {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  // both stores are created before either writes, so each starts with an empty view
  const tabA = { ...deps(), store: createMemoryStore({ storage }) };
  const tabB = { ...deps(), store: createMemoryStore({ storage }), newId: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
  const [x, y] = await Promise.all([selectIdea(WS, first, undefined, tabA), selectIdea(WS, first, undefined, tabB)]);
  assert.ok(x.ok && y.ok);
  assert.equal([x, y].filter((r) => r.created).length, 1);
  assert.equal(x.selection.business.id, y.selection.business.id);
  assert.equal(x.selection.job.id, y.selection.job.id);
  assert.equal((await tabA.store.list(WS)).length, 1);
  assert.equal((await tabB.store.list(WS)).length, 1);
  // an edit in one tab is seen by the other, and the other tab's edit builds on it
  const e1 = await editSelection(WS, first, { pricePointMinor: 2000 }, tabA);
  const e2 = await editSelection(WS, first, { weeklyHours: 3 }, tabB);
  assert.ok(e1.ok && e2.ok);
  assert.equal(e2.selection.revision, 3);
  assert.equal(e2.selection.inputs.pricePointMinor, 2000);
  assert.equal(e2.selection.inputs.weeklyHours, 3);
});

test('stored records with a bad shape are dropped on load', async () => {
  const good = (await selectIdea(WS, first, undefined, deps()));
  assert.ok(good.ok);
  const data = new Map<string, string>([['aimp.selection.demo.v1', JSON.stringify([
    good.selection, { key: 'x' }, null, 5, { ...good.selection, key: 'select:tampered', job: { ...good.selection.job, idempotencyKey: 'select:tampered' } },
    { ...good.selection, business: { ...good.selection.business, workspaceId: 'someone-else' } },
  ])]]);
  const store = createMemoryStore({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } } });
  assert.deepEqual((await store.list(WS)).map((r) => r.key), [good.selection.key]);
  const notArray = createMemoryStore({ storage: { getItem: () => '{"a":1}', setItem: () => {} } });
  assert.equal((await notArray.list(WS)).length, 0);
});

test('idea ids do not collide for case, punctuation, non-Latin or all-symbol niches', () => {
  const niches = ['Pet care', 'Pet-care!', 'pet care', 'PET CARE', 'Pet  care', 'ペットケア', '宠物护理', 'Уход за питомцами', '!!!', '???', '😀😀', 'Pet care '];
  const idea = (niche: string, who = 'Pet owners') => ({ niche, whoToSellTo: who, blueprint: { id: 'printable-planner', version: '1.0.0' } });
  const ids = niches.map((n) => ideaIdOf(idea(n)));
  // 'Pet  care' and 'Pet care ' are whitespace variants of 'Pet care' and share its id on purpose; every other variant differs
  const expectedSame = new Set([ideaIdOf(idea('Pet care')), ideaIdOf(idea('Pet  care')), ideaIdOf(idea('Pet care '))]);
  assert.equal(expectedSame.size, 1);
  assert.equal(new Set(ids).size, niches.length - 2);
  assert.match(ideaIdOf(idea('Pet care')), /^printable-planner@1\.0\.0:pet-care-[0-9a-f]{10}$/);
  assert.match(ideaIdOf(idea('宠物护理')), /^printable-planner@1\.0\.0:-[0-9a-f]{10}$/);
  assert.notEqual(ideaIdOf(idea('Pet care', 'Dog owners')), ideaIdOf(idea('Pet care', 'Cat owners')), 'audience is part of the id');
  assert.equal(ideaIdOf(idea('Pet care')), ideaIdOf(idea('Pet care')), 'stable');
});

test('non-Latin niches select as separate records', async () => {
  const d = deps();
  const mk = (niche: string) => ({ ...first, niche });
  const a = await selectIdea(WS, mk('宠物护理'), undefined, d);
  const b = await selectIdea(WS, mk('ペットケア'), undefined, d);
  assert.ok(a.ok && b.ok);
  assert.ok(a.created && b.created);
  assert.notEqual(a.selection.business.id, b.selection.business.id);
  assert.equal((await d.store.list(WS)).length, 2);
});

test('concurrent edits do not lose updates', async () => {
  const d = deps();
  await selectIdea(WS, first, undefined, d);
  const [p, h] = await Promise.all([editSelection(WS, first, { pricePointMinor: 2200 }, d), editSelection(WS, first, { weeklyHours: 4 }, d)]);
  assert.ok(p.ok && h.ok);
  const now2 = await loadSelection(WS, first, d);
  assert.equal(now2?.selection.revision, 3);
  assert.equal(now2?.selection.inputs.pricePointMinor, 2200);
  assert.equal(now2?.selection.inputs.weeklyHours, 4);
});

test('expectedRevision rejects a stale edit with a clear error and changes nothing', async () => {
  const d = deps();
  await selectIdea(WS, first, undefined, d);
  const ok = await editSelection(WS, first, { pricePointMinor: 1500 }, d, { expectedRevision: 1 });
  assert.ok(ok.ok);
  assert.equal(ok.selection.revision, 2);
  const stale = await editSelection(WS, first, { pricePointMinor: 9000 }, d, { expectedRevision: 1 });
  assert.ok(!stale.ok);
  assert.equal(stale.errors[0]!.field, 'revision');
  assert.match(stale.errors[0]!.message, /changed since you opened them/);
  const after = await loadSelection(WS, first, d);
  assert.equal(after?.selection.revision, 2);
  assert.equal(after?.selection.inputs.pricePointMinor, 1500);
  const racing = await Promise.all([editSelection(WS, first, { weeklyHours: 2 }, d, { expectedRevision: 2 }), editSelection(WS, first, { weeklyHours: 5 }, d, { expectedRevision: 2 })]);
  assert.equal(racing.filter((r) => r.ok).length, 1);
});

test('a repeat selection returns the existing record even if the new inputs are invalid', async () => {
  const d = deps();
  const a = await selectIdea(WS, first, undefined, d);
  const again = await selectIdea(WS, first, { pricePointMinor: 1 }, d);
  assert.ok(a.ok && again.ok);
  assert.equal(again.created, false);
  assert.equal(again.selection.business.id, a.selection.business.id);
  const firstTimeBad = await selectIdea(WS, second, { pricePointMinor: 1 }, d);
  assert.ok(!firstTimeBad.ok);
});

test('adapter maps a selection onto the businesses contract and rejects a non-uuid workspace', async () => {
  const d = deps();
  const r = await selectIdea(WS, first, undefined, d);
  assert.ok(r.ok);
  const nb = selectionToNewBusiness(r.selection);
  assert.equal(nb.workspaceId, WS);
  assert.equal(nb.blueprintVersion, 1);
  assert.equal(nb.model, 'digital-templates');
  const calls: { key: string; business: unknown }[] = [];
  const saved = await saveSelection({ insertOnce: async (record, business) => { calls.push({ key: record.key, business }); return { record, created: true }; } }, r.selection);
  assert.equal(saved.created, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.key, r.selection.key);
  // the db layer receives the validated businesses-contract shape, written out independently of the mapper
  assert.deepEqual(calls[0]!.business, { workspaceId: WS, blueprintId: first.blueprint.id, blueprintVersion: 1, niche: first.niche, model: 'digital-templates' });
  // an invalid record never reaches the database layer
  const bad = { ...r.selection, workspaceId: 'not-a-uuid' };
  await assert.rejects(saveSelection({ insertOnce: async () => { throw new Error('must not be called'); } }, bad), /workspaceId: must be a uuid/);
  const demo = await selectIdea('demo-workspace', first, undefined, d);
  assert.ok(demo.ok);
  assert.throws(() => selectionToNewBusiness(demo.selection), /workspaceId: must be a uuid/);
});

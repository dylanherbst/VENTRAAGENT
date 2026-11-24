import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseGaps, planAround, sanitizeCompetitor, EXAMPLE_COMPETITORS, BUILT_ON_TEST_DATA, safeUrl } from '../lib/aimp/gaps/analyse.ts';

const bareC = (id: string, c?: 'not_offered') => ({ id, name: id, frictions: [], steps: c ? { demand: { coverage: c } } : {} });

test('no competitors means no gaps, never an invented one', () => { assert.deepEqual(analyseGaps([], BUILT_ON_TEST_DATA), []); });

test('the example ranks demand testing and first customers above the generic steps', () => {
  const g = analyseGaps(EXAMPLE_COMPETITORS, BUILT_ON_TEST_DATA);
  assert.ok(g.length >= 2);
  assert.ok(['demand', 'customers'].includes(g[0]!.step));
  assert.ok(g.findIndex((x) => x.step === 'demand') < g.findIndex((x) => x.step === 'page'));
});

test('a gap with a source link is "evidenced"; ratings without one are "absence only"', () => {
  const g = analyseGaps(EXAMPLE_COMPETITORS, BUILT_ON_TEST_DATA).find((x) => x.step === 'demand')!;
  assert.equal(g.confidence, 'evidenced');
  const bare = analyseGaps([{ id: 'a', name: 'A', frictions: [], steps: { demand: { coverage: 'not_offered' } } }], BUILT_ON_TEST_DATA).find((x) => x.step === 'demand')!;
  assert.equal(bare.confidence, 'absence only');
  const thin = analyseGaps([bareC('a', 'not_offered'), bareC('b'), bareC('c')], BUILT_ON_TEST_DATA).find((x) => x.step === 'demand')!;
  assert.equal(thin.confidence, 'thin'); // two of three competitors not checked
});

test('an unknown step is never counted as a gap', () => {
  const g = analyseGaps([{ id: 'a', name: 'A', frictions: [], steps: {} }], BUILT_ON_TEST_DATA);
  assert.deepEqual(g, []);
});

test('the landing-page claim stays locked until the ability is proved', () => {
  const locked = analyseGaps(EXAMPLE_COMPETITORS, BUILT_ON_TEST_DATA).find((x) => x.step === 'demand')!;
  assert.equal(locked.claim.unlocked, false);
  assert.match(locked.claim.lockedReason!, /Not built yet/);
  const open = analyseGaps(EXAMPLE_COMPETITORS, { ...BUILT_ON_TEST_DATA, demand: 'proved' }).find((x) => x.step === 'demand')!;
  assert.equal(open.claim.unlocked, true);
  assert.equal(open.claim.lockedReason, null);
  const built = analyseGaps(EXAMPLE_COMPETITORS, { ...BUILT_ON_TEST_DATA, customers: 'built' }).find((x) => x.step === 'customers')!;
  assert.match(built.claim.lockedReason!, /test data only/);
});

test('the plan keeps the main job first and adds at most three gap tasks', () => {
  const p = planAround('Sell a meal-planner workbook', analyseGaps(EXAMPLE_COMPETITORS, BUILT_ON_TEST_DATA));
  assert.equal(p.mainJob, 'Sell a meal-planner workbook');
  assert.ok(p.add.length <= 3 && p.add.length >= 1);
});

test('input is cleaned: bad urls and unknown values are dropped, names are required', () => {
  assert.equal(sanitizeCompetitor({ name: '   ' } as never), null);
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  const c = sanitizeCompetitor({ name: 'X', steps: { demand: { coverage: 'weird' as never, evidenceUrl: 'ftp://x' } } as never, frictions: [{ text: '' }, { text: 'slow' }] })!;
  assert.equal(c.steps.demand!.coverage, 'unknown');
  assert.equal(c.steps.demand!.evidenceUrl, undefined);
  assert.equal(c.frictions.length, 1);
});

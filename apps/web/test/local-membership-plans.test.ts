import test from 'node:test';
import assert from 'node:assert/strict';
import { addPerk, addTier, blankPlans, newPerks, persistPlans, removePerk, removeTier, restorePlans, sharedPerks, tierLimit, validatePlans } from '../lib/local-membership-plans.ts';

const P = 'p1';
const NOW = '2026-11-03T00:00:00Z';
const mem = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; } }; };
const base = () => {
  let m = addTier(addTier(blankPlans(P), { id: 'a', name: ' Basic ', priceText: ' $10 a month ' }), { id: 'b', name: 'Plus', priceText: 'Free trial, then about $25', pitch: 'More support' });
  m = addPerk(m, 'a', 'Monthly Q and A'); m = addPerk(m, 'b', 'monthly q and a'); m = addPerk(m, 'b', 'Private chat');
  return m;
};

test('valid plans, trimming and validation limits', () => {
  assert.deepEqual(validatePlans(base()).problems, []);
  assert.equal(base().tiers[0].name, 'Basic');
  const m = base();
  const bad = (o: object) => validatePlans({ ...m, tiers: [{ ...m.tiers[0], ...o }] }).problems.length > 0;
  assert.ok(bad({ name: '' })); assert.ok(bad({ name: 'x'.repeat(81) })); assert.ok(!bad({ name: 'x'.repeat(80) }));
  assert.ok(bad({ priceText: '' })); assert.ok(bad({ priceText: 'x'.repeat(81) })); assert.ok(bad({ pitch: 'x'.repeat(301) }));
  assert.ok(bad({ perks: ['']})); assert.ok(bad({ perks: Array(13).fill('x') })); assert.ok(!bad({ perks: Array(12).fill('x') }));
  assert.ok(validatePlans({ ...m, tiers: [m.tiers[0], { ...m.tiers[1], name: 'BASIC' }] }).problems.length, 'names compared ignoring case');
  assert.ok(validatePlans({ ...m, tiers: [m.tiers[0], { ...m.tiers[1], id: 'a' }] }).problems.length);
});
test('price wording is kept as written and never parsed', () => {
  assert.equal(base().tiers[1].priceText, 'Free trial, then about $25');
});
test('tier cap and perk cap', () => {
  let m = blankPlans(P);
  for (let i = 0; i < tierLimit; i++) m = addTier(m, { id: `t${i}`, name: `T${i}`, priceText: 'x' });
  assert.throws(() => addTier(m, { id: 'z', name: 'Z', priceText: 'x' }), /Up to 6/);
  for (let i = 0; i < 12; i++) m = addPerk(m, 't0', `p${i}`);
  assert.throws(() => addPerk(m, 't0', 'more'), /Up to 12/);
  assert.throws(() => addPerk(m, 'nope', 'x'), /not found/);
  assert.throws(() => addPerk(m, 't1', '  '), /Enter/);
});
test('remove tier and perk', () => {
  assert.equal(removeTier(base(), 'a').tiers.length, 1);
  assert.deepEqual(removePerk(base(), 'b', 0).tiers[1].perks, ['Private chat']);
});
test('shared and new perks compare ignoring case', () => {
  assert.deepEqual(sharedPerks(base()), ['monthly q and a']);
  assert.deepEqual(newPerks(base(), 'a'), ['Monthly Q and A']);
  assert.deepEqual(newPerks(base(), 'b'), ['Private chat']);
  assert.deepEqual(newPerks(base(), 'zzz'), []);
});
test('restore is strict and null when empty', () => {
  assert.equal(restorePlans(null, P), null);
  assert.throws(() => restorePlans('nope', P), /Nothing was overwritten/);
  assert.throws(() => restorePlans('[]', P), /Nothing was overwritten/);
  assert.throws(() => restorePlans(JSON.stringify(base()), 'other'), /Nothing was overwritten/);
  assert.throws(() => restorePlans('x'.repeat(64001), P), /too large/);
  assert.equal(restorePlans(JSON.stringify(base()), P)?.tiers.length, 2);
});
test('persist bumps revision, round-trips and refuses stale writes', () => {
  const s = mem();
  const raw = persistPlans(s, P, null, base(), NOW);
  assert.equal(restorePlans(raw, P)?.revision, 1);
  const raw2 = persistPlans(s, P, raw, restorePlans(raw, P)!, NOW);
  assert.equal(restorePlans(raw2, P)?.revision, 2);
  assert.throws(() => persistPlans(s, P, raw, base(), NOW), /another tab/);
  assert.throws(() => persistPlans(mem(), P, null, { ...base(), profileId: 'x' }, NOW), /another profile/);
  assert.throws(() => persistPlans(mem(), P, null, base(), 'bad'), /time/);
});

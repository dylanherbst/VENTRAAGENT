import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringFactors } from '../lib/aimp/contracts.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { InvalidProfileError, PROFILE_LIMITS, demoCandidates, findOpportunities, validateProfile } from '../lib/aimp/opportunities/index.ts';

const now = () => new Date('2026-11-14T00:00:00.000Z');
const profile = { budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' };

test('returns exactly five ideas, ranked best first', () => {
  const r = findOpportunities(profile, { now });
  assert.equal(r.ideas.length, 5);
  assert.equal(r.shortfall, undefined);
  r.ideas.forEach((idea, i) => assert.equal(idea.rank, i + 1));
  for (let i = 1; i < r.ideas.length; i++) assert.ok(r.ideas[i - 1].fitScore >= r.ideas[i].fitScore);
});

test('every idea explains what, who and why, links a blueprint and labels the fit score', () => {
  for (const idea of findOpportunities(profile, { now }).ideas) {
    assert.ok(idea.whatToSell.length > 5);
    assert.ok(idea.whoToSellTo.length > 5);
    assert.ok(idea.whyItFits.length > 0);
    assert.ok(blueprintRegistry.get(idea.blueprint.id, idea.blueprint.version));
    assert.equal(idea.fitScoreLabel, 'fit score');
    assert.match(idea.notice, /not a prediction of earnings/);
    assert.deepEqual(Object.keys(idea.factors).sort(), [...scoringFactors].sort());
  }
  const meal = findOpportunities(profile, { now }).ideas.find((i) => /meal/i.test(i.niche));
  assert.ok(meal?.whyItFits.some((w) => /interest in .*cooking/.test(w)), 'reason is tied to the profile');
});

test('missing evidence is surfaced and uses a placeholder, never invented evidence', () => {
  const r = findOpportunities(profile, { now });
  const withGaps = r.ideas.filter((i) => i.missingEvidence.length > 0);
  assert.ok(withGaps.length > 0);
  for (const idea of r.ideas) {
    for (const f of scoringFactors) {
      const b = idea.factors[f];
      assert.equal(b.missingEvidence, idea.missingEvidence.includes(f));
      if (b.missingEvidence) { assert.equal(b.evidence.length, 0); assert.equal(b.confidence, 'low'); assert.ok(b.assumption); }
      else assert.ok(b.evidence.length > 0);
    }
  }
});

test('an idea with no demand evidence is left out with a reason, not guessed', () => {
  const r = findOpportunities({ ...profile, budgetMinor: 100000, weeklyHours: 20 }, { now });
  assert.equal(r.ideas.length, 5);
  assert.ok(!r.ideas.some((i) => /homeschool/i.test(i.niche)));
  const homeschool = demoCandidates.filter((c) => c.id === 'homeschool-kit' || c.id === 'meal-planner' || c.id === 'wedding-checklist');
  const few = findOpportunities({ ...profile, budgetMinor: 100000, weeklyHours: 20 }, { now, candidates: homeschool });
  assert.equal(few.ideas.length, 2);
  assert.ok(few.shortfall);
  assert.match(few.shortfall.reason, /Only 2 of 5/);
  assert.deepEqual(few.shortfall.excluded.map((e) => e.reason), ['No demand evidence found, so it is not ranked']);
  const small = findOpportunities({ ...profile, budgetMinor: 3000 }, { now, candidates: demoCandidates.filter((c) => c.blueprintId === 'niche-kit' || c.id === 'meal-planner') });
  assert.equal(small.ideas.length, 1);
  assert.ok(small.shortfall?.excluded.every((e) => /over the \$30\.00 budget/.test(e.reason)));
  const few3 = findOpportunities(profile, { now, candidates: demoCandidates.slice(0, 3) });
  assert.equal(few3.ideas.length, 3);
  assert.match(few3.shortfall?.reason ?? '', /not enough candidates/);
});

test('a tiny budget returns fewer ideas with an explicit reason', () => {
  const r = findOpportunities({ ...profile, budgetMinor: 0 }, { now });
  assert.equal(r.ideas.length, 0);
  assert.equal(r.shortfall?.returned, 0);
  assert.ok(r.shortfall?.excluded.length);
});

test('results are deterministic for the same profile and injected time', () => {
  const a = findOpportunities(profile, { now });
  const b = findOpportunities(structuredClone(profile), { now });
  assert.deepEqual(a, b);
  assert.equal(a.generatedAt, '2026-11-14T00:00:00.000Z');
  const later = findOpportunities(profile, { now: () => new Date('2027-01-01T00:00:00.000Z') });
  assert.deepEqual(later.ideas.map((i) => i.niche), a.ideas.map((i) => i.niche));
  assert.equal(later.ideas[0].factors.demand.evidence[0].retrievedAt, '2027-01-01T00:00:00.000Z');
});

test('invalid profiles are rejected with a typed error listing the problems', () => {
  const bad: unknown[] = [
    null, 'x', [], { ...profile, budgetMinor: -1 }, { ...profile, budgetMinor: 10.5 }, { ...profile, weeklyHours: 0 },
    { ...profile, weeklyHours: 41 }, { ...profile, preferredEffort: 'extreme' }, { ...profile, interests: 'cooking' },
    { ...profile, skills: [''] }, { ...profile, interests: Array(11).fill('cooking') },
  ];
  for (const p of bad) {
    assert.throws(() => findOpportunities(p, { now }), (e: unknown) => e instanceof InvalidProfileError && e.code === 'invalid_profile' && e.issues.length > 0);
  }
  assert.throws(() => validateProfile({}), (e: unknown) => e instanceof InvalidProfileError && e.issues.length === 5);
  assert.throws(() => findOpportunities(profile, { now: () => new Date('nope') }), TypeError);
});

test('fixture evidence is labelled demo/fixture with a date and confidence', () => {
  const r = findOpportunities(profile, { now });
  assert.equal(r.mode, 'fixture');
  for (const idea of r.ideas) {
    for (const f of scoringFactors) {
      for (const e of idea.factors[f].evidence) {
        assert.equal(e.label, 'demo/fixture');
        assert.equal(e.url, 'fixture');
        assert.match(e.note, /^Demo data:/);
        assert.equal(e.retrievedAt, '2026-11-14T00:00:00.000Z');
        assert.ok(['low', 'medium', 'high'].includes(e.confidence));
        assert.ok(e.source.length > 0);
      }
    }
  }
});

test('live mode without a supplied source has no market evidence and invents none', () => {
  const r = findOpportunities(profile, { now, mode: 'live' });
  assert.equal(r.ideas.length, 0);
  assert.ok(r.shortfall?.excluded.every((e) => /No demand evidence/.test(e.reason)));
});

test('fixture evidence and every fixture signal are capped at low confidence', () => {
  for (const c of demoCandidates) for (const sig of Object.values(c.signals)) assert.equal(sig.confidence, 'low');
  for (const idea of findOpportunities(profile, { now }).ideas) {
    assert.equal(idea.confidence, 'low');
    for (const f of scoringFactors) for (const e of idea.factors[f].evidence) assert.equal(e.confidence, 'low');
  }
});

test('live startup-cost evidence is labelled internal, not live or market data', () => {
  const live = (c: { id: string }) => c.id === 'meal-planner'
    ? { demand: { score: 7, confidence: 'medium' as const, note: 'sample', source: 'Test source', url: 'https://example.test/x' } }
    : {};
  const r = findOpportunities(profile, { now, mode: 'live', liveSignals: live });
  assert.equal(r.ideas.length, 1);
  const startup = r.ideas[0].factors.lowStartupCost.evidence[0];
  assert.equal(startup.label, 'internal');
  assert.match(startup.note, /blueprint default, not market data/);
  assert.equal(r.ideas[0].factors.demand.evidence[0].label, 'live');
});

test('ideas are matched by candidate id, so duplicate niche names keep their own details', () => {
  const [a, b] = demoCandidates.filter((c) => c.id === 'meal-planner' || c.id === 'wedding-checklist');
  const twin = { ...b, niche: a.niche };
  const r = findOpportunities(profile, { now, candidates: [a, twin] });
  assert.equal(r.ideas.length, 2);
  assert.deepEqual(r.ideas.map((i) => i.whatToSell).sort(), [a.whatToSell, b.whatToSell].sort());
  assert.deepEqual(r.ideas.map((i) => i.blueprint.id).sort(), [a.blueprintId, b.blueprintId].sort());
});

test('profile limits are exported and enforced', () => {
  assert.equal(PROFILE_LIMITS.weeklyHours.max, 40);
  assert.equal(PROFILE_LIMITS.listItem.minLength, 2);
  assert.doesNotThrow(() => validateProfile({ ...profile, budgetMinor: PROFILE_LIMITS.budgetMinor.max, weeklyHours: PROFILE_LIMITS.weeklyHours.min }));
  assert.throws(() => validateProfile({ ...profile, budgetMinor: PROFILE_LIMITS.budgetMinor.max + 1 }), InvalidProfileError);
  assert.throws(() => validateProfile({ ...profile, weeklyHours: PROFILE_LIMITS.weeklyHours.max + 1 }), InvalidProfileError);
  assert.throws(() => validateProfile({ ...profile, interests: Array(PROFILE_LIMITS.listMaxItems + 1).fill('cooking') }), InvalidProfileError);
});

test('runs with no network access', () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('network is not allowed'); }) as typeof fetch;
  try {
    assert.equal(findOpportunities(profile, { now }).ideas.length, 5);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = real; }
});

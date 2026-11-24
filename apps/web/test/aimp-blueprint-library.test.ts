import assert from 'node:assert/strict';
import test from 'node:test';
import { engineFor } from '../lib/aimp/contracts.ts';
import {
  blueprintFamilies, blueprintRegistry, compareSemver, createRegistry, generateLaunchPlan, launchBlueprints,
  nicheKit, printablePlanner, printableTracker, validateBlueprint,
} from '../lib/aimp/blueprints/index.ts';
import type { BlueprintDefinition } from '../lib/aimp/blueprints/index.ts';

const inputs = { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const v2: BlueprintDefinition = { ...printablePlanner, version: '1.1.0', output: { ...printablePlanner.output, sections: [{ title: 'Cover', pages: 1 }, { title: 'Weekly pages', pages: 10 }] } };

test('every shipped blueprint validates and uses the document engine', () => {
  assert.deepEqual(launchBlueprints.map((b) => b.family).sort(), [...blueprintFamilies].sort());
  for (const b of launchBlueprints) {
    assert.deepEqual(validateBlueprint(b), { ok: true, errors: [] });
    assert.equal(b.engine, 'document');
    assert.ok(engineFor[b.businessModel].includes('document'));
    assert.equal(blueprintRegistry.get(b.id, b.version), b);
    const r = generateLaunchPlan(b, inputs);
    assert.equal(r.ok && r.plan.blueprint.engine, 'document');
  }
  assert.equal(printablePlanner.version, '1.0.0');
});

test('schema validation gives plain-English errors and does not throw', () => {
  const bad = validateBlueprint({ ...printablePlanner, id: 'Bad Id', version: '1.0', family: 'poster', engine: 'visual', qaChecklist: [], steps: [] });
  assert.equal(bad.ok, false);
  const text = bad.errors.join('\n');
  assert.match(text, /lower-case words joined by dashes/);
  assert.match(text, /1\.0\.0/);
  assert.match(text, /family must be one of: planner, tracker, checklist, niche-kit/);
  assert.match(text, /engine must be "document"/);
  assert.match(text, /QA checklist/);
  assert.match(text, /at least one build step/);
  assert.equal(validateBlueprint(null).ok, false);
  assert.equal(validateBlueprint({ ...printablePlanner, marketing: { channels: ['Email'], launchContent: [{ day: 0, channel: 'TikTok', title: 'x' }] } }).ok, false);
  assert.equal(validateBlueprint({ ...printablePlanner, fulfilment: { ...printablePlanner.fulfilment, method: 'post' } }).ok, false);
});

test('registry keeps old versions retrievable and returns the newest by default', () => {
  const r = createRegistry([printablePlanner, v2]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.registry.versions('printable-planner'), ['1.0.0', '1.1.0']);
  assert.equal(r.registry.get('printable-planner', '1.0.0'), printablePlanner);
  assert.equal(r.registry.get('printable-planner', '1.1.0'), v2);
  assert.equal(r.registry.find('printable-planner')?.version, '1.1.0');
  assert.equal(r.registry.find('printable-planner', '1.0.0')?.version, '1.0.0');
  assert.equal(r.registry.find('printable-planner', '9.9.9'), undefined);
  assert.equal(r.registry.find('nope'), undefined);
  assert.ok(compareSemver('1.10.0', '1.9.0') > 0);
});

test('registry rejects duplicates and invalid blueprints with readable messages', () => {
  const dup = createRegistry([printablePlanner, printablePlanner]);
  assert.equal(dup.ok, false);
  assert.match(!dup.ok ? dup.errors.join(' ') : '', /already registered/);
  const bad = createRegistry([{ ...printablePlanner, version: 'one' }]);
  assert.equal(bad.ok, false);
});

test('same inputs and version give an identical plan that records id and version', () => {
  const a = generateLaunchPlan(printablePlanner, inputs);
  const b = generateLaunchPlan(printablePlanner, { ...inputs });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(JSON.stringify(a.plan), JSON.stringify(b.plan));
  assert.deepEqual(a.plan.blueprint, { id: 'printable-planner', version: '1.0.0', family: 'planner', engine: 'document' });
  const c = generateLaunchPlan(v2, inputs);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.plan.blueprint.version, '1.1.0');
  assert.notEqual(c.plan.product.totalPages, a.plan.product.totalPages);
});

test('the plan covers outline, steps, cost, QA, fulfilment and marketing', () => {
  const r = generateLaunchPlan(printablePlanner, inputs);
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = r.plan;
  assert.equal(p.product.totalPages, 48);
  assert.deepEqual(p.product.formats, ['PDF', 'ZIP']);
  assert.ok(p.steps.every((s) => s.ownerAction.length > 0));
  assert.equal(p.schedule.totalHours, 5);
  assert.equal(p.schedule.weeksToLaunch, 1);
  assert.equal(p.cost.totalMinor, 2800);
  assert.equal(p.cost.withinBudget, true);
  assert.equal(p.cost.salesToCoverCost, 2);
  assert.equal(p.fulfilment.method, 'digital-download');
  assert.ok(p.qa.length >= 5);
  assert.ok(p.marketing.schedule.length > 0);
  assert.ok(p.marketing.schedule.every((m, i, a) => i === 0 || a[i - 1]!.day <= m.day));
  assert.ok(p.marketing.pinIdeas.length > 0, 'wedding planning matches a tested preview niche');
});

test('fewer weekly hours stretch the schedule and a small budget is flagged', () => {
  const r = generateLaunchPlan(printablePlanner, { ...inputs, weeklyHours: 1, budgetMinor: 1000 });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.plan.schedule.weeksToLaunch, 5);
  assert.equal(r.plan.cost.withinBudget, false);
  assert.equal(r.plan.cost.shortfallMinor, 1800);
  const other = generateLaunchPlan(printablePlanner, { ...inputs, niche: 'Quiet hobby' });
  assert.ok(other.ok && other.plan.marketing.pinIdeas.length === 0);
});

test('hours must be finite, and the inputs the planner reads must be declared', () => {
  const inf = validateBlueprint({ ...printablePlanner, steps: [{ title: 'a', ownerAction: 'b', hours: Infinity }] });
  assert.equal(inf.ok, false);
  assert.match(inf.errors.join(' '), /hours of zero or more/);
  assert.equal(validateBlueprint({ ...printablePlanner, steps: [{ title: 'a', ownerAction: 'b', hours: NaN }] }).ok, false);
  const noPrice = validateBlueprint({ ...printablePlanner, requiredInputs: printablePlanner.requiredInputs.filter((i) => i.key !== 'pricePointMinor') });
  assert.equal(noPrice.ok, false);
  assert.match(noPrice.errors.join(' '), /must include "pricePointMinor"/);
  const zeroPrice = validateBlueprint({ ...printablePlanner, requiredInputs: printablePlanner.requiredInputs.map((i) => (i.key === 'pricePointMinor' ? { ...i, min: 0 } : i)) });
  assert.equal(zeroPrice.ok, false);
  assert.equal(generateLaunchPlan({ ...printablePlanner, requiredInputs: [] }, inputs).ok, false);
});

test('a niche with no tested pin ideas gets a visible note; a matching niche does not', () => {
  const none = generateLaunchPlan(printablePlanner, { ...inputs, niche: 'Quiet hobby' });
  assert.ok(none.ok);
  if (!none.ok) return;
  assert.ok(none.plan.notes.some((n) => /No tested pin ideas for this niche yet/.test(n)));
  const some = generateLaunchPlan(printablePlanner, inputs);
  assert.ok(some.ok && !some.plan.notes.some((n) => /No tested pin ideas/.test(n)));
});

test('blueprints do not share mutable data and planning does not mutate them', () => {
  assert.notEqual(printablePlanner.requiredInputs, printableTracker.requiredInputs);
  assert.notEqual(printablePlanner.steps[0], printableTracker.steps[0]);
  assert.notEqual(printablePlanner.marketing.launchContent, nicheKit.marketing.launchContent);
  const copy = structuredClone(printablePlanner);
  const freeze = (o: unknown): void => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } };
  freeze(copy);
  const r = generateLaunchPlan(copy, inputs);
  assert.ok(r.ok);
  if (r.ok) { r.plan.qa.push('x'); r.plan.cost.lines[0]!.label = 'changed'; r.plan.marketing.schedule.pop(); }
  assert.deepEqual(copy, printablePlanner);
});

test('invalid inputs return a typed error result with readable messages', () => {
  const r = generateLaunchPlan(printablePlanner, { niche: 'x', audience: '', pricePointMinor: 12.5, weeklyHours: 0, budgetMinor: '50' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  const byField = Object.fromEntries(r.errors.map((e) => [e.field, e.message]));
  assert.match(byField.niche!, /between 2 and 60 characters/);
  assert.match(byField.audience!, /required/);
  assert.match(byField.pricePointMinor!, /whole number/);
  assert.match(byField.weeklyHours!, /between 1 and 40/);
  assert.match(byField.budgetMinor!, /whole number/);
  for (const bad of [null, undefined, 'text', [], {}]) assert.equal(generateLaunchPlan(printablePlanner, bad).ok, false);
  const broken = generateLaunchPlan({ ...printablePlanner, steps: [] }, inputs);
  assert.equal(broken.ok, false);
  assert.equal(!broken.ok && broken.errors[0]!.field, 'blueprint');
});

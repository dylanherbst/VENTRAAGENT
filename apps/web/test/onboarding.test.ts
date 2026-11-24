import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRoute, blankProfile, buildPlan, enablePathway, profileErrors, restoreProfile, routeOf, routes, serializeProfile, tools } from '../lib/onboarding.ts';
import type { Pathway, Stage, Profile } from '../lib/onboarding.ts';
function profile(primary: Pathway = 'education', stage: Stage = 'idea'): Profile {
  return { ...blankProfile(), primary, pathways: [primary], stage, name: 'Lash Studio', audience: 'Perth lash clients', goal: 'Grow bookings', expertise: 'Lash application', industry: 'Beauty' };
}
test('each pathway and stage produces its relevant plan, with existing growth ordered first', () => {
  for (const path of ['education', 'business'] as const) for (const stage of ['idea', 'existing'] as const) {
    const steps = buildPlan(profile(path, stage));
    assert.equal(steps.length, stage === 'idea' ? 5 : 10);
    assert.equal(steps.filter(s => s.id.startsWith(`${path}-`)).length, 5);
    assert.equal(steps.some(s => s.id.startsWith(path === 'education' ? 'business-' : 'education-')), false);
    if (stage === 'existing') assert.deepEqual(steps.slice(0, 5).map(s => s.id), ['connect', 'import', 'agents', 'campaigns', 'conversions']);
    else assert.equal(steps[0].id, `${path}-${path === 'education' ? 'expertise' : 'understand'}`);
  }
});
test('second pathway activation preserves identity, shared details, progress and briefs; repeat activation is idempotent', () => {
  const before = { ...profile('business'), completed: ['business-understand'], toolNotes: { crm: 'Review consent before import' } };
  const next = enablePathway(before, 'education');
  assert.equal(next.id, before.id); assert.equal(next.name, before.name);
  assert.deepEqual(next.completed, before.completed); assert.deepEqual(next.toolNotes, before.toolNotes);
  assert.deepEqual(next.pathways, ['business', 'education']);
  assert.deepEqual(enablePathway(next, 'education'), next);
  const steps = buildPlan(next);
  assert.equal(steps.length, 10); assert.equal(new Set(steps.map(s => s.id)).size, 10);
  assert.deepEqual(before.pathways, ['business']);
});
test('business type, educational format and supplied audience flow into the generated plan', () => {
  const business = profile('business'); business.businessType = 'Digital products & services'; business.location = 'Online';
  assert.match(buildPlan(business)[0].detail, /digital products & services.*Beauty.*Online.*Perth lash clients/);
  const education = profile(); education.educationOffer = 'Mentorship';
  assert.match(buildPlan(education)[1].title, /mentorship/);
  assert.match(buildPlan(education)[0].detail, /Lash application.*Perth lash clients/);
});
test('local persistence round trip keeps profile, dual pathways, checked steps and tool notes', () => {
  const p = { ...enablePathway(profile('business', 'existing'), 'education'), completed: ['connect', 'business-understand'], toolNotes: { receptionist: 'Office hours 9–5' }, website: 'https://example.com', channels: 'Instagram' };
  assert.deepEqual(restoreProfile(serializeProfile(p)), p);
  assert.equal(tools.length, 8); assert.equal(new Set(tools.map(t => t.id)).size, 8);
});
test('malformed, unsupported or incomplete saved setup is not accepted as a valid profile', () => {
  const valid = profile();
  for (const bad of [null, '', '{oops', 'null', '[]', '{}', JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, primary: 'unknown' }), JSON.stringify({ ...valid, pathways: ['business'] }), JSON.stringify({ ...valid, pathways: ['education', 'education'] }), JSON.stringify({ ...valid, stage: 'unknown' }), JSON.stringify({ ...valid, completed: [5] }), JSON.stringify({ ...valid, toolNotes: [] }), JSON.stringify({ ...valid, educationOffer: 'Unknown' }), JSON.stringify({ ...valid, audience: '' })]) assert.equal(restoreProfile(bad), null);
});
test('validation blocks incomplete pathway-specific details and unsafe website schemes', () => {
  assert.ok(profileErrors(blankProfile()).length >= 4);
  assert.deepEqual(profileErrors(profile()), []);
  assert.ok(profileErrors({ ...profile(), expertise: '' }).length);
  assert.ok(profileErrors({ ...profile('business'), industry: '' }).length);
  assert.equal(profileErrors({ ...profile('business'), expertise: '' }).length, 0);
  for (const website of ['javascript:alert(1)', 'example.com', 'ftp://example.com']) assert.ok(profileErrors({ ...profile(), website }).length);
  assert.equal(profileErrors({ ...profile(), website: 'https://example.com' }).length, 0);
  assert.throws(() => serializeProfile(blankProfile()), /required business details/);
});

test('three customer routes map onto the one profile model and round-trip', () => {
  const base = profile('education', 'idea');
  const cases = [
    ['education', { primary: 'education', pathways: ['education'], stage: 'idea' }],
    ['independent', { primary: 'business', pathways: ['business'], stage: 'idea' }],
    ['grow', { primary: 'business', pathways: ['business'], stage: 'existing' }],
  ] as const;
  for (const [route, expected] of cases) {
    const next = applyRoute(base, route);
    assert.deepEqual({ primary: next.primary, pathways: next.pathways, stage: next.stage }, expected);
    assert.equal(routeOf(next), route);
    assert.equal(next.name, base.name, 'identity and shared details are kept');
    assert.equal(next.id, base.id);
    assert.deepEqual(routes.map(r => r.id).sort(), ['education', 'grow', 'independent']);
  }
  const grown = applyRoute(profile('business', 'idea'), 'grow');
  assert.equal(buildPlan(grown).length, 10, 'grow route adds the existing-business steps');
  assert.equal(routeOf({ ...base, stage: 'existing' }), 'grow', 'an existing business is always the grow route');
});

test('changing route keeps a second pathway and never alters a profile already on that route', () => {
  const both = { ...profile('education', 'idea'), pathways: ['education', 'business'] as Pathway[] };
  assert.equal(applyRoute(both, 'education'), both, 'same route is a no-op');
  assert.deepEqual(applyRoute(both, 'independent').pathways, ['education', 'business']);
  assert.equal(applyRoute(both, 'independent').primary, 'business');
  const existingEdu = { ...profile('education', 'existing') };
  assert.equal(routeOf(existingEdu), 'grow');
  assert.equal(applyRoute(existingEdu, 'grow'), existingEdu);
});

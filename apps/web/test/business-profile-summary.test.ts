import assert from 'node:assert/strict';
import test from 'node:test';
import { summariseBusiness, UNREADABLE } from '../lib/business-profile-summary.ts';
import { blankProfile } from '../lib/onboarding.ts';
import type { Profile } from '../lib/onboarding.ts';
import { buildPlan } from '../lib/onboarding.ts';
import type { LocalOffer } from '../lib/local-offers.ts';
import type { PricingScenarioWorksheet } from '../lib/local-pricing-scenario.ts';

const profile = (o: Partial<Profile> = {}): Profile => ({ ...blankProfile(), name: 'Sample Studio', audience: 'Local customers', goal: 'First customers', expertise: 'Coaching', industry: 'Services', ...o });
const offer = (o: Partial<LocalOffer> = {}) => ({ version: 1, id: 'o1', profileId: 'local-business', name: 'Intro session', audience: 'a', outcome: 'b', currency: 'AUD', kind: 'education', delivery: 'd', amountMinor: 12050, ...o }) as LocalOffer;
const pricing = { version: 1, revision: 4, updatedAt: '2026-11-01T00:00:00.000Z' } as PricingScenarioWorksheet;

test('nothing saved gives an empty, honest summary', () => {
  const s = summariseBusiness({ profile: profile(), offers: null, pricing: null });
  assert.equal(s.name, 'Sample Studio');
  assert.equal(s.route, 'Education & Mentoring');
  assert.deepEqual(s.offers, { status: 'ok', value: [] });
  assert.deepEqual(s.pricingScenario, { status: 'ok', value: { saved: false, revision: null, updatedAt: null } });
  assert.equal(s.planProgress.done, 0);
  assert.equal(s.planProgress.total, buildPlan(profile()).length);
});
test('only filled details are listed, and only for enabled pathways', () => {
  const s = summariseBusiness({ profile: profile({ location: '  ', website: 'https://example.com' }), offers: null, pricing: null });
  const labels = s.details.map(d => d.label);
  assert.ok(labels.includes('Website') && labels.includes('Customers'));
  assert.ok(!labels.includes('Location'));
  assert.ok(!labels.includes('Business type'), 'services pathway is off');
  assert.ok(labels.includes('Education offer type'));
});
test('offers are copied with exact prices; saved pricing scenario is reported without any computed figure', () => {
  const s = summariseBusiness({ profile: profile(), offers: [offer(), offer({ id: 'o2', name: 'Free', amountMinor: 0, currency: 'USD' })], pricing });
  assert.deepEqual(s.offers.status === 'ok' && s.offers.value.map(o => o.price), ['120.50 AUD', '0.00 USD']);
  assert.deepEqual(s.pricingScenario, { status: 'ok', value: { saved: true, revision: 4, updatedAt: '2026-11-01T00:00:00.000Z' } });
});
test('unreadable parts are reported, never shown as empty', () => {
  const s = summariseBusiness({ profile: profile(), offers: UNREADABLE, pricing: UNREADABLE });
  assert.equal(s.offers.status, 'unreadable');
  assert.equal(s.pricingScenario.status, 'unreadable');
});
test('plan progress counts only known step ids and names the next step', () => {
  const p = profile();
  const steps = buildPlan(p);
  const s = summariseBusiness({ profile: { ...p, completed: [steps[0].id, 'not-a-step', steps[0].id] }, offers: null, pricing: null });
  assert.equal(s.planProgress.done, 1);
  assert.equal(s.planProgress.nextStep, steps[1].title);
  const all = summariseBusiness({ profile: { ...p, completed: steps.map(x => x.id) }, offers: null, pricing: null });
  assert.equal(all.planProgress.done, steps.length);
  assert.equal(all.planProgress.nextStep, null);
});
test('route and stage follow the profile', () => {
  const s = summariseBusiness({ profile: profile({ stage: 'existing', primary: 'business', pathways: ['business'] }), offers: null, pricing: null });
  assert.equal(s.route, 'Grow & Automate My Business');
  assert.equal(s.stage, 'Existing business');
  assert.deepEqual(s.pathways, ['Services']);
});

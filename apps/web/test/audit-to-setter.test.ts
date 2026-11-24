import assert from 'node:assert/strict';
import test from 'node:test';
// config.ts uses extensionless imports (Next bundler style); the harness lets Node resolve them.
import './helpers/route-harness.ts';

const { auditToSetterConfig } = await import('../lib/audit-to-setter.ts');
const { checkedSetterConfig, fillTemplate } = await import('../lib/front-office/setter/config.ts');
const { opportunitySnapshot } = await import('../lib/audit-sync.ts');
const { auditBusiness, defaultAssumptions } = await import('../lib/growth-opportunity.ts');

const gym = { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day' as const, bookingPct: 40, averageValue: 50, noShowPct: 20 };
const business = auditBusiness({ name: 'Peak Gym', industry: 'Fitness studio', location: 'Fremantle', audience: 'Busy parents', primary: 'business' });
const snapshot = opportunitySnapshot(business, gym, defaultAssumptions, new Date('2026-11-09T00:00:00Z'));

test('a saved Growth Audit becomes a valid Setter config using the business details', () => {
  const c = auditToSetterConfig(snapshot);
  assert.equal(checkedSetterConfig(c), c);
  assert.equal(c.businessName, 'Peak Gym');
  assert.equal(c.offer, 'Fitness studio');
  assert.match(c.idealCustomer, /Busy parents/);
  assert.match(c.idealCustomer, /Fremantle/);
  assert.ok(c.facts.includes('Peak Gym is based in Fremantle.'));
  assert.ok(c.questions.length >= 3 && c.questions.length <= 5);
  assert.equal(c.meetingTitle, 'Booking with Peak Gym');
  assert.equal(c.followUps.length, 5, 'missed and slow replies get the full follow-up ladder');
  assert.equal(c.noShowRescue.length, 2, 'a no-show finding gets the rescue sequence');
  assert.equal(fillTemplate(c.followUps[0], { name: 'Sam Lee' }), 'Hi Sam, just checking you saw my last message from Peak Gym. Happy to find a time that suits.');
});

test('the Setter never states prices or estimates from the audit', () => {
  const c = auditToSetterConfig(snapshot);
  const all = JSON.stringify(c);
  assert.ok(!all.includes('$'));
  assert.ok(!/A\$|bookings a month|recoverable/.test(all));
});

test('missing or empty answers fall back safely and still pass validation', () => {
  for (const input of [null, undefined, {}, { business: null, answers: null, findings: null }, { business: { name: '   ', offer: '', area: '' } }, { answers: { enquiriesPerMonth: Number.NaN } }]) {
    const c = auditToSetterConfig(input);
    assert.doesNotThrow(() => checkedSetterConfig(c));
    assert.equal(c.businessName, 'Your business');
    assert.ok(c.offer.length > 0);
    assert.equal(c.followUps.length, 3);
    assert.equal(c.noShowRescue.length, 1);
    assert.ok(!c.facts.some(f => f.includes('based in')));
  }
  const noArea = auditToSetterConfig({ business: { name: 'Bloom', industry: 'Florist' } });
  assert.equal(noArea.offer, 'Florist services.');
  assert.equal(noArea.questions.find(q => q.id === 'location')!.ask, 'Where they are');
});

test('long or odd business details stay inside the SMS limits and cannot inject template fields', () => {
  const c = auditToSetterConfig({ business: { name: `{time} ${'Very Long Name '.repeat(30)}`, offer: 'x'.repeat(2000), area: 'Perth\nWA' } });
  checkedSetterConfig(c);
  assert.ok(!c.businessName.includes('{'));
  assert.ok(c.offer.length <= 400);
  assert.ok([...c.followUps, ...c.noShowRescue, c.reminder24h, c.reminder2h].every(t => t.length <= 320));
  assert.ok(c.facts.includes(`${c.businessName} is based in Perth WA.`));
});

test('the config is a fresh copy; Ventra defaults are not mutated', async () => {
  const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
  const before = JSON.stringify(ventraSetterConfig);
  const c = auditToSetterConfig(snapshot);
  c.availability.weekly[1] = [['10:00', '11:00']];
  assert.equal(JSON.stringify(ventraSetterConfig), before);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWithOpportunity, checkAuditRaw, checkOpportunity, opportunitySnapshot, restoreOpportunity, saveOpportunityToWorkspace } from '../lib/audit-sync.ts';
import { auditBusiness, calculate, defaultAssumptions, findingEvidence } from '../lib/growth-opportunity.ts';
import { auditKey, restoreAudit } from '../lib/ventra-workspace.ts';

const action = { finding: 'Slow replies', evidence: 'Noted from three enquiries', impact: 'High', confidence: 'Medium', destination: '/inbox' };
const audit = { version: 1, assessment: 'Steady but quiet.', underperforming: 'Replies', plan: 'Reply within a day.', actions: [action], updatedAt: '2026-11-04T00:00:00.000Z' };
const gym = { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day' as const, bookingPct: 40, averageValue: 50, noShowPct: 20 };
const business = auditBusiness({ name: 'Peak Gym', industry: 'Fitness studio', location: 'Fremantle', audience: 'Busy parents', primary: 'business' });
const now = new Date('2026-11-09T01:00:00.000Z');

// In-memory stand-in for browser storage (no live database or browser).
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

test('a valid saved audit passes', () => { checkAuditRaw(JSON.stringify(audit)); });
test('invalid audits are rejected', () => {
  assert.throws(() => checkAuditRaw('nope'));
  assert.throws(() => checkAuditRaw('null'));
  assert.throws(() => checkAuditRaw(JSON.stringify({ ...audit, plan: '' })));
  assert.throws(() => checkAuditRaw(JSON.stringify({ ...audit, actions: [action, action, action, action] })));
  assert.throws(() => checkAuditRaw(JSON.stringify({ ...audit, actions: [{ ...action, destination: '/evil' }] })));
});

test('every finding carries evidence derived only from the answers', () => {
  const r = calculate(gym);
  assert.equal(r.findings.length, 3);
  for (const f of r.findings) assert.equal(f.evidence, findingEvidence(f.id, gym));
  assert.equal(findingEvidence('missed', gym), 'You estimated 30 of 100 enquiries a month go unanswered.');
  assert.ok(findingEvidence('speed', gym).startsWith('You usually reply later the same day.'));
  assert.equal(findingEvidence('no-show', gym), 'About 6 of your 28 monthly bookings are no-shows, from your answers.');
  // Assumptions change the estimate but never the evidence.
  assert.deepEqual(calculate(gym, { ...defaultAssumptions, recoverHigh: 1 }).findings.map(f => f.evidence).sort(), r.findings.map(f => f.evidence).sort());
  assert.equal(findingEvidence('missed', { ...gym, enquiriesPerMonth: 200 }), 'You estimated 60 of 200 enquiries a month go unanswered.');
});

test('a snapshot recomputes findings from answers and rejects tampered evidence', () => {
  const s = opportunitySnapshot(business, gym, defaultAssumptions, now);
  assert.deepEqual(s.findings, calculate(gym).findings);
  assert.equal(s.business.name, 'Peak Gym');
  assert.equal(s.business.area, 'Fremantle');
  checkOpportunity(s);
  assert.throws(() => checkOpportunity({ ...s, findings: s.findings.map(f => ({ ...f, evidence: 'CRM shows 500 lost leads.' })) }), /do not match/);
  assert.throws(() => checkOpportunity({ ...s, answers: { ...gym, missedPct: 140 } }));
  assert.throws(() => checkOpportunity({ ...s, business: { ...s.business, name: 'x'.repeat(121) } }));
  assert.throws(() => opportunitySnapshot(business, { ...gym, enquiriesPerMonth: 0 }, defaultAssumptions, now), /Finish/);
});

test('saving with no workspace audit fills a valid audit that the account sync accepts', () => {
  const store = memory();
  const raw = saveOpportunityToWorkspace(store, null, opportunitySnapshot(business, gym, defaultAssumptions, now), now);
  assert.equal(store.getItem(auditKey), raw);
  checkAuditRaw(raw);
  const saved = restoreAudit(raw)!;
  assert.ok(saved.assessment.startsWith('Peak Gym: from the owner\'s Growth Audit answers'));
  assert.equal(saved.actions.length, 3);
  assert.deepEqual(saved.actions.map(a => a.evidence), calculate(gym).findings.map(f => f.evidence));
  assert.ok(saved.actions.every(a => a.destination === '/customers'));
  assert.equal(saved.updatedAt, now.toISOString());
  assert.equal(restoreOpportunity(raw)!.business.name, 'Peak Gym');
});

test('a manual assessment the owner wrote is kept; the calculator part is attached', () => {
  const before = JSON.stringify(audit);
  const store = memory({ [auditKey]: before });
  const raw = saveOpportunityToWorkspace(store, before, opportunitySnapshot(business, gym, defaultAssumptions, now), now);
  const saved = JSON.parse(raw);
  assert.equal(saved.assessment, audit.assessment);
  assert.equal(saved.plan, audit.plan);
  assert.deepEqual(saved.actions, audit.actions);
  assert.equal(saved.opportunity.findings.length, 3);
  assert.equal(saved.opportunity.autoFilled, undefined);
});

test('auto-filled text is refreshed on the next save, but not once the owner edits it', () => {
  const first = auditWithOpportunity(null, opportunitySnapshot(business, gym, defaultAssumptions, now), now);
  const second = auditWithOpportunity(first, opportunitySnapshot(business, { ...gym, noShowPct: 0 }, defaultAssumptions, now), now);
  assert.equal(second.actions.length, 2);
  assert.notEqual(second.assessment, first.assessment);
  const edited = { ...second, assessment: 'My own words.' };
  const third = auditWithOpportunity(edited, opportunitySnapshot(business, gym, defaultAssumptions, now), now);
  assert.equal(third.assessment, 'My own words.');
  assert.equal(third.actions.length, 2, 'owner-reviewed actions are kept');
  assert.equal(third.opportunity!.findings.length, 3);
});

test('no findings still saves a valid audit; another tab\'s change is never overwritten', () => {
  const none = opportunitySnapshot(business, { ...gym, missedPct: 0, replySpeed: 'minutes', noShowPct: 0 }, defaultAssumptions, now);
  const store = memory();
  const raw = saveOpportunityToWorkspace(store, null, none, now);
  assert.deepEqual(restoreAudit(raw)!.actions, []);
  store.setItem(auditKey, JSON.stringify(audit));
  assert.throws(() => saveOpportunityToWorkspace(store, raw, none, now), /another tab/);
  assert.equal(store.getItem(auditKey), JSON.stringify(audit));
});

test('a tampered calculator block makes the whole account copy invalid', () => {
  const good = auditWithOpportunity(null, opportunitySnapshot(business, gym, defaultAssumptions, now), now);
  const bad = { ...good, opportunity: { ...good.opportunity!, findings: [] } };
  assert.throws(() => checkAuditRaw(JSON.stringify(bad)));
  assert.equal(restoreOpportunity(JSON.stringify(bad)), null);
  assert.equal(restoreOpportunity(null), null);
  assert.equal(restoreOpportunity('nope'), null);
});

test('business details come from the profile and fall back to empty text', () => {
  assert.deepEqual(auditBusiness(null), { name: '', offer: '', area: '', audience: '', industry: '' });
  assert.equal(auditBusiness({ primary: 'education', educationOffer: 'Workshop', expertise: 'Sourdough baking' }).offer, 'Workshop: Sourdough baking');
  assert.equal(auditBusiness({ name: '  Peak \n Gym ' }).name, 'Peak Gym');
});

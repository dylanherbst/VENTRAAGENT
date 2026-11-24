import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCampaign, blankStep, bodyLimit, campaignLimit, campaignNameLimit, countsByStatus, emailCampaignsStorageKey, persistEmailCampaigns, preheaderLimit, removeCampaign, restoreEmailCampaigns, saveCampaign, sequenceTimeline, stepLimit, subjectLimit, timelineLabel, validateCampaign } from '../lib/local-email-campaigns.ts';
import type { EmailCampaign } from '../lib/local-email-campaigns.ts';

const P = 'p1';
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const good = (over: Partial<EmailCampaign> = {}): EmailCampaign => {
  const c = blankCampaign('a', 's1');
  return { ...c, name: 'Welcome', audienceNote: 'Warm leads who gave consent', steps: [{ ...c.steps[0], subject: 'Hi', body: 'Hello. Reply STOP or unsubscribe any time.' }], ...over };
};
const nurture = (): EmailCampaign => ({ ...good({ kind: 'nurture' }), steps: [
  { id: 's1', subject: 'One', body: 'b unsubscribe', waitDays: 0 },
  { id: 's2', subject: 'Two', body: 'b unsubscribe', waitDays: 3 },
  { id: 's3', subject: 'Three', body: 'b unsubscribe', waitDays: 4 },
] });

test('validation limits', () => {
  assert.deepEqual(validateCampaign(good()).problems, []);
  assert.ok(validateCampaign(good({ name: ' ' })).problems.length);
  assert.deepEqual(validateCampaign(good({ name: 'x'.repeat(campaignNameLimit) })).problems, []);
  assert.ok(validateCampaign(good({ name: 'x'.repeat(campaignNameLimit + 1) })).problems.length);
  assert.ok(validateCampaign(good({ kind: 'blast' as never })).problems.length);
  assert.ok(validateCampaign(good({ status: 'sent' as never })).problems.length);
  assert.ok(validateCampaign(good({ steps: [] })).problems.length);
  const s = good().steps[0];
  const withStep = (p: object) => good({ steps: [{ ...s, ...p }] });
  assert.deepEqual(validateCampaign(withStep({ subject: 'x'.repeat(subjectLimit) })).problems, []);
  assert.ok(validateCampaign(withStep({ subject: 'x'.repeat(subjectLimit + 1) })).problems.length);
  assert.ok(validateCampaign(withStep({ subject: ' ' })).problems.length);
  assert.ok(validateCampaign(withStep({ preheader: 'x'.repeat(preheaderLimit + 1) })).problems.length);
  assert.deepEqual(validateCampaign(withStep({ preheader: 'x'.repeat(preheaderLimit) })).problems, []);
  assert.deepEqual(validateCampaign(withStep({ body: 'unsubscribe' + 'x'.repeat(bodyLimit - 11) })).problems, []);
  assert.ok(validateCampaign(withStep({ body: 'x'.repeat(bodyLimit + 1) })).problems.length);
  assert.ok(validateCampaign(withStep({ body: '' })).problems.length);
  const many = (n: number) => good({ steps: Array.from({ length: n }, (_, i) => ({ ...s, id: `s${i}` })) });
  assert.deepEqual(validateCampaign(many(stepLimit)).problems, []);
  assert.ok(validateCampaign(many(stepLimit + 1)).problems.length);
  const waits = (w: number) => good({ steps: [s, { ...s, id: 's2', waitDays: w }] });
  assert.deepEqual(validateCampaign(waits(60)).problems, []);
  assert.ok(validateCampaign(waits(61)).problems.length);
  assert.ok(validateCampaign(waits(-1)).problems.length);
  assert.ok(validateCampaign(waits(1.5)).problems.length);
});

test('step 1 wait is forced to 0 on save and restore', () => {
  const c = good(); c.steps[0].waitDays = 9;
  assert.equal(saveCampaign([], c)[0].steps[0].waitDays, 0);
  assert.equal(restoreEmailCampaigns(JSON.stringify([c]), P)[0].steps[0].waitDays, 0);
  assert.equal(blankStep('x').waitDays, 0);
});

test('timeline math is cumulative', () => {
  const t = sequenceTimeline(nurture());
  assert.deepEqual(t.map(x => x.dayOffset), [0, 3, 7]);
  assert.equal(timelineLabel(nurture()), 'Day 0, Day 3, Day 7');
  assert.deepEqual(sequenceTimeline({ steps: [] }), []);
});

test('warnings do not block', () => {
  assert.deepEqual(validateCampaign(good()).warnings, []);
  const noUnsub = good(); noUnsub.steps[0].body = 'Just a hello';
  const r = validateCampaign(noUnsub);
  assert.equal(r.problems.length, 0);
  assert.ok(r.warnings.some(w => /unsubscribe/i.test(w)));
  assert.equal(saveCampaign([], noUnsub).length, 1);
  const noConsent = validateCampaign(good({ audienceNote: 'Everyone' }));
  assert.equal(noConsent.problems.length, 0);
  assert.ok(noConsent.warnings.some(w => /consent/i.test(w)));
  assert.deepEqual(validateCampaign(good({ audienceNote: 'hot leads who opted in' })).warnings, []);
});

test('save and remove are immutable; cap at 30; counts', () => {
  const start: EmailCampaign[] = [];
  const one = saveCampaign(start, good());
  assert.equal(start.length, 0);
  assert.equal(saveCampaign(one, good({ name: 'Changed' }))[0].name, 'Changed');
  assert.equal(one[0].name, 'Welcome');
  assert.equal(removeCampaign(one, 'a').length, 0);
  assert.equal(one.length, 1);
  let full: EmailCampaign[] = [];
  for (let i = 0; i < campaignLimit; i++) full = saveCampaign(full, good({ id: `c${i}`, status: i % 2 ? 'ready' : 'draft' }));
  assert.throws(() => saveCampaign(full, good({ id: 'extra' })), /up to 30/);
  assert.equal(saveCampaign(full, good({ id: 'c3', name: 'ok' })).length, 30);
  assert.throws(() => restoreEmailCampaigns(JSON.stringify([...full, good({ id: 'extra' })]), P));
  assert.deepEqual(countsByStatus(full), { draft: 15, ready: 15, archived: 0 });
});

test('restore never accepts invalid data; persist is compare-and-set', () => {
  assert.deepEqual(restoreEmailCampaigns(null, P), []);
  assert.throws(() => restoreEmailCampaigns('nope', P));
  assert.throws(() => restoreEmailCampaigns('{}', P));
  assert.throws(() => restoreEmailCampaigns('[{"id":"a"}]', P));
  assert.throws(() => restoreEmailCampaigns(JSON.stringify([good(), good()]), P), /Duplicate/);
  assert.throws(() => restoreEmailCampaigns('[]', ''));
  const s = memory();
  const key = emailCampaignsStorageKey(P);
  assert.equal(key, 'launchpad.email-campaigns.v1.p1');
  const raw1 = persistEmailCampaigns(s, P, null, [good()]);
  assert.equal(s.getItem(key), raw1);
  assert.throws(() => persistEmailCampaigns(s, P, null, [good({ name: 'B' })]), /another tab/);
  assert.equal(s.getItem(key), raw1, 'stale write did not overwrite');
  const raw2 = persistEmailCampaigns(s, P, raw1, [good({ name: 'B' })]);
  assert.notEqual(raw2, raw1);
  assert.throws(() => persistEmailCampaigns(s, P, raw2, [{ ...good(), name: '' }]));
  assert.equal(s.getItem(key), raw2);
});

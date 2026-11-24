// AMP-053 slice 1 (F08): opt-in capture on fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudienceService, createMemoryAudienceStore, normaliseEmail, normaliseTags } from '../lib/aimp/audience/index.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';

const A = { workspaceId: 'ws1', businessId: 'bizA' };

function setup() {
  let t = 1000;
  let i = 0;
  const email = createFixtureEmail();
  const svc = createAudienceService({ store: createMemoryAudienceStore(), email, now: () => (t += 10), newId: () => `id${++i}` });
  return { svc, email };
}
const source = { utmSource: 'pinterest', utmMedium: 'social', utmCampaign: 'launch', utmContent: 'pin1', utmTerm: 'planner', referrer: 'https://example.test/', pageSlug: 'home' };

async function withForm(extra: { sampleProductId?: string; tags?: string[] } = {}) {
  const s = setup();
  const f = await s.svc.createForm(A, { id: 'f1', storeSlug: 'store-a', wordingText: 'Send me tips by email.', ...extra });
  assert.equal(f.ok, true);
  return s;
}

test('F08 1: a valid opt-in creates one subscriber and one granted consent with wording and source', async () => {
  const { svc } = await withForm({ tags: ['Newsletter'] });
  const r = await svc.captureOptIn(A, { formId: 'f1', email: '  Jo@Example.COM ', consentTicked: true, source });
  assert.ok(r.ok);
  assert.equal(r.created, true);
  assert.equal(r.subscriber.status, 'subscribed');
  assert.equal(r.subscriber.emailNorm, 'jo@example.com');
  assert.equal(r.subscriber.emailDisplay, 'Jo@Example.COM');
  assert.equal(r.subscriber.storeSlug, 'store-a');
  assert.deepEqual(r.subscriber.tags, ['newsletter']);
  const log = await svc.consentLog(A, 'jo@example.com');
  assert.equal(log.length, 1);
  assert.equal(log[0].decision, 'granted');
  assert.equal(log[0].purpose, 'marketing');
  assert.equal(log[0].wordingVersion, 1);
  assert.equal(log[0].wordingText, 'Send me tips by email.');
  assert.ok(log[0].at > 0);
  assert.equal(log[0].source.channel, 'store_form');
  assert.equal(log[0].source.formId, 'f1');
  assert.equal(log[0].source.utmSource, 'pinterest');
  assert.equal(log[0].source.utmTerm, 'planner');
  assert.equal(await svc.canSendMarketing(A, 'jo@example.com'), true);
});

test('F08 1: UTM and referrer fields are trimmed and capped at 100 characters', async () => {
  const { svc } = await withForm();
  await svc.captureOptIn(A, { formId: 'f1', email: 'a@b.co', consentTicked: true, source: { utmSource: `  ${'x'.repeat(300)}  `, referrer: 'r'.repeat(101) } });
  const [rec] = await svc.consentLog(A, 'a@b.co');
  assert.equal(rec.source.utmSource.length, 100);
  assert.equal(rec.source.referrer.length, 100);
});

test('F08 2: same email twice gives one subscriber and one grant', async () => {
  const { svc } = await withForm();
  const one = await svc.captureOptIn(A, { formId: 'f1', email: 'x@y.co', consentTicked: true });
  const two = await svc.captureOptIn(A, { formId: 'f1', email: 'X@Y.co', consentTicked: true });
  assert.ok(one.ok && two.ok);
  assert.equal(two.created, false);
  assert.equal(two.subscriber.id, one.subscriber.id);
  assert.equal((await svc.listSubscribers(A)).length, 1);
  assert.equal((await svc.consentLog(A, 'x@y.co')).length, 1);
});

test('F08 2: two captures started together still make one subscriber', async () => {
  const { svc } = await withForm();
  await Promise.all([1, 2, 3].map(() => svc.captureOptIn(A, { formId: 'f1', email: 'race@y.co', consentTicked: true })));
  assert.equal((await svc.listSubscribers(A)).length, 1);
  assert.equal((await svc.consentLog(A, 'race@y.co')).length, 1);
});

test('F08 4: no tick or a malformed email stores nothing and says why in plain words', async () => {
  const { svc } = await withForm();
  const noTick = await svc.captureOptIn(A, { formId: 'f1', email: 'x@y.co', consentTicked: false });
  assert.ok(!noTick.ok);
  assert.equal(noTick.code, 'no_consent');
  const notBool = await svc.captureOptIn(A, { formId: 'f1', email: 'x@y.co', consentTicked: 'yes' as unknown as boolean });
  assert.ok(!notBool.ok);
  for (const bad of ['', 'nope', 'a@b', 'a b@c.co', '@c.co', 'a@@c.co', 'a@c..co', `${'a'.repeat(250)}@c.co`]) {
    const r = await svc.captureOptIn(A, { formId: 'f1', email: bad, consentTicked: true });
    assert.ok(!r.ok, bad);
    assert.equal(r.code, 'bad_email');
    assert.ok(!r.message.includes('—'));
  }
  assert.ok(!noTick.message.includes('—'));
  assert.equal((await svc.listSubscribers(A)).length, 0);
  assert.equal(normaliseEmail(' A@B.Co '), 'a@b.co');
});

test('F08 5: unsubscribe closes the gate, keeps the withdrawn record, is idempotent, and needs a fresh tick to re-subscribe', async () => {
  const { svc } = await withForm();
  await svc.captureOptIn(A, { formId: 'f1', email: 'u@y.co', consentTicked: true });
  const u1 = await svc.unsubscribe(A, 'U@y.co');
  assert.ok(u1.ok && u1.changed);
  assert.equal(await svc.canSendMarketing(A, 'u@y.co'), false);
  const u2 = await svc.unsubscribe(A, 'u@y.co');
  assert.ok(u2.ok && !u2.changed);
  let log = await svc.consentLog(A, 'u@y.co');
  assert.deepEqual(log.map((c) => c.decision), ['granted', 'withdrawn']);
  assert.equal(log[1].wordingText, 'Send me tips by email.');

  const noTick = await svc.captureOptIn(A, { formId: 'f1', email: 'u@y.co', consentTicked: false });
  assert.ok(!noTick.ok);
  assert.equal(await svc.canSendMarketing(A, 'u@y.co'), false);

  const again = await svc.captureOptIn(A, { formId: 'f1', email: 'u@y.co', consentTicked: true });
  assert.ok(again.ok);
  assert.equal(again.resubscribed, true);
  assert.equal(again.created, false);
  assert.equal(await svc.canSendMarketing(A, 'u@y.co'), true);
  log = await svc.consentLog(A, 'u@y.co');
  assert.deepEqual(log.map((c) => c.decision), ['granted', 'withdrawn', 'granted']);
});

test('F08 5: pending, unknown and bad addresses cannot be sent marketing', async () => {
  const { svc } = await withForm();
  assert.equal(await svc.canSendMarketing(A, 'nobody@y.co'), false);
  assert.equal(await svc.canSendMarketing(A, 'not an email'), false);
  assert.equal(await svc.canSendMarketing({ workspaceId: '', businessId: 'bizA' }, 'a@b.co'), false);
});

test('F08 5: a suppressed contact is never revived by capture or tags', async () => {
  const { svc } = await withForm({ sampleProductId: 'p1' });
  await svc.captureOptIn(A, { formId: 'f1', email: 's@y.co', consentTicked: true });
  const s = await svc.suppress(A, 's@y.co', 'bounced');
  assert.ok(s.ok && s.subscriber.status === 'suppressed');
  assert.equal(await svc.canSendMarketing(A, 's@y.co'), false);
  const cap = await svc.captureOptIn(A, { formId: 'f1', email: 's@y.co', consentTicked: true, sample: true });
  assert.ok(cap.ok);
  assert.equal(cap.subscriber.status, 'suppressed');
  assert.equal(cap.created, false);
  assert.equal(cap.sample, 'not_sent');
  await svc.tag(A, 's@y.co', ['vip']);
  await svc.untag(A, 's@y.co', ['vip']);
  await svc.unsubscribe(A, 's@y.co');
  assert.equal((await svc.listSubscribers(A, { status: 'suppressed' })).length, 1);
  assert.equal(await svc.canSendMarketing(A, 's@y.co'), false);
  assert.deepEqual((await svc.consentLog(A, 's@y.co')).map((c) => c.decision), ['granted', 'withdrawn']);
});

test('F08 5: an unknown address can be suppressed before it ever signs up', async () => {
  const { svc } = await withForm();
  const s = await svc.suppress(A, 'blocked@y.co', 'complaint');
  assert.ok(s.ok);
  const cap = await svc.captureOptIn(A, { formId: 'f1', email: 'blocked@y.co', consentTicked: true });
  assert.ok(cap.ok);
  assert.equal(cap.subscriber.status, 'suppressed');
  assert.equal(await svc.canSendMarketing(A, 'blocked@y.co'), false);
});

test('F08 6: tags are normalised, deduplicated, capped and filterable', async () => {
  const { svc } = await withForm();
  await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true });
  await svc.captureOptIn(A, { formId: 'f1', email: 'b@y.co', consentTicked: true });
  const t = await svc.tag(A, 'a@y.co', ['  VIP ', 'vip', '', 'x'.repeat(50)]);
  assert.ok(t.ok);
  assert.deepEqual(t.subscriber.tags, ['vip', 'x'.repeat(30)]);
  const many = await svc.tag(A, 'b@y.co', Array.from({ length: 20 }, (_, k) => `t${k}`));
  assert.ok(many.ok);
  assert.equal(many.subscriber.tags.length, 10);
  assert.deepEqual((await svc.listSubscribers(A, { tag: 'VIP' })).map((s) => s.emailNorm), ['a@y.co']);
  assert.equal((await svc.listSubscribers(A, { tag: 'nope' })).length, 0);
  await svc.untag(A, 'a@y.co', ['vip']);
  assert.equal((await svc.listSubscribers(A, { tag: 'vip' })).length, 0);
  const miss = await svc.tag(A, 'ghost@y.co', ['a']);
  assert.ok(!miss.ok && miss.code === 'not_found');
  assert.deepEqual(normaliseTags(['A', 'a', 5, 'b']), ['a', 'b']);
});

test('F08 7: a sample request sends exactly one clearly labelled message, and a retry sends no second one', async () => {
  const { svc, email } = await withForm({ sampleProductId: 'prod_42' });
  const r = await svc.captureOptIn(A, { formId: 'f1', email: 'Sam@y.co', consentTicked: true, sample: true });
  assert.ok(r.ok && r.sample === 'sent');
  assert.equal(email.outbox().length, 1);
  const msg = email.outbox()[0];
  assert.equal(msg.to, 'sam@y.co');
  assert.match(msg.subject + msg.text, /sample/i);
  assert.match(msg.text, /test message from a fixture/);
  assert.ok(!/https?:\/\//.test(msg.text));
  const retry = await svc.captureOptIn(A, { formId: 'f1', email: 'sam@y.co', consentTicked: true, sample: true });
  assert.ok(retry.ok);
  assert.equal(email.outbox().length, 1);
});

test('F08 7: no sample is sent unless asked, or when the form has no sample product', async () => {
  const withSample = await withForm({ sampleProductId: 'prod_42' });
  const a = await withSample.svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true });
  assert.ok(a.ok && a.sample === 'not_requested');
  assert.equal(withSample.email.outbox().length, 0);
  const plain = await withForm();
  const b = await plain.svc.captureOptIn(A, { formId: 'f1', email: 'b@y.co', consentTicked: true, sample: true });
  assert.ok(b.ok && b.sample === 'no_sample_product');
  assert.equal(plain.email.outbox().length, 0);
});

test('F08 7: a failing email adapter does not undo the sign-up', async () => {
  const email = createFixtureEmail();
  const svc = createAudienceService({ store: createMemoryAudienceStore(), email: { ...email, send: async () => { throw new Error('boom'); } } });
  await svc.createForm(A, { id: 'f1', storeSlug: 's', wordingText: 'w', sampleProductId: 'p' });
  const r = await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true, sample: true });
  assert.ok(r.ok && r.sample === 'failed');
  assert.equal(await svc.canSendMarketing(A, 'a@y.co'), true);
});

test('F08 8: after the wording changes, an old consent record keeps the version and text it was granted under', async () => {
  const { svc } = await withForm();
  await svc.captureOptIn(A, { formId: 'f1', email: 'old@y.co', consentTicked: true });
  const up = await svc.updateForm(A, 'f1', { wordingText: 'Send me weekly offers.' });
  assert.ok(up.ok && up.form.wordingVersion === 2);
  await svc.captureOptIn(A, { formId: 'f1', email: 'new@y.co', consentTicked: true });
  const [oldRec] = await svc.consentLog(A, 'old@y.co');
  const [newRec] = await svc.consentLog(A, 'new@y.co');
  assert.equal(oldRec.wordingVersion, 1);
  assert.equal(oldRec.wordingText, 'Send me tips by email.');
  assert.equal(newRec.wordingVersion, 2);
  assert.equal(newRec.wordingText, 'Send me weekly offers.');
  const same = await svc.updateForm(A, 'f1', { wordingText: 'Send me weekly offers.' });
  assert.ok(same.ok && same.form.wordingVersion === 2);
});

test('F08: form creation validates input and refuses duplicates', async () => {
  const { svc } = setup();
  assert.equal((await svc.createForm(A, { id: '', storeSlug: 's', wordingText: 'w' })).ok, false);
  assert.equal((await svc.createForm(A, { id: 'f', storeSlug: 's', wordingText: '  ' })).ok, false);
  assert.equal((await svc.createForm(A, { id: 'f', storeSlug: 's', wordingText: 'w' })).ok, true);
  assert.equal((await svc.createForm(A, { id: 'f', storeSlug: 's', wordingText: 'other' })).ok, false);
  assert.equal((await svc.updateForm(A, 'missing', { tags: [] })).ok, false);
  const r = await svc.captureOptIn(A, { formId: 'missing', email: 'a@y.co', consentTicked: true });
  assert.ok(!r.ok && r.code === 'unknown_form');
});

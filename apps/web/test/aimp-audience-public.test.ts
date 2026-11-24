// AMP-153 (F08): the review fixes before any public path: email characters, the public-safe reply, the sample email body, withdrawn source.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_OK_MESSAGE, createAudienceService, createMemoryAudienceStore, normaliseEmail, toPublicReply } from '../lib/aimp/audience/index.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';

const A = { workspaceId: 'ws1', businessId: 'bizA' };
const src = { utmSource: 'pinterest', utmMedium: 'social', utmCampaign: 'launch', pageSlug: 'home', referrer: 'https://example.test/' };

async function setup(opts: { sampleLabel?: boolean; sampleProductId?: string; formId?: string } = {}) {
  const email = createFixtureEmail();
  const svc = createAudienceService({ store: createMemoryAudienceStore(), email, ...(opts.sampleLabel === undefined ? {} : { sampleLabel: opts.sampleLabel }) });
  const f = await svc.createForm(A, { id: opts.formId ?? 'f1', storeSlug: 'store-a', wordingText: 'Send me tips.', sampleProductId: opts.sampleProductId ?? 'prod_secret_42' });
  assert.ok(f.ok);
  return { svc, email };
}

test('normaliseEmail rejects control and format characters', () => {
  for (const bad of ['a\0@b.co', 'a@b.co\0', 'a\x7f@b.co', 'a​@b.co', 'a@b‍.co', 'a‮@b.co', 'a﻿@b.co', 'a\n@b.co', 'a@b.­co']) {
    assert.equal(normaliseEmail(bad), null, JSON.stringify(bad));
  }
  assert.equal(normaliseEmail('  Jo@Example.com '), 'jo@example.com');
});

test('toPublicReply: same ok message for new, repeat and suppressed; refusals carry only a message', async () => {
  const { svc } = await setup();
  const fresh = toPublicReply(await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true }));
  const repeat = toPublicReply(await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true }));
  await svc.suppress(A, 'b@y.co', 'complaint');
  const blocked = toPublicReply(await svc.captureOptIn(A, { formId: 'f1', email: 'b@y.co', consentTicked: true }));
  assert.deepEqual(fresh, { ok: true, message: PUBLIC_OK_MESSAGE });
  assert.deepEqual(repeat, fresh);
  assert.deepEqual(blocked, fresh);
  for (const r of [
    toPublicReply(await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: false })),
    toPublicReply(await svc.captureOptIn(A, { formId: 'f1', email: 'nope', consentTicked: true })),
    toPublicReply(await svc.captureOptIn(A, { formId: 'missing', email: 'a@y.co', consentTicked: true })),
  ]) {
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r).sort(), ['message', 'ok']);
  }
});

test('sample email: no unsubscribe promise, no raw product id, the title when given, a generic line when not', async () => {
  const a = await setup();
  await a.svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true, sample: true, sampleProductTitle: 'Weekly Planner' });
  const msg = a.email.outbox()[0];
  assert.ok(!/unsubscribe/i.test(msg.text));
  assert.ok(!msg.text.includes('prod_secret_42'));
  assert.match(msg.text, /Weekly Planner/);
  assert.match(msg.text, /test message from a fixture/);
  const b = await setup();
  await b.svc.captureOptIn(A, { formId: 'f1', email: 'b@y.co', consentTicked: true, sample: true });
  assert.ok(!b.email.outbox()[0].text.includes('prod_secret_42'));
  assert.match(b.email.outbox()[0].text, /free sample you asked for/);
});

test('sample email: the fixture line is shown only while sampleLabel is on', async () => {
  const off = await setup({ sampleLabel: false });
  await off.svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true, sample: true });
  assert.ok(!/fixture/i.test(off.email.outbox()[0].text));
  const on = await setup({ sampleLabel: true });
  await on.svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true, sample: true });
  assert.match(on.email.outbox()[0].text, /fixture/i);
});

test('a withdrawn record is a manual channel with only the grant form id, not the grant UTMs', async () => {
  const { svc } = await setup();
  await svc.captureOptIn(A, { formId: 'f1', email: 'a@y.co', consentTicked: true, source: src });
  await svc.unsubscribe(A, 'a@y.co');
  const log = await svc.consentLog(A, 'a@y.co');
  assert.equal(log.length, 2);
  assert.equal(log[0].source.utmSource, 'pinterest');
  assert.deepEqual(log[1].source, {
    channel: 'manual', formId: 'f1', pageSlug: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '', referrer: '',
  });
});

test('the form id is length-capped like other fields', async () => {
  const long = 'f'.repeat(300);
  const { svc } = await setup({ formId: long });
  const capped = 'f'.repeat(100);
  assert.ok(await svc.getForm(A, capped));
  const r = await svc.captureOptIn(A, { formId: capped, email: 'a@y.co', consentTicked: true });
  assert.ok(r.ok);
  assert.equal((await svc.consentLog(A, 'a@y.co'))[0].source.formId.length, 100);
});

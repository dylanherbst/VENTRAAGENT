// AMP-053 slice 1 (F08): store A and store B (same workspace, different business, and a different workspace) never mix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudienceService, createMemoryAudienceStore } from '../lib/aimp/audience/index.ts';
import { createFixtureEmail } from '../lib/aimp/providers/fixtures.ts';

const A = { workspaceId: 'ws1', businessId: 'bizA' };
const B = { workspaceId: 'ws1', businessId: 'bizB' };
const C = { workspaceId: 'ws2', businessId: 'bizA' };

async function setup() {
  const email = createFixtureEmail();
  const svc = createAudienceService({ store: createMemoryAudienceStore(), email });
  await svc.createForm(A, { id: 'fa', storeSlug: 'store-a', wordingText: 'A wording', sampleProductId: 'pa' });
  await svc.createForm(B, { id: 'fb', storeSlug: 'store-b', wordingText: 'B wording' });
  return { svc, email };
}

test('F08 2: the same email in store B is a separate subscriber with its own consent', async () => {
  const { svc } = await setup();
  const a = await svc.captureOptIn(A, { formId: 'fa', email: 'x@y.co', consentTicked: true });
  const b = await svc.captureOptIn(B, { formId: 'fb', email: 'x@y.co', consentTicked: true });
  assert.ok(a.ok && b.ok);
  assert.equal(b.created, true);
  assert.notEqual(a.subscriber.id, b.subscriber.id);
  assert.equal((await svc.consentLog(A, 'x@y.co')).length, 1);
  assert.equal((await svc.consentLog(B, 'x@y.co'))[0].wordingText, 'B wording');
  assert.equal((await svc.consentLog(A, 'x@y.co'))[0].wordingText, 'A wording');
});

test('F08 3: listing, unsubscribing, suppressing, tagging and the gate never cross stores', async () => {
  const { svc } = await setup();
  await svc.captureOptIn(A, { formId: 'fa', email: 'a@y.co', consentTicked: true });
  await svc.captureOptIn(B, { formId: 'fb', email: 'b@y.co', consentTicked: true });
  assert.deepEqual((await svc.listSubscribers(A)).map((s) => s.emailNorm), ['a@y.co']);
  assert.deepEqual((await svc.listSubscribers(B)).map((s) => s.emailNorm), ['b@y.co']);
  assert.equal((await svc.listSubscribers(C)).length, 0);

  const u = await svc.unsubscribe(A, 'b@y.co');
  assert.ok(!u.ok && u.code === 'not_found');
  const t = await svc.tag(A, 'b@y.co', ['x']);
  assert.ok(!t.ok);
  assert.equal(await svc.canSendMarketing(A, 'b@y.co'), false);
  assert.equal(await svc.canSendMarketing(C, 'a@y.co'), false);
  assert.equal(await svc.canSendMarketing(B, 'b@y.co'), true);
  assert.deepEqual((await svc.consentLog(A, 'b@y.co')), []);

  // Suppressing in A creates a record in A only; B's contact is untouched.
  await svc.suppress(A, 'b@y.co', 'test');
  assert.equal(await svc.canSendMarketing(B, 'b@y.co'), true);
  assert.equal((await svc.listSubscribers(B))[0].status, 'subscribed');
});

test('F08 3: a form of B cannot be used with A context, and a form of another workspace cannot be used either', async () => {
  const { svc, email } = await setup();
  const r = await svc.captureOptIn(A, { formId: 'fb', email: 'x@y.co', consentTicked: true });
  assert.ok(!r.ok && r.code === 'unknown_form');
  const c = await svc.captureOptIn(C, { formId: 'fa', email: 'x@y.co', consentTicked: true, sample: true });
  assert.ok(!c.ok && c.code === 'unknown_form');
  assert.equal((await svc.listSubscribers(A)).length, 0);
  assert.equal((await svc.listSubscribers(B)).length, 0);
  assert.equal(email.outbox().length, 0);
  assert.equal(await svc.getForm(A, 'fb'), null);
  const up = await svc.updateForm(A, 'fb', { wordingText: 'hijack' });
  assert.ok(!up.ok);
  assert.equal((await svc.getForm(B, 'fb'))?.wordingText, 'B wording');
});

test('F08 7: the sample key is per store, so the same address in two stores gets one each', async () => {
  const { svc, email } = await setup();
  await svc.updateForm(B, 'fb', { sampleProductId: 'pa' });
  await svc.captureOptIn(A, { formId: 'fa', email: 'x@y.co', consentTicked: true, sample: true });
  await svc.captureOptIn(B, { formId: 'fb', email: 'x@y.co', consentTicked: true, sample: true });
  assert.equal(email.outbox().length, 2);
});

test('F08 3: an empty tenant context is refused everywhere', async () => {
  const { svc } = await setup();
  const none = { workspaceId: '', businessId: '' };
  const r = await svc.captureOptIn(none, { formId: 'fa', email: 'x@y.co', consentTicked: true });
  assert.ok(!r.ok);
  assert.deepEqual(await svc.listSubscribers(none), []);
  assert.ok(!(await svc.createForm(none, { id: 'z', storeSlug: 's', wordingText: 'w' })).ok);
});

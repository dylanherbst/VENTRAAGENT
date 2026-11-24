import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedDraftRaw, checkedKind, deleteLauncherDraft, loadLauncherDraft, packArray, saveLauncherDraft, unpackArray } from '../lib/launcher-drafts.ts';

const W = '11111111-1111-4111-8111-111111111111';
const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test('kind and draft validation', () => {
  assert.equal(checkedKind('pricing-scenario'), 'pricing-scenario');
  assert.throws(() => checkedKind('courses'));
  for (const k of ['service-proposals', 'service-agreement', 'service-invoice', 'service-portal', 'service-projects', 'education-certificate', 'education-sales-page', 'education-coaching', 'education-workshop', 'lead-scoring', 'content-calendar', 'email-campaigns', 'funnels', 'booking-page', 'student-progress', 'workflow-builder', 'launch-checklist', 'lesson-quiz', 'service-offers', 'growth-plan', 'growth-audit', 'notification-prefs', 'lead-followups', 'membership-plans']) assert.equal(checkedKind(k), k);
  assert.throws(() => checkedKind('education-quiz'));
  assert.throws(() => checkedDraftRaw('[]'));
  assert.throws(() => checkedDraftRaw('nope'));
  assert.throws(() => checkedDraftRaw('{"a":"' + 'x'.repeat(130000) + '"}'));
  assert.deepEqual(checkedDraftRaw('{"a":1}'), { a: 1 });
});
test('load returns null when no account draft exists and parses an existing one', async () => {
  assert.equal(await loadLauncherDraft(W, 'business-plan', json(200, { draft: null })), null);
  const d = await loadLauncherDraft(W, 'business-plan', json(200, { draft: { data: { a: 1 }, revision: 3, updated_at: '2026-11-03T00:00:00Z' } }));
  assert.deepEqual(d, { kind: 'business-plan', revision: 3, updatedAt: '2026-11-03T00:00:00Z', raw: '{"a":1}' });
  await assert.rejects(loadLauncherDraft(W, 'business-plan', json(200, { draft: { data: 'x', revision: 0 } })));
  await assert.rejects(loadLauncherDraft(W, 'business-plan', json(503, { error: 'down' })), /down/);
});
test('save requires a verified next revision; delete requires a verified result', async () => {
  assert.equal(await saveLauncherDraft(W, 'pricing-scenario', '{"a":1}', 0, json(200, { saved: true, revision: 1 })), 1);
  await assert.rejects(saveLauncherDraft(W, 'pricing-scenario', '{"a":1}', 1, json(200, { saved: true, revision: 5 })), /could not be verified/);
  await assert.rejects(saveLauncherDraft(W, 'pricing-scenario', '{"a":1}', 1, json(409, { error: 'conflict' })), /conflict/);
  await assert.rejects(saveLauncherDraft(W, 'pricing-scenario', '{"a":1}', -1));
  await deleteLauncherDraft(W, 'pricing-scenario', 2, json(200, { deleted: true }));
  await assert.rejects(deleteLauncherDraft(W, 'pricing-scenario', 2, json(200, {})), /could not be verified/);
});

test('list stores are wrapped for the account and unwrapped exactly', () => {
  const list = JSON.stringify([{ id: 'a' }, { id: 'b' }]);
  assert.equal(unpackArray(packArray(list)), list);
  assert.throws(() => packArray('{"a":1}'), /list/);
  assert.throws(() => unpackArray('{"items":"x"}'), /not a list/);
  assert.equal(checkedKind('crm-contacts'), 'crm-contacts');
  for (const k of ['lead-forms', 'storefront', 'link-in-bio', 'ad-concepts', 'community-space', 'website-page']) assert.equal(checkedKind(k), k);
});

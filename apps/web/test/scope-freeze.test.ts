import test from 'node:test';
import assert from 'node:assert/strict';
import { W, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { activeLauncherKinds, launcherKindFrozen, scopeFreezeOn } = await import('../lib/scope-freeze.ts');
const { launcherKinds } = await import('../lib/launcher-drafts.ts');
const courses = await import('../app/api/courses/route.ts');
const generate = await import('../app/api/courses/generate/route.ts');
const aliasCourses = await import('../app/api/workspace/courses/route.ts');
const aliasGenerate = await import('../app/api/workspace/course-generation/route.ts');
const checkout = await import('../app/api/checkout/route.ts');
const webhook = await import('../app/api/stripe/webhook/route.ts');
const launcher = await import('../app/api/workspace/launcher/route.ts');
const post = (body: unknown) => ({ method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('freeze is on by default and only the owner override turns it off', () => {
  assert.equal(scopeFreezeOn({}), true);
  assert.equal(scopeFreezeOn({ VENTRA_SCOPE_FREEZE: 'on' }), true);
  assert.equal(scopeFreezeOn({ VENTRA_SCOPE_FREEZE: ' OFF ' }), false);
  assert.equal(launcherKindFrozen('business-plan', {}), true);
  assert.equal(launcherKindFrozen('business-plan', { VENTRA_SCOPE_FREEZE: 'off' }), false);
});
test('only front-office launcher kinds stay active, and every active kind is a real kind', () => {
  for (const k of activeLauncherKinds) assert.ok(launcherKinds.includes(k), k);
  for (const k of ['crm-contacts', 'crm-pipeline', 'lead-forms', 'lead-scoring', 'lead-followups', 'booking-page'] as const) assert.equal(launcherKindFrozen(k, {}), false, k);
  for (const k of ['business-plan', 'lesson-quiz', 'storefront', 'workflow-builder', 'email-campaigns', 'service-invoice', 'growth-plan'] as const) assert.equal(launcherKindFrozen(k, {}), true, k);
});
test('frozen routes answer before any storage, AI or payment call', async () => {
  delete process.env.VENTRA_SCOPE_FREEZE;
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase();
  try {
    for (const [name, handler] of [['courses GET', courses.GET], ['courses POST', courses.POST], ['alias GET', aliasCourses.GET], ['generate', generate.POST], ['alias generate', aliasGenerate.POST], ['checkout', checkout.POST]] as const) {
      const r = await call(handler, '/api/x?workspace=' + W, name.includes('GET') ? {} : post({}));
      assert.equal(r.status, 423, name); assert.equal(r.body.code, 'feature_paused', name); assert.equal(r.body.paused, true);
    }
    const hook = await call(webhook.POST, '/api/stripe/webhook', { method: 'POST', body: '{}' });
    assert.equal(hook.status, 503, 'Stripe retries instead of dropping the event'); assert.equal(hook.body.code, 'feature_paused');
    assert.equal(fake.calls.length, 0, 'no Supabase call was made');
  } finally { fake.restore(); restore(); }
});
test('launcher: frozen kinds are refused, front-office kinds still load', async () => {
  delete process.env.VENTRA_SCOPE_FREEZE;
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase({ tables: { launcher_drafts: [] } });
  try {
    const frozen = await call(launcher.GET, `/api/workspace/launcher?workspace=${W}&kind=business-plan`);
    assert.equal(frozen.status, 423); assert.equal(frozen.body.kind, 'business-plan');
    const save = await call(launcher.POST, '/api/workspace/launcher', post({ action: 'save', workspace: W, kind: 'storefront', revision: 0, draft: {} }));
    assert.equal(save.status, 423);
    assert.ok(!fake.calls.some(c => c.path.includes('save_launcher_draft')), 'frozen save never reaches storage');
    const active = await call(launcher.GET, `/api/workspace/launcher?workspace=${W}&kind=crm-contacts`);
    assert.notEqual(active.status, 423);
  } finally { fake.restore(); restore(); }
});

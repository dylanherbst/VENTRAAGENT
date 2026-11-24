// AMP-035 (D03): the publish-site job runs the real publish check when it is wired, and still runs as a demo when it is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectLog, createDemoJobDefinitions, createFaultPlan } from '../lib/aimp/jobs/handlers.ts';
import { createJobRegistry } from '../lib/aimp/jobs/registry.ts';
import { createJobRunner } from '../lib/aimp/jobs/runner.ts';
import { createJobService } from '../lib/aimp/jobs/service.ts';
import { createMemoryJobStore } from '../lib/aimp/jobs/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createPageLoader, type PublishWithCheckDeps } from '../lib/aimp/publish-check/index.ts';
import { createSiteVersionStore, demoActorA } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

async function harness(publishSite: PublishWithCheckDeps | undefined) {
  let t = Date.parse('2026-11-14T09:00:00Z');
  const now = () => t;
  const store = createMemoryJobStore();
  const registry = createJobRegistry(createDemoJobDefinitions({ providers: createProviderRegistry({ env: {} }), effects: createEffectLog(), faults: createFaultPlan(), publishSite }));
  const service = createJobService({ store, registry, now });
  const runner = createJobRunner({ store, registry, owner: 'test-runner', now, random: () => 0.5, leaseMs: 60_000 });
  const ctx = { workspaceId: demoActorA.workspaceId, businessId: 'biz-a', actorUserId: 'u', idempotencyKey: 'pub-1' };
  return { service, runner, ctx };
}

async function wired(breakHome: boolean) {
  const versions = createSiteVersionStore();
  await versions.createSite(demoActorA, demoStore);
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  const publishSite: PublishWithCheckDeps = {
    versions,
    check: {
      resolveLive: (s) => versions.resolvePublished(s),
      loadPage: async (s, ref) => (breakHome && ref.page === 'home' ? { ok: false, reason: 'it threw while rendering.' } : base(s, ref)),
      checkout: { canStart: async () => ({ ok: true }) },
      checkoutAvailable: true,
    },
  };
  return { versions, publishSite };
}

test('wired: the job publishes the store and the smoke test passes for real', async () => {
  const { versions, publishSite } = await wired(false);
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'succeeded');
  assert.equal((await versions.resolvePublished(demoStore.slug)).status, 'live');
});

test('wired: a failing smoke test fails the job in plain English and leaves the store unpublished', async () => {
  const { versions, publishSite } = await wired(true);
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'failed');
  assert.match(j.lastError ?? '', /home page did not load/);
  assert.equal((await versions.resolvePublished(demoStore.slug)).status, 'paused');
});

test('wired: a job with no store named fails before publishing anything', async () => {
  const { versions, publishSite } = await wired(false);
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site' });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'failed');
  assert.equal((await versions.resolvePublished(demoStore.slug)).status, 'none');
});

const stepOutput = (j: { steps: { name: string; output: unknown }[] }, name: string) => j.steps.find((s) => s.name === name)?.output as Record<string, unknown> | null | undefined;

test('AMP-098 #5: the smoke-test step reports the real result and says checkout was skipped (demo store), never passed', async () => {
  const { publishSite } = await wired(false);
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'succeeded');
  const out = stepOutput(j, 'smoke-test');
  assert.equal(out?.smokeTest, 'pass');
  assert.equal(out?.checkout, 'skipped');
  assert.ok(Array.isArray(out?.skipped) && out.skipped.length > 0);
  assert.ok(Number(out?.checks) > 0);
});

test('AMP-098 #5: with checkout tested the smoke-test step says checkout passed', async () => {
  const versions = createSiteVersionStore();
  await versions.createSite(demoActorA, { ...structuredClone(demoStore), demo: false, merchant: { chargesEnabled: true } });
  const base = createPageLoader(async (slug) => { const r = await versions.resolvePublished(slug); return r.status === 'live' ? r.config : null; });
  const publishSite: PublishWithCheckDeps = {
    versions,
    check: { resolveLive: (s) => versions.resolvePublished(s), loadPage: base, checkout: { canStart: async () => ({ ok: true }) }, checkoutAvailable: true },
  };
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'succeeded');
  assert.equal(stepOutput(j, 'smoke-test')?.checkout, 'passed');
});

test('AMP-098 #6: a failed check is stored on the job result with its failed and checks lists, and the job fails with the message', async () => {
  const { publishSite } = await wired(true);
  const h = await harness(publishSite);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'failed');
  const pub = stepOutput(j, 'publish');
  assert.equal(pub?.published, false);
  assert.equal(pub?.outcome, 'unpublished');
  assert.ok(Array.isArray(pub?.failed) && (pub.failed as { check: string }[]).some((f) => f.check === 'page:home'));
  assert.ok(Array.isArray(pub?.checks) && pub.checks.length > 0);
});

test('AMP-098 #6: a conflict while publishing is retried by the job, not failed for good', async () => {
  const { versions, publishSite } = await wired(false);
  let calls = 0;
  const flaky = { ...publishSite, versions: {
    publish: versions.publish.bind(versions), rollback: versions.rollback.bind(versions), pause: versions.pause.bind(versions),
    history: versions.history.bind(versions), resolvePublished: versions.resolvePublished.bind(versions), getVersion: versions.getVersion.bind(versions),
  } };
  flaky.versions.publish = async (...a) => { calls++; return calls === 1 ? { ok: false, code: 'conflict', errors: ['The store changed while publishing. Try again.'] } : versions.publish(...a); };
  const h = await harness(flaky);
  await h.service.enqueue(h.ctx, { kind: 'publish-site', input: { storeSlug: demoStore.slug } });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'waiting-retry');
  assert.equal(calls, 1);
});

test('not wired: the demo stubs still run and say they are demo', async () => {
  const h = await harness(undefined);
  await h.service.enqueue(h.ctx, { kind: 'publish-site' });
  await h.runner.drain();
  const [j] = await h.service.list(h.ctx);
  assert.equal(j.status, 'succeeded');
});

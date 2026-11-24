// AMP-149: guided-setup publishing runs as a real Operator-visible `publish-site` job (publishStoreAsJob), driven to its result.
// Real code: createStartAutomation + publishStoreAsJob (app/start/_server/automation-runtime.ts), the real job engine and handler, the
// real AMP-146 checked publish over a real site-version store, the real Operator loader. Fixtures: seller/payments/catalogue stand-ins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStartAutomation, publishStoreAsJob } from '../app/start/_server/automation-runtime.ts';
import { JobsError } from '../lib/aimp/jobs/types.ts';
import { loadOperator } from '../app/app/[business]/operator/_server/operator.ts';
import { buildOperator } from '../app/app/[business]/operator/view-model.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createInMemorySellerStore } from '../lib/aimp/sellers/index.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import type { Actor } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const actor: Actor = { workspaceId: WS, userId: OWNER };
const payments = createProviderRegistry({ env: {} }).payments;
const lax = () => createSiteVersionStore({ validate: (c) => ({ ok: true, config: c as StoreConfig }) as never });

function world(sites = createSiteVersionStore()) {
  const slugs = new Map<string, string>();
  const catalogue = { async listApprovedForBusiness() { return []; }, async getApprovedListing() { return null; }, async getCheckoutPrice() { return { priceMinor: 1900 }; } };
  const sa = createStartAutomation({ publish: { workspaceId: WS, sites, slugs, catalogue: catalogue as never, sellers: createInMemorySellerStore(), payments: () => ({ status: payments.status, adapter: payments.adapter }) } });
  const rt = { businesses: new Set<string>(['biz-a', 'biz-b']), seeds: new Map<string, unknown>(), slugs, productIds: new Map<string, string[]>() };
  const add = async (businessId: string, cfg: StoreConfig) => { assert.ok((await sites.createSite(actor, structuredClone(cfg))).ok); slugs.set(businessId, cfg.slug); };
  const slugFor = (workspaceId: string, businessId: string) => (workspaceId === WS ? slugs.get(businessId) : undefined);
  const publish = (businessId: string, key: string, workspaceId = WS, via: typeof sa = sa) => publishStoreAsJob(via, slugFor, { workspaceId, businessId, actorUserId: OWNER, idempotencyKey: key });
  const runs = async (businessId: string, workspaceId = WS) => {
    const r = await loadOperator(rt, { automation: () => sa.automation, workspaceId, actorUserId: OWNER }, businessId);
    assert.ok(r.found && r.state === 'ready');
    if (!(r.found && r.state === 'ready')) throw new Error('unreachable');
    return buildOperator(businessId, null, r.data).runs;
  };
  return { sites, slugs, sa, add, publish, runs };
}

test('AMP-149 a publish through the job path succeeds and shows as a succeeded run for the right business only', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  await w.add('biz-b', demoStoreB);
  const r = await w.publish('biz-a', 'rev-1');
  assert.equal(r.outcome, 'published', JSON.stringify(r));
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'live');
  const a = await w.runs('biz-a');
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'Site publishing');
  assert.equal(a[0].status, 'succeeded', 'not left at "Waiting to start"');
  assert.deepEqual(await w.runs('biz-b'), [], 'B sees none of A\'s runs');
  assert.equal((await w.sites.resolvePublished(demoStoreB.slug)).status, 'none', 'B\'s store was not touched');
  // the same business in another workspace sees nothing
  assert.deepEqual(await w.runs('biz-a', 'other-workspace'), []);
  const job = (await w.sa.jobs.service.list({ workspaceId: WS, businessId: 'biz-a', actorUserId: OWNER, idempotencyKey: 'x' }))[0];
  assert.equal(job.kind, 'publish-site');
  const pub = job.steps.find((s) => s.name === 'publish')?.output as Record<string, unknown>;
  assert.equal(pub.published, true);
  assert.equal(pub.demo, undefined, 'the real handler ran, not the stub');
});

test('AMP-149 a publish whose page fails to load ends as a failed run and the store is not left live', async () => {
  const w = world(lax());
  const broken = { ...structuredClone(demoStore), contact: { ...demoStore.contact, email: '' } } as StoreConfig;
  await w.add('biz-a', broken);
  const r = await w.publish('biz-a', 'rev-1');
  assert.equal(r.outcome, 'failed', JSON.stringify(r));
  if (r.outcome === 'failed') { assert.equal(r.storeState, 'paused'); assert.ok(r.message.length > 0); }
  assert.equal((await w.sites.resolvePublished(broken.slug)).status, 'paused');
  const runs = await w.runs('biz-a');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
});

test('AMP-149 a later publish that fails is rolled back to the earlier good version', async () => {
  const w = world(lax());
  await w.add('biz-a', demoStore);
  assert.equal((await w.publish('biz-a', 'rev-1')).outcome, 'published');
  assert.ok((await w.sites.editDraft(actor, demoStore.slug, (d) => { d.contact.email = ''; })).ok);
  const r = await w.publish('biz-a', 'rev-2');
  assert.equal(r.outcome, 'failed');
  if (r.outcome === 'failed') { assert.equal(r.storeState, 'rolled_back'); assert.equal(r.rolledBackTo, 1); }
  const live = await w.sites.resolvePublished(demoStore.slug);
  assert.ok(live.status === 'live' && live.config.contact.email === demoStore.contact.email);
  assert.deepEqual((await w.runs('biz-a')).map((x) => x.status).sort(), ['failed', 'succeeded']);
});

test('AMP-149 an idempotent re-enqueue of the same publish does not publish twice', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const first = await w.publish('biz-a', 'rev-1');
  const again = await w.publish('biz-a', 'rev-1');
  assert.equal(first.outcome, 'published');
  assert.equal(again.outcome, 'published');
  if (first.outcome === 'published' && again.outcome === 'published') { assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(first.jobId, again.jobId); }
  assert.equal((await w.runs('biz-a')).length, 1, 'one run');
  const hist = await w.sites.history(actor, demoStore.slug);
  assert.ok(hist.ok);
  if (hist.ok) { assert.equal(hist.value.versions.length, 1, 'one published version'); assert.equal(hist.value.liveVersion, 1); }
});

test('AMP-149 no store, paused publishing, bad key and wrong workspace start nothing', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  assert.equal((await w.publish('biz-b', 'k')).outcome, 'no_store');
  assert.equal((await w.publish('biz-a', '')).outcome, 'refused');
  assert.equal((await w.publish('biz-a', 'k', 'other-workspace')).outcome, 'no_store', 'never the demo stub for a foreign workspace');
  await w.sa.automation.setMode({ workspaceId: WS, businessId: 'biz-a', actorUserId: OWNER, idempotencyKey: 'm' }, 'publishing', 'paused');
  assert.equal((await w.publish('biz-a', 'k')).outcome, 'paused');
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none');
  assert.deepEqual(await w.runs('biz-a'), []);
});

test('AMP-164 two simultaneous calls with the same key publish once', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const [x, y] = await Promise.all([w.publish('biz-a', 'rev-1'), w.publish('biz-a', 'rev-1')]);
  const outcomes = [x, y];
  assert.equal(outcomes.filter((r) => r.outcome === 'published').length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.filter((r) => r.outcome === 'not_finished').length, 1, JSON.stringify(outcomes));
  if ('jobId' in x && 'jobId' in y) assert.equal(x.jobId, y.jobId);
  assert.equal((await w.runs('biz-a')).length, 1, 'one run');
  const hist = await w.sites.history(actor, demoStore.slug);
  assert.ok(hist.ok);
  if (hist.ok) assert.equal(hist.value.versions.length, 1, 'one published version');
});

test('AMP-164 two businesses with the same key do not collide', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  await w.add('biz-b', demoStoreB);
  const a = await w.publish('biz-a', 'rev-1');
  const b = await w.publish('biz-b', 'rev-1');
  assert.equal(a.outcome, 'published', JSON.stringify(a));
  assert.equal(b.outcome, 'published', JSON.stringify(b));
  if (a.outcome === 'published' && b.outcome === 'published') { assert.notEqual(a.jobId, b.jobId); assert.equal(b.created, true); }
  assert.equal((await w.runs('biz-a')).length, 1);
  assert.equal((await w.runs('biz-b')).length, 1);
});

test('AMP-164 a publish that comes back with demo output is refused, not reported as live', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  // hasStore says yes, but the job handler's own store connection finds no address for this business (empty slugs): it falls back to the
  // labelled stub. This does not depend on how many times anything reads a slug.
  const sa = createStartAutomation({ publish: { workspaceId: WS, sites: w.sites, slugs: new Map<string, string>(), catalogue: { async listApprovedForBusiness() { return []; }, async getApprovedListing() { return null; }, async getCheckoutPrice() { return { priceMinor: 1900 }; } } as never, sellers: createInMemorySellerStore(), payments: () => ({ status: payments.status, adapter: payments.adapter }) } });
  const saYes = { ...sa, hasStore: async () => true } as typeof sa;
  const r = await publishStoreAsJob(saYes, (ws, b) => (ws === WS ? w.slugs.get(b) : undefined), { workspaceId: WS, businessId: 'biz-a', actorUserId: OWNER, idempotencyKey: 'rev-1' });
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.message, /No real store was found for this publish/);
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none', 'nothing went live');
});

test('AMP-172 the same publish key with a different input (another store address) is refused as already used, on the real job store', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const first = await w.publish('biz-a', 'rev-1');
  assert.equal(first.outcome, 'published', JSON.stringify(first));
  // The job input is { storeSlug }; the slug lookup now answers a different address for the same business and key. No faked enqueue.
  const other = await publishStoreAsJob(w.sa, (ws, b) => (ws === WS && b === 'biz-a' ? 'a-different-store' : undefined), { workspaceId: WS, businessId: 'biz-a', actorUserId: OWNER, idempotencyKey: 'rev-1' });
  assert.equal(other.outcome, 'refused', JSON.stringify(other));
  assert.match(other.message, /already used/);
  assert.equal((await w.runs('biz-a')).length, 1, 'no second run');
  const hist = await w.sites.history(actor, demoStore.slug);
  assert.ok(hist.ok);
  if (hist.ok) assert.equal(hist.value.versions.length, 1, 'one published version');
});

test('AMP-164 a drain that throws gives not_finished with an honest message', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const broken = { ...w.sa, jobs: { ...w.sa.jobs, runner: { ...w.sa.jobs.runner, drain: async () => { throw new Error('queue down'); } } } } as typeof w.sa;
  const r = await w.publish('biz-a', 'rev-1', WS, broken);
  assert.equal(r.outcome, 'not_finished', JSON.stringify(r));
  if (r.outcome === 'not_finished') { assert.doesNotMatch(r.message, /will be tried again|queue down/); assert.match(r.message, /not confirmed live/); }
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none');
});

test('AMP-164 a failed run tells the caller a new key is needed, and the same key does not publish again', async () => {
  const w = world(lax());
  const broken = { ...structuredClone(demoStore), contact: { ...demoStore.contact, email: '' } } as StoreConfig;
  await w.add('biz-a', broken);
  const r = await w.publish('biz-a', 'rev-1');
  assert.equal(r.outcome, 'failed');
  if (r.outcome === 'failed') assert.match(r.message, /new key/);
  assert.equal((await w.publish('biz-a', 'rev-1')).outcome, 'failed');
  assert.equal((await w.runs('biz-a')).length, 1);
});

test('AMP-164 the signed-in actor is required: without one nothing is started and no default owner is used', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  for (const actorUserId of [undefined, '', null] as unknown as string[]) {
    const r = await publishStoreAsJob(w.sa, (ws, b) => (ws === WS ? w.slugs.get(b) : undefined), { workspaceId: WS, businessId: 'biz-a', actorUserId, idempotencyKey: 'rev-1' });
    assert.equal(r.outcome, 'refused', JSON.stringify(r));
  }
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none', 'nothing went live');
  assert.deepEqual(await w.runs('biz-a'), [], 'no run was started');
});

test('AMP-168 settings that cannot be read give a refused outcome and start nothing (the call does not reject)', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const broken = { ...w.sa, automation: { ...w.sa.automation, getSettings: async () => { throw new Error('settings store down'); } } } as typeof w.sa;
  const r = await w.publish('biz-a', 'rev-1', WS, broken);
  assert.equal(r.outcome, 'refused', JSON.stringify(r));
  assert.match(r.message, /settings could not be read/);
  assert.doesNotMatch(r.message, /settings store down/);
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none');
  assert.deepEqual(await w.runs('biz-a'), []);
});

test('AMP-168 a queue that fails is told apart from a key that was already used', async () => {
  const w = world();
  await w.add('biz-a', demoStore);
  const withEnqueue = (enqueue: () => Promise<never>) => ({ ...w.sa, jobs: { ...w.sa.jobs, service: { ...w.sa.jobs.service, enqueue } } }) as typeof w.sa;
  const down = await w.publish('biz-a', 'rev-1', WS, withEnqueue(async () => { throw new Error('queue down'); }));
  assert.equal(down.outcome, 'refused', JSON.stringify(down));
  assert.match(down.message, /could not be started/);
  assert.doesNotMatch(down.message, /already used|queue down/);
  const used = await w.publish('biz-a', 'rev-1', WS, withEnqueue(async () => { throw new JobsError('conflict', 'That idempotency key was already used with different input.'); }));
  assert.equal(used.outcome, 'refused', JSON.stringify(used));
  assert.match(used.message, /already used/);
  assert.equal((await w.sites.resolvePublished(demoStore.slug)).status, 'none');
});

test('AMP-149 the runtime exposes publishStoreAsJob and runs no timer', () => {
  const runtime = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /export function publishStoreAsJob\(/);
  const mod = readFileSync(new URL('../app/start/_server/automation-runtime.ts', import.meta.url), 'utf8');
  // A source check is deliberate: "no timer is ever created" cannot be shown by behaviour in one run (a timer could be added on a path not taken here).
  assert.doesNotMatch(mod, /setInterval|setTimeout/);
});

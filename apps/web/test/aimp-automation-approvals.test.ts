import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATION_BUSINESS, AUTOMATION_WORKSPACE, automationCtx, createDemoAutomation, OTHER_BUSINESS } from '../lib/aimp/automation/demo.ts';
import { APPROVAL_TTL_MS, AutomationError, createAutomationService, createMemoryAutomationStore } from '../lib/aimp/automation/index.ts';
import { createDemoJobs } from '../lib/aimp/jobs/demo.ts';

const fresh = () => createDemoAutomation({});
const A = (k: string) => automationCtx(k);
const B = (k: string) => automationCtx(k, OTHER_BUSINESS);
const code = (c: string) => (e: unknown) => e instanceof AutomationError && e.code === c;
const jobsOf = async (d: ReturnType<typeof fresh>, businessId = 'demo-business') => (await d.jobs.service.list(automationCtx('x', businessId)));

test('defaults: marketing and publishing ask first, generation is automatic; modes are per business', async () => {
  const d = fresh();
  const s = await d.automation.getSettings(A('x'));
  assert.deepEqual(s.modes, { marketing: 'owner_approval', 'product-generation': 'automatic', publishing: 'owner_approval' });
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  assert.equal((await d.automation.getSettings(A('x'))).modes.marketing, 'automatic');
  assert.equal((await d.automation.getSettings(B('x'))).modes.marketing, 'owner_approval', 'another business is unchanged');
});

test('invalid modes, areas and missing business are refused', async () => {
  const d = fresh();
  await assert.rejects(d.automation.setMode(A('x'), 'marketing', 'sometimes' as never), code('invalid'));
  await assert.rejects(d.automation.setMode(A('x'), 'billing' as never, 'paused'), code('invalid'));
  await assert.rejects(d.automation.getSettings({ workspaceId: 'w', actorUserId: 'u', idempotencyKey: 'k' }), code('invalid'));
});

test('pausing marketing stops new marketing jobs and pauses queued ones, but never touches delivery', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  const queued = await d.automation.start(A('post-1'), { kind: 'scheduled-post', input: { n: 1 } });
  assert.equal(queued.outcome, 'started');
  await d.automation.setMode(A('x'), 'marketing', 'paused');

  const refused = await d.automation.start(A('post-2'), { kind: 'scheduled-post', input: { n: 2 } });
  assert.equal(refused.outcome, 'paused');
  assert.match((refused as { message: string }).message, /Marketing is paused/);
  assert.equal((await jobsOf(d)).length, 1, 'no second marketing job was created');
  assert.equal((await jobsOf(d))[0].status, 'paused', 'the queued post is held by the job engine, not cancelled and not left to run');

  const delivery = await d.automation.start(A('order-1'), { kind: 'fulfil-order', input: { orderId: 'o1' } });
  assert.equal(delivery.outcome, 'started', 'delivery is never paused');
  await d.jobs.runner.drain();
  const done = (await jobsOf(d)).find((j) => j.kind === 'fulfil-order');
  assert.equal(done?.status, 'succeeded');
});

test('owner approval records a pending request with a plain description and starts nothing', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 1 }, description: 'Publish version 3 of your store' });
  assert.equal(r.outcome, 'needs_approval');
  assert.equal((await jobsOf(d)).length, 0, 'no job exists while waiting for the owner');
  const list = await d.automation.approvals(A('x'), { status: 'pending' });
  assert.equal(list.length, 1);
  assert.equal(list[0].description, 'Publish version 3 of your store');
  assert.ok(!('input' in list[0]), 'the job input is never returned');
  const again = await d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 1 }, description: 'Publish version 3 of your store' });
  assert.equal(again.outcome === 'needs_approval' && again.created, false, 'same key, same approval');
  assert.equal((await d.automation.approvals(A('x'))).length, 1);
  await assert.rejects(d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 2 } }), code('conflict'));
});

test('approving twice (even in parallel) starts exactly one job', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', input: {}, description: 'Publish' });
  assert.equal(r.outcome, 'needs_approval');
  const id = (r as { approvalId: string }).approvalId;
  const [x, y] = await Promise.all([d.automation.decide(A('c1'), id, 'approve'), d.automation.decide(A('c2'), id, 'approve')]);
  assert.equal([x, y].filter((z) => z.ran).length, 1);
  assert.equal([x, y].filter((z) => z.alreadyDecided).length, 1);
  const z = await d.automation.decide(A('c3'), id, 'approve');
  assert.equal(z.ran, false);
  assert.equal(z.alreadyDecided, true);
  assert.equal((await jobsOf(d)).length, 1);
  await d.jobs.runner.drain();
  assert.equal(d.jobs.effects.executed().filter((e) => e.label === 'site.publish').length, 1);
  await assert.rejects(d.automation.decide(A('c4'), id, 'reject'), code('conflict'));
});

test('a rejected request never runs and cannot be approved later', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (r as { approvalId: string }).approvalId;
  const rej = await d.automation.decide(A('c'), id, 'reject');
  assert.equal(rej.approval.status, 'rejected');
  assert.equal((await d.automation.decide(A('c'), id, 'reject')).alreadyDecided, true);
  await assert.rejects(d.automation.decide(A('c'), id, 'approve'), code('conflict'));
  assert.equal((await jobsOf(d)).length, 0);
});

test('an expired request never runs', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (r as { approvalId: string }).approvalId;
  d.jobs.clock.advance(APPROVAL_TTL_MS + 1);
  await assert.rejects(d.automation.decide(A('c'), id, 'approve'), code('expired'));
  assert.equal((await d.automation.approvals(A('x')))[0].status, 'expired');
  assert.equal((await jobsOf(d)).length, 0);
});

test('only the owning business can decide; another business sees nothing and cannot change it', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (r as { approvalId: string }).approvalId;
  await assert.rejects(d.automation.decide(B('c'), id, 'approve'), code('not_found'));
  await assert.rejects(d.automation.decide(B('c'), id, 'reject'), code('not_found'));
  await assert.rejects(d.automation.decide({ ...A('c'), workspaceId: 'other-workspace' }, id, 'approve'), code('not_found'));
  assert.deepEqual(await d.automation.approvals(B('x')), []);
  assert.equal((await d.automation.approvals(A('x')))[0].status, 'pending');
  assert.equal((await jobsOf(d)).length, 0);
});

test('approving while the area is paused is refused and the request stays pending', async () => {
  const d = fresh();
  const r = await d.automation.start(A('post-1'), { kind: 'scheduled-post', description: 'Post to Pinterest' });
  const id = (r as { approvalId: string }).approvalId;
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  await assert.rejects(d.automation.decide(A('c'), id, 'approve'), code('blocked'));
  assert.equal((await d.automation.approvals(A('x')))[0].status, 'pending');
  assert.equal((await jobsOf(d)).length, 0);
  await d.automation.setMode(A('x'), 'marketing', 'owner_approval');
  assert.equal((await d.automation.decide(A('c'), id, 'approve')).ran, true);
});

test('a failed enqueue puts the request back so the owner can try again', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (r as { approvalId: string }).approvalId;
  const real = d.jobs.service.enqueue;
  d.jobs.service.enqueue = async () => { throw new Error('store down'); };
  await assert.rejects(d.automation.decide(A('c'), id, 'approve'));
  d.jobs.service.enqueue = real;
  assert.equal((await d.automation.approvals(A('x')))[0].status, 'pending');
  assert.equal((await d.automation.decide(A('c'), id, 'approve')).ran, true);
});

const scope = { workspaceId: AUTOMATION_WORKSPACE, businessId: AUTOMATION_BUSINESS };
function genSetup() {
  const jobs = createDemoJobs({});
  const base = createMemoryAutomationStore();
  const hooks = { failJobIdWrite: false };
  const store = {
    ...base,
    transitionApproval: async (...a: Parameters<typeof base.transitionApproval>) => {
      if (hooks.failJobIdWrite && typeof a[3].jobId === 'string') { hooks.failJobIdWrite = false; throw new Error('write failed'); }
      return base.transitionApproval(...a);
    },
  };
  const automation = createAutomationService({ store, jobs: jobs.service, now: jobs.clock.now, defaultCap: 5 });
  const genJobs = async () => (await jobs.service.list(A('x'))).filter((j) => j.kind === 'generate-product');
  return { jobs, base, hooks, automation, genJobs };
}

test('start() on an approved request with no job (crash recovery) takes a generation slot, and is refused when over the allowance', async () => {
  const g = genSetup();
  await g.automation.setMode(A('x'), 'product-generation', 'owner_approval');
  await g.automation.setCap(A('x'), 1);
  const r1 = await g.automation.start(A('g1'), { kind: 'generate-product', input: { niche: 'a' } });
  const r2 = await g.automation.start(A('g2'), { kind: 'generate-product', input: { niche: 'a' } });
  const id1 = (r1 as { approvalId: string }).approvalId;
  const id2 = (r2 as { approvalId: string }).approvalId;
  assert.equal((await g.automation.decide(A('c'), id1, 'approve')).ran, true);
  assert.equal((await g.automation.usage(A('x'))).used, 1);
  // Crash: g2 was marked approved but nothing else happened.
  assert.equal(await g.base.transitionApproval(scope, id2, 'pending', { status: 'approved', decidedAt: 1 }), true);

  const refused = await g.automation.start(A('g2'), { kind: 'generate-product', input: { niche: 'a' } });
  assert.equal(refused.outcome, 'cap_reached');
  assert.equal((await g.genJobs()).length, 1, 'no job was created past the allowance');
  assert.equal((await g.automation.usage(A('x'))).used, 1);

  await g.automation.setCap(A('x'), 2);
  const ok = await g.automation.start(A('g2'), { kind: 'generate-product', input: { niche: 'a' } });
  assert.equal(ok.outcome, 'started');
  assert.equal((await g.genJobs()).length, 2);
  assert.equal((await g.automation.usage(A('x'))).used, 2, 'the recovered job took its slot');
  const again = await g.automation.start(A('g2'), { kind: 'generate-product', input: { niche: 'a' } });
  assert.ok(again.outcome === 'started' && again.created === false);
  assert.equal((await g.automation.usage(A('x'))).used, 2, 'and only once');
});

test('AMP-048: a slot already held by an approval is released whenever the approval reverts to pending, exactly once', async () => {
  const g = genSetup();
  await g.automation.setMode(A('x'), 'product-generation', 'owner_approval');
  await g.automation.setCap(A('x'), 2);
  const mk = async (k: string) => ((await g.automation.start(A(k), { kind: 'generate-product', input: { niche: k } })) as { approvalId: string }).approvalId;
  const id1 = await mk('g1');
  const id2 = await mk('g2');
  assert.equal((await g.automation.decide(A('c'), id1, 'approve')).ran, true);
  // The second approval already holds a slot (taken earlier, for example by a crashed attempt): the cap is full.
  g.base.addReservation(scope, `approval-${id2}`, (await g.automation.usage(A('x'))).periodKey, g.jobs.clock.now());
  assert.equal((await g.automation.usage(A('x'))).used, 2);
  const real = g.jobs.service.enqueue;
  g.jobs.service.enqueue = async () => { throw new Error('store down'); };
  await assert.rejects(g.automation.decide(A('c'), id2, 'approve'), /store down/);
  assert.equal(g.base.getApproval(scope, id2)?.status, 'pending');
  assert.equal((await g.automation.usage(A('x'))).used, 1, 'the slot came back');
  await assert.rejects(g.automation.decide(A('c'), id2, 'approve'), /store down/);
  assert.equal((await g.automation.usage(A('x'))).used, 1, 'reverting twice does not release a second slot');
  g.jobs.service.enqueue = real;
  const r3 = await g.automation.start(A('g3'), { kind: 'generate-product', input: { niche: 'g3' } });
  assert.equal(r3.outcome, 'needs_approval', 'a new item fits');
  assert.equal((await g.automation.usage(A('x'))).used, 1);
  assert.equal((await g.automation.decide(A('c'), id2, 'approve')).ran, true);
  assert.equal((await g.automation.usage(A('x'))).used, 2, 'approving after reverting takes one slot, once');
  await g.automation.decide(A('c'), id2, 'approve');
  assert.equal((await g.automation.usage(A('x'))).used, 2);
});

test('if the job id write fails after the job was created, the approval stays approved, the slot is kept, and start() finds the same job', async () => {
  const g = genSetup();
  await g.automation.setMode(A('x'), 'product-generation', 'owner_approval');
  const r = await g.automation.start(A('g1'), { kind: 'generate-product', input: { niche: 'a' } });
  const id = (r as { approvalId: string }).approvalId;
  g.hooks.failJobIdWrite = true;
  await assert.rejects(g.automation.decide(A('c'), id, 'approve'), /write failed/);
  assert.equal(g.base.getApproval(scope, id)?.status, 'approved', 'not put back to pending');
  const created = await g.genJobs();
  assert.equal(created.length, 1, 'the job exists');
  assert.equal((await g.automation.usage(A('x'))).used, 1, 'its slot is kept');

  const again = await g.automation.start(A('g1'), { kind: 'generate-product', input: { niche: 'a' } });
  assert.ok(again.outcome === 'started');
  assert.equal(again.jobId, created[0].id, 'the same job, not a second one');
  assert.equal(again.created, false);
  assert.equal((await g.genJobs()).length, 1);
  assert.equal((await g.automation.usage(A('x'))).used, 1);
});

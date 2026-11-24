import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTOMATION_BUSINESS, AUTOMATION_WORKSPACE, automationCtx, createDemoAutomation, OTHER_BUSINESS } from '../lib/aimp/automation/demo.ts';
import { APPROVAL_TTL_MS, AREA_FOR_KIND, AutomationError, UNGATED_KINDS } from '../lib/aimp/automation/index.ts';
import { builtInJobKinds, createJobRegistry, createJobRunner, createJobService, createMemoryJobStore } from '../lib/aimp/jobs/index.ts';
import { createAutomationService } from '../lib/aimp/automation/service.ts';
import { createMemoryAutomationStore } from '../lib/aimp/automation/store.ts';
import { createDemoJobs } from '../lib/aimp/jobs/demo.ts';

// AMP-061 rework: pausing really holds scheduled jobs, decided keys stay decided, retry exists, no double run, unique event ids,
// compare-and-set on approvals.
const fresh = () => createDemoAutomation({});
const A = (k: string) => automationCtx(k);
const B = (k: string) => automationCtx(k, OTHER_BUSINESS);
const code = (c: string) => (e: unknown) => e instanceof AutomationError && e.code === c;
const jobsOf = async (d: ReturnType<typeof fresh>, businessId = AUTOMATION_BUSINESS) => (await d.jobs.service.list(automationCtx('x', businessId))).filter((j) => j.businessId === businessId);
const posts = (d: ReturnType<typeof fresh>) => d.jobs.effects.executed().filter((e) => e.label === 'social.queuePost').length;
const scope = { workspaceId: AUTOMATION_WORKSPACE, businessId: AUTOMATION_BUSINESS };

test('pausing marketing holds a scheduled post: it does not run past its time, and runs once after unpausing', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  const r = await d.jobs.service.enqueue(A('post-1'), { kind: 'scheduled-post', input: { n: 1 }, runAt: d.jobs.clock.now() + 60 * 60_000 });
  assert.equal(r.created, true);
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  d.jobs.clock.advance(48 * 60 * 60_000); // well past its run time
  await d.jobs.runner.drain();
  assert.equal(posts(d), 0, 'the post did not run while marketing was paused');
  assert.equal((await jobsOf(d))[0].status, 'paused');

  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  await d.jobs.runner.drain();
  assert.equal(posts(d), 1, 'it ran once after unpausing');
  assert.equal((await jobsOf(d))[0].status, 'succeeded');
  await d.jobs.runner.drain();
  assert.equal(posts(d), 1);

  const titles = (await d.automation.activity(A('x'))).entries.map((e) => e.title);
  assert.ok(titles.some((t) => /^Paused because Marketing is paused: Scheduled post/.test(t)), 'the pause is in the feed');
  assert.ok(titles.some((t) => /^Resumed because Marketing is on again: Scheduled post/.test(t)), 'the resume is in the feed');
});

test('pausing is safe twice and only touches this business and this area; a job the owner paused is not resumed', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  await d.automation.setMode(B('x'), 'marketing', 'automatic');
  const mine = await d.automation.start(A('post-mine'), { kind: 'scheduled-post' });
  const theirs = await d.automation.start(B('post-theirs'), { kind: 'scheduled-post' });
  const gen = await d.automation.start(A('gen-1'), { kind: 'generate-product' });
  const own = await d.automation.start(A('post-owner-paused'), { kind: 'scheduled-post', input: { n: 9 } });
  assert.ok(mine.outcome === 'started' && theirs.outcome === 'started' && gen.outcome === 'started' && own.outcome === 'started');
  await d.jobs.service.pause(A('x'), own.jobId, AUTOMATION_BUSINESS); // the owner paused this one separately

  await d.automation.setMode(A('x'), 'marketing', 'paused');
  await d.automation.setMode(A('x'), 'marketing', 'paused'); // twice: a no-op
  const status = async (id: string, biz = AUTOMATION_BUSINESS) => (await d.jobs.service.get(automationCtx('x', biz), id)).status;
  assert.equal(await status(mine.jobId), 'paused');
  assert.equal(await status(theirs.jobId, OTHER_BUSINESS), 'queued', 'another business is untouched');
  assert.equal(await status(gen.jobId), 'queued', 'another area is untouched');

  await d.automation.setMode(A('x'), 'marketing', 'owner_approval');
  await d.automation.setMode(A('x'), 'marketing', 'owner_approval'); // twice: a no-op
  assert.equal(await status(mine.jobId), 'queued', 'the job this module paused is resumed');
  assert.equal(await status(own.jobId), 'paused', 'the job the owner paused stays paused');
  assert.equal(await status(theirs.jobId, OTHER_BUSINESS), 'queued');
  await d.jobs.runner.drain();
  assert.equal(await status(mine.jobId), 'succeeded');
  assert.equal(await status(own.jobId), 'paused');
  const resumedEvents = (await d.automation.activity(A('x'))).entries.filter((e) => /^Resumed because/.test(e.title));
  assert.equal(resumedEvents.length, 1);
});

test('queued and waiting-retry jobs are paused (and resumed); a finished job is left alone', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  const done = await d.automation.start(A('post-done'), { kind: 'scheduled-post' });
  assert.equal(done.outcome, 'started');
  await d.jobs.runner.drain();
  // A second post fails once with a temporary error and waits for its retry.
  d.jobs.faults.add({ kind: 'scheduled-post', step: 'prepare-post', times: 1, type: 'temporary' });
  const retrying = await d.automation.start(A('post-retry'), { kind: 'scheduled-post', input: { n: 2 } });
  assert.ok(retrying.outcome === 'started');
  await d.jobs.runner.runDue();
  const statusOf = async (id: string) => (await d.jobs.service.get(A('x'), id)).status;
  assert.equal(await statusOf(retrying.jobId), 'waiting-retry');

  await d.automation.setMode(A('x'), 'marketing', 'paused');
  const finished = (await jobsOf(d)).find((j) => j.id !== retrying.jobId)!;
  assert.equal(finished.status, 'succeeded');
  assert.equal(await statusOf(retrying.jobId), 'paused', 'the waiting-retry job is paused');
  d.jobs.clock.advance(60 * 60_000);
  await d.jobs.runner.drain();
  assert.equal(await statusOf(retrying.jobId), 'paused', 'and does not retry while paused');

  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  assert.equal((await jobsOf(d)).find((j) => j.id !== retrying.jobId)!.status, 'succeeded');
  await d.jobs.runner.drain();
  assert.equal(await statusOf(retrying.jobId), 'succeeded');
  assert.equal(posts(d), 2);
});

test('a scheduled post with a future run time is not run early by an unpause, and runs once when due', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  const runAt = d.jobs.clock.now() + 24 * 60 * 60_000;
  const { job } = await d.jobs.service.enqueue(A('post-tomorrow'), { kind: 'scheduled-post', runAt });
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  d.jobs.clock.advance(60 * 60_000);
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  await d.jobs.runner.drain();
  assert.equal(posts(d), 0, 'not run at unpause time');
  assert.equal((await d.jobs.service.get(A('x'), job.id)).status, 'queued');
  d.jobs.clock.advance(24 * 60 * 60_000);
  await d.jobs.runner.drain();
  assert.equal(posts(d), 1);
  await d.jobs.runner.drain();
  assert.equal(posts(d), 1);
});

test('a job that is mid-step when the area is paused runs no later step while paused, and completes once after unpausing', async () => {
  const jobsStore = createMemoryJobStore();
  let t = 1_000_000;
  const executed: string[] = [];
  const seen = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let entered!: () => void;
  const inStep = new Promise<void>((r) => { entered = r; });
  // Effects are keyed like a provider that honours idempotency keys: the same key does the work once.
  const effect = (key: string) => { if (!seen.has(key)) { seen.add(key); executed.push(key); } };
  const registry = createJobRegistry([{
    kind: 'scheduled-post',
    steps: [
      { name: 'one', run: async (a) => { entered(); await gate; effect(a.idempotencyKey); return { output: { ok: 1 } }; } },
      { name: 'two', run: async (a) => { effect(a.idempotencyKey); return { output: { ok: 2 } }; } },
    ],
  }]);
  const service = createJobService({ store: jobsStore, registry, now: () => t });
  const runner = createJobRunner({ store: jobsStore, registry, owner: 'r', now: () => t, random: () => 0, leaseMs: 60_000 });
  const automation = createAutomationService({ store: createMemoryAutomationStore(), jobs: service, now: () => t });
  await automation.setMode(A('x'), 'marketing', 'automatic');
  const started = await automation.start(A('multi'), { kind: 'scheduled-post' });
  assert.ok(started.outcome === 'started');

  const inflight = runner.runDue();
  await inStep; // step one is running
  assert.equal((await service.get(A('x'), started.jobId)).status, 'running');
  await automation.setMode(A('x'), 'marketing', 'paused');
  assert.equal((await service.get(A('x'), started.jobId)).status, 'paused', 'the running job is paused');
  release();
  const [report] = await inflight;
  assert.equal(report.outcome, 'lost-lease', 'its late result is discarded');
  t += 60 * 60_000;
  assert.deepEqual(await runner.drain(), [], 'nothing runs while paused');
  assert.ok(!executed.some((k) => k.endsWith(':two')), 'no later step ran');

  await automation.setMode(A('x'), 'marketing', 'automatic');
  await runner.drain();
  assert.equal((await service.get(A('x'), started.jobId)).status, 'succeeded');
  assert.deepEqual(executed.sort(), [`${started.jobId}:one`, `${started.jobId}:two`], 'each step effect happened once per key');
});

/** Automation over a job service whose pause/resume throw once when asked to. */
function flaky() {
  const d = createDemoJobs({});
  const fail = { pause: false, resume: false };
  const service = {
    ...d.service,
    pause: async (...a: Parameters<typeof d.service.pause>) => { if (fail.pause) { fail.pause = false; throw new Error('store down'); } return d.service.pause(...a); },
    resume: async (...a: Parameters<typeof d.service.resume>) => { if (fail.resume) { fail.resume = false; throw new Error('store down'); } return d.service.resume(...a); },
  };
  const automation = createAutomationService({ store: createMemoryAutomationStore(), jobs: service, now: d.clock.now });
  return { d, fail, automation };
}
const modeEvents = async (a: { automation: ReturnType<typeof createAutomationService> }) => (await a.automation.activity(A('x'))).entries.filter((e) => /changed from/.test(e.title)).length;

test('a pause that failed half way is completed by setting paused again, without a second mode-changed event', async () => {
  const f = flaky();
  await f.automation.setMode(A('x'), 'marketing', 'automatic');
  const { job } = await f.d.service.enqueue(A('post-1'), { kind: 'scheduled-post' });
  const before = await modeEvents(f);
  f.fail.pause = true;
  await assert.rejects(f.automation.setMode(A('x'), 'marketing', 'paused'), /store down/);
  assert.equal((await f.automation.getSettings(A('x'))).modes.marketing, 'paused');
  assert.equal((await f.d.service.get(A('x'), job.id)).status, 'queued', 'half done');
  await f.automation.setMode(A('x'), 'marketing', 'paused');
  assert.equal((await f.d.service.get(A('x'), job.id)).status, 'paused', 'repaired');
  assert.equal(await modeEvents(f), before + 1, 'one mode-changed event, not two');
});

test('a resume that failed half way is completed by setting the mode again', async () => {
  const f = flaky();
  await f.automation.setMode(A('x'), 'marketing', 'automatic');
  const { job } = await f.d.service.enqueue(A('post-1'), { kind: 'scheduled-post' });
  await f.automation.setMode(A('x'), 'marketing', 'paused');
  assert.equal((await f.d.service.get(A('x'), job.id)).status, 'paused');
  const before = await modeEvents(f);
  f.fail.resume = true;
  await assert.rejects(f.automation.setMode(A('x'), 'marketing', 'automatic'), /store down/);
  assert.equal((await f.d.service.get(A('x'), job.id)).status, 'paused', 'half done');
  await f.automation.setMode(A('x'), 'marketing', 'automatic');
  assert.equal((await f.d.service.get(A('x'), job.id)).status, 'queued', 'repaired');
  assert.equal(await modeEvents(f), before + 1);
});

test('every built-in job kind is gated by an area or explicitly ungated, so a new kind cannot be silently unpausable', () => {
  for (const k of builtInJobKinds) {
    assert.ok(k in AREA_FOR_KIND || UNGATED_KINDS.includes(k), `${k} needs an area in AREA_FOR_KIND or a place in UNGATED_KINDS`);
    assert.ok(!(k in AREA_FOR_KIND && UNGATED_KINDS.includes(k)), `${k} cannot be both`);
  }
});

test('a rejected request key stays decided: it answers "rejected", creates nothing and never says it is waiting', async () => {
  const d = fresh();
  const r = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (r as { approvalId: string }).approvalId;
  await d.automation.decide(A('c'), id, 'reject');
  const again = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  assert.equal(again.outcome, 'already_decided');
  assert.ok(again.outcome === 'already_decided' && again.decision === 'rejected');
  assert.doesNotMatch(again.message, /waiting for your approval/i);
  assert.equal((await d.automation.approvals(A('x'))).length, 1, 'no second approval');
  assert.equal((await jobsOf(d)).length, 0);

  // Switching to automatic must not run a rejected key.
  await d.automation.setMode(A('x'), 'publishing', 'automatic');
  const auto = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  assert.equal(auto.outcome, 'already_decided');
  assert.equal((await jobsOf(d)).length, 0, 'a rejected request never runs unapproved');
  await assert.rejects(d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 2 } }), code('conflict'));
});

test('an expired request key answers "expired", creates nothing, and does not run under automatic', async () => {
  const d = fresh();
  await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  d.jobs.clock.advance(APPROVAL_TTL_MS + 1);
  const again = await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  assert.ok(again.outcome === 'already_decided' && again.decision === 'expired');
  assert.doesNotMatch(again.message, /waiting for your approval/i);
  await d.automation.setMode(A('x'), 'publishing', 'automatic');
  assert.equal((await d.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' })).outcome, 'already_decided');
  assert.equal((await d.automation.approvals(A('x'))).length, 1);
  assert.equal((await jobsOf(d)).length, 0);
});

test('retry: a failed job can be retried from the service, finished steps are not repeated, and the retry is in the feed', async () => {
  const d = fresh();
  d.jobs.faults.add({ kind: 'publish-site', step: 'publish', times: 1, type: 'permanent', when: 'before', message: 'Provider refused.' });
  await d.automation.setMode(A('x'), 'publishing', 'automatic');
  await d.automation.start(A('pub'), { kind: 'publish-site' });
  await d.jobs.runner.drain();
  const failed = (await d.automation.activity(A('x'))).entries.find((e) => e.status === 'failed');
  assert.ok(failed?.jobId);
  assert.match(failed.nextAction ?? '', /Retry/);
  assert.doesNotMatch(failed.nextAction ?? '', /Open the job/);

  await assert.rejects(d.automation.retryJob(B('x'), failed.jobId), code('not_found'), 'another business cannot retry it');
  assert.equal((await jobsOf(d))[0].status, 'failed', 'still failed after the refused attempt');
  await assert.rejects(d.automation.retryJob(A('x'), 'no-such-job'), code('not_found'));

  const r = await d.automation.retryJob(A('x'), failed.jobId);
  assert.equal(r.jobId, failed.jobId);
  await d.jobs.runner.drain();
  assert.equal((await jobsOf(d))[0].status, 'succeeded');
  assert.equal(d.jobs.effects.executed().filter((e) => e.label === 'site.publish').length, 1);
  assert.ok((await d.automation.activity(A('x'))).entries.some((e) => /^You chose Retry: Site publishing/.test(e.title)));
  await assert.rejects(d.automation.retryJob(A('x'), failed.jobId), code('conflict'), 'a job that is not failed cannot be retried');
  assert.equal((await d.automation.activity(B('x'))).entries.length, 0, 'nothing leaked to the other business');
});

test('a key started under automatic and re-sent under owner approval answers as the same job and runs once', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'publishing', 'automatic');
  const first = await d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 1 } });
  assert.equal(first.outcome, 'started');
  await d.automation.setMode(A('x'), 'publishing', 'owner_approval');
  const again = await d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 1 } });
  assert.ok(again.outcome === 'started' && first.outcome === 'started' && again.jobId === first.jobId && again.created === false);
  assert.equal((await d.automation.approvals(A('x'))).length, 0, 'no approval was created');
  await assert.rejects(d.automation.start(A('pub-1'), { kind: 'publish-site', input: { v: 2 } }), code('conflict'));
  await d.jobs.runner.drain();
  assert.equal(d.jobs.effects.executed().filter((e) => e.label === 'site.publish').length, 1);
  // Another business using the same key is not treated as a duplicate.
  await d.automation.setMode(B('x'), 'publishing', 'owner_approval');
  assert.equal((await d.automation.start(B('pub-1'), { kind: 'publish-site', input: { v: 1 } })).outcome, 'needs_approval');
});

test('two changes in the same millisecond are both recorded', async () => {
  const d = fresh();
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  await d.automation.setMode(A('x'), 'marketing', 'automatic');
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  await d.automation.setCap(A('x'), 5);
  await d.automation.setCap(A('x'), 6);
  const titles = (await d.automation.activity(A('x'))).entries.map((e) => e.title);
  assert.equal(titles.filter((t) => /^Marketing changed from/.test(t)).length, 3);
  assert.equal(titles.filter((t) => /allowance is now/.test(t)).length, 2);
});

function raced() {
  const jobs = createDemoJobs({});
  const base = createMemoryAutomationStore();
  let before: (() => Promise<void>) | null = null;
  const store = {
    ...base,
    transitionApproval: async (...a: Parameters<typeof base.transitionApproval>) => { const h = before; before = null; if (h) await h(); return base.transitionApproval(...a); },
  };
  const automation = createAutomationService({ store, jobs: jobs.service, now: jobs.clock.now });
  return { jobs, base, store, automation, beforeNext: (f: () => Promise<void>) => { before = f; } };
}

test('approve that loses a race to a concurrent reject answers conflict and runs nothing', async () => {
  const r = raced();
  const s = await r.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (s as { approvalId: string }).approvalId;
  r.beforeNext(async () => { await r.base.transitionApproval(scope, id, 'pending', { status: 'rejected', decidedAt: 1 }); });
  await assert.rejects(r.automation.decide(A('c'), id, 'approve'), code('conflict'));
  assert.equal((await r.jobs.service.list(A('x'))).length, 0);
  assert.equal((await r.automation.approvals(A('x')))[0].status, 'rejected');
});

test('approve that loses a race to a concurrent approve answers alreadyDecided and enqueues nothing extra', async () => {
  const r = raced();
  const s = await r.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (s as { approvalId: string }).approvalId;
  r.beforeNext(async () => { await r.base.transitionApproval(scope, id, 'pending', { status: 'approved', decidedAt: 1 }); });
  const res = await r.automation.decide(A('c'), id, 'approve');
  assert.equal(res.alreadyDecided, true);
  assert.equal(res.ran, false);
  assert.equal((await r.jobs.service.list(A('x'))).length, 0, 'the loser enqueued nothing');
});

test('an expiry write can never overwrite an approval that won first', async () => {
  const r = raced();
  const s = await r.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (s as { approvalId: string }).approvalId;
  const stale = r.base.listApprovals(scope); // a reader that still sees "pending"
  assert.equal((await r.automation.decide(A('c'), id, 'approve')).ran, true);
  r.jobs.clock.advance(APPROVAL_TTL_MS + 1);
  r.store.listApprovals = () => stale;
  const list = await r.automation.approvals(A('x'));
  assert.equal(list[0].status, 'approved', 'still approved');
  assert.ok(!(await r.automation.activity(A('x'))).entries.some((e) => /expired/.test(e.title)), 'no expiry was recorded');
});

test('transitionApproval is compare-and-set and scoped to the business', async () => {
  const r = raced();
  const s = await r.automation.start(A('pub-1'), { kind: 'publish-site', description: 'Publish' });
  const id = (s as { approvalId: string }).approvalId;
  assert.equal(await r.base.transitionApproval({ ...scope, businessId: OTHER_BUSINESS }, id, 'pending', { status: 'approved' }), false);
  assert.equal(await r.base.transitionApproval(scope, id, 'approved', { status: 'rejected' }), false, 'wrong expected status');
  assert.equal(await r.base.transitionApproval(scope, id, 'pending', { status: 'expired', decidedAt: 5 }), true);
  assert.equal(await r.base.transitionApproval(scope, id, 'pending', { status: 'approved' }), false, 'second writer loses');
  assert.equal(r.base.getApproval(scope, id)?.status, 'expired');
});

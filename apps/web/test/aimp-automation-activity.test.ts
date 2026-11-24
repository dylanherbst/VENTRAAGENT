import assert from 'node:assert/strict';
import test from 'node:test';
import { automationCtx, createDemoAutomation, OTHER_BUSINESS } from '../lib/aimp/automation/demo.ts';

const fresh = () => createDemoAutomation({});
const A = (k: string) => automationCtx(k);
const B = (k: string) => automationCtx(k, OTHER_BUSINESS);

test('empty feed for a new business', async () => {
  const f = await fresh().automation.activity(A('x'));
  assert.deepEqual(f, { entries: [], needsYou: 0, failed: 0, retrying: 0 });
});

test('the feed is newest first and shows what ran, what waits for the owner and settings changes', async () => {
  const d = fresh();
  await d.automation.start(A('g1'), { kind: 'generate-product', input: { niche: 'planners' } });
  d.jobs.clock.advance(1000);
  await d.jobs.runner.drain();
  d.jobs.clock.advance(1000);
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  d.jobs.clock.advance(1000);
  await d.automation.start(A('pub'), { kind: 'publish-site', description: 'Publish version 2' });
  const f = await d.automation.activity(A('x'));
  const times = f.entries.map((e) => e.at);
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal(f.needsYou, 1);
  assert.equal(f.entries[0].status, 'needs_approval');
  assert.equal(f.entries[0].label, 'Needs you');
  assert.equal(f.entries[0].nextAction, 'Approve or reject.');
  assert.ok(f.entries.some((e) => e.source === 'setting' && /Marketing changed from "owner_approval" to "paused"/.test(e.title)));
  const job = f.entries.find((e) => e.source === 'job');
  assert.equal(job?.title, 'Product generation');
  assert.equal(job?.label, 'Complete');
  assert.equal(job?.detail, 'Finished.');
});

test('a temporary failure shows as retrying with the next retry time, then as finished after a retry', async () => {
  const d = fresh();
  d.jobs.faults.add({ kind: 'generate-product', step: 'draft-spec', times: 1, type: 'temporary', when: 'before' });
  await d.automation.start(A('g1'), { kind: 'generate-product' });
  await d.jobs.runner.runDue();
  let f = await d.automation.activity(A('x'));
  assert.equal(f.retrying, 1);
  const e = f.entries.find((x) => x.source === 'job');
  assert.equal(e?.status, 'waiting-retry');
  assert.equal(e?.label, 'Retrying');
  assert.ok(typeof e?.nextRetryAt === 'number' && e.nextRetryAt > d.jobs.clock.now());
  d.jobs.clock.advance(20 * 60_000);
  await d.jobs.runner.drain();
  f = await d.automation.activity(A('x'));
  const done = f.entries.find((x) => x.source === 'job');
  assert.equal(done?.status, 'succeeded');
  assert.match(done?.detail ?? '', /Finished after 1 retry/);
});

test('a permanent failure shows a safe reason and the exact next action, without secrets', async () => {
  const d = fresh();
  d.jobs.faults.add({ kind: 'publish-site', step: 'publish', times: 1, type: 'permanent', when: 'before', message: 'Refused sk_live_ABCDEF1234567890 at /Users/me/app/secret.ts' });
  await d.automation.setMode(A('x'), 'publishing', 'automatic');
  await d.automation.start(A('pub'), { kind: 'publish-site', input: { apiKey: 'sk_live_INPUTSECRET99' } });
  await d.jobs.runner.drain();
  const f = await d.automation.activity(A('x'));
  assert.equal(f.failed, 1);
  const e = f.entries.find((x) => x.status === 'failed');
  assert.ok(e);
  assert.equal(e.needsOwner, true);
  assert.match(e.nextAction ?? '', /Retry/);
  const all = JSON.stringify(f);
  assert.doesNotMatch(all, /sk_live|INPUTSECRET|\/Users\/me|pub"|approval-|leaseOwner|demo-runner|idempotency/i);
});

test('approved, rejected and expired requests stay in the feed with their own wording', async () => {
  const d = fresh();
  const mk = async (k: string, text: string) => (await d.automation.start(A(k), { kind: 'scheduled-post', description: text }) as { approvalId: string }).approvalId;
  const a = await mk('p1', 'Post one'); const b = await mk('p2', 'Post two'); await mk('p3', 'Post three');
  await d.automation.decide(A('c'), a, 'approve');
  await d.automation.decide(A('c'), b, 'reject');
  d.jobs.clock.advance(25 * 60 * 60_000);
  const f = await d.automation.activity(A('x'));
  const titles = f.entries.map((e) => e.title);
  assert.ok(titles.includes('You approved: Post one'));
  assert.ok(titles.includes('You rejected: Post two'));
  assert.ok(titles.some((t) => /expired and was not run: Post three/.test(t)));
  assert.equal(f.needsYou, 0);
  assert.equal(f.entries.filter((e) => e.id.startsWith('approval:')).length, 0, 'nothing is still waiting');
});

test('each business sees only its own activity', async () => {
  const d = fresh();
  await d.automation.start(A('g1'), { kind: 'generate-product' });
  await d.automation.start(A('pub'), { kind: 'publish-site', description: 'Publish' });
  await d.automation.setMode(A('x'), 'marketing', 'paused');
  await d.jobs.runner.drain();
  assert.ok((await d.automation.activity(A('x'))).entries.length >= 3);
  assert.deepEqual((await d.automation.activity(B('x'))).entries, []);
  await d.automation.start(B('g1'), { kind: 'generate-product' });
  const b = await d.automation.activity(B('x'));
  assert.equal(b.entries.length, 1);
  assert.ok(!(await d.automation.activity(A('x'))).entries.some((e) => e.id === b.entries[0].id));
});

test('the same request key in two businesses of one workspace never shares a job', async () => {
  const d = fresh();
  const a = await d.automation.start(A('same'), { kind: 'generate-product' });
  const b = await d.automation.start(B('same'), { kind: 'generate-product' });
  assert.ok(a.outcome === 'started' && b.outcome === 'started');
  assert.equal(b.created, true);
  assert.notEqual(a.jobId, b.jobId);
});

test('the feed limit is respected', async () => {
  const d = fresh();
  for (let i = 0; i < 5; i++) { await d.automation.setMode(A('x'), 'marketing', i % 2 ? 'automatic' : 'paused'); d.jobs.clock.advance(10); }
  assert.equal((await d.automation.activity(A('x'), { limit: 2 })).entries.length, 2);
});

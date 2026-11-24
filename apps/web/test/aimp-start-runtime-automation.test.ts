// AMP-140: the /start runtime carries its own automation service, and the Operator runs and Approvals pages read it.
// Real code: createStartAutomation (app/start/_server/automation-runtime.ts), the real Operator and Approvals loaders and the real
// automation service. runtime.ts itself cannot be loaded by node, so its wiring and source.ts are checked as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStartAutomation } from '../app/start/_server/automation-runtime.ts';
import { automationContext, loadApprovals } from '../app/app/[business]/approvals/_server/approvals.ts';
import type { ApprovalsDeps } from '../app/app/[business]/approvals/_server/approvals.ts';
import { runApprovalsOp } from '../app/app/[business]/approvals/_server/approvals-guard.ts';
import { loadOperator } from '../app/app/[business]/operator/_server/operator.ts';
import { buildOperator } from '../app/app/[business]/operator/view-model.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const A = 'biz-a';
const B = 'biz-b';
const ON = { available: true, reason: '' };

function world() {
  const sa = createStartAutomation();
  const rt = { businesses: new Set<string>([A, B]), seeds: new Map<string, unknown>(), slugs: new Map<string, string>(), productIds: new Map<string, string[]>() };
  const deps: ApprovalsDeps = { automation: () => sa.automation, workspaceId: WS, actorUserId: OWNER };
  const ctx = (key: string, businessId = A, workspaceId = WS) => ({ workspaceId, businessId, actorUserId: OWNER, idempotencyKey: key });
  const runs = async (businessId = A, d: ApprovalsDeps = deps) => {
    const r = await loadOperator(rt, d, businessId);
    assert.ok(r.found && r.state === 'ready');
    if (!(r.found && r.state === 'ready')) throw new Error('unreachable');
    return buildOperator(businessId, null, r.data).runs;
  };
  return { sa, rt, deps, ctx, runs };
}

test('AMP-140 a fresh runtime shows no runs and no approvals: nothing is invented', async () => {
  const w = world();
  assert.deepEqual(await w.runs(A), []);
  const r = await loadApprovals(w.rt, w.deps, A);
  assert.ok(r.found && r.state === 'ready');
  if (r.found && r.state === 'ready') { assert.deepEqual(r.data.approvals, []); assert.deepEqual(r.data.activity, []); }
});

test('AMP-140 a run started in the runtime service shows on the Operator page loader, and its progress follows the job engine', async () => {
  const w = world();
  const started = await w.sa.automation.start(w.ctx('gen-1'), { kind: 'generate-product', input: { niche: 'planners' } });
  assert.equal(started.outcome, 'started');
  let runs = await w.runs(A);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].title, 'Product generation');
  assert.equal(runs[0].status, 'queued');
  await w.sa.jobs.runner.drain({ workspaceId: WS });
  runs = await w.runs(A);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'succeeded');
});

test('AMP-140 two businesses and two workspaces: runs and approvals never cross', async () => {
  const w = world();
  assert.equal((await w.sa.automation.start(w.ctx('gen-a', A), { kind: 'generate-product', input: {} })).outcome, 'started');
  const ask = await w.sa.automation.start(w.ctx('post-a', A), { kind: 'scheduled-post', input: { post: 'x' }, description: 'Post for A' });
  assert.equal(ask.outcome, 'needs_approval');
  assert.equal((await w.runs(A)).length, 1);
  assert.deepEqual(await w.runs(B), [], 'B sees none of A\'s runs');
  const forB = await loadApprovals(w.rt, w.deps, B);
  assert.ok(forB.found && forB.state === 'ready');
  if (forB.found && forB.state === 'ready') { assert.deepEqual(forB.data.approvals, []); assert.deepEqual(forB.data.activity, []); }
  const forA = await loadApprovals(w.rt, w.deps, A);
  assert.ok(forA.found && forA.state === 'ready');
  if (forA.found && forA.state === 'ready') assert.deepEqual(forA.data.approvals.map((a) => a.description), ['Post for A']);
  // A different workspace gets nothing from this workspace.
  const other: ApprovalsDeps = { ...w.deps, workspaceId: 'other-workspace' };
  assert.deepEqual(await w.runs(A, other), []);
  assert.deepEqual(await w.sa.automation.approvals(w.ctx('x', A, 'other-workspace')), []);
  // B cannot decide A's approval.
  if (ask.outcome === 'needs_approval') await assert.rejects(w.sa.automation.decide(w.ctx('x', B), ask.approvalId, 'approve'));
  // An unknown business is not found before the service is touched.
  assert.deepEqual(await loadOperator(w.rt, w.deps, 'nope'), { found: false });
  // Two runtimes share nothing.
  const second = createStartAutomation();
  assert.deepEqual((await second.automation.activity(w.ctx('x', A))).entries, []);
});

test('AMP-140 the Approvals loader and action read the same service: a pending approval shows, and deciding it changes that service', async () => {
  const w = world();
  const ask = await w.sa.automation.start(w.ctx('post-1'), { kind: 'scheduled-post', input: { post: 'hello' }, description: 'Post a hello' });
  assert.equal(ask.outcome, 'needs_approval');
  if (ask.outcome !== 'needs_approval') return;
  const before = await loadApprovals(w.rt, w.deps, A);
  assert.ok(before.found && before.state === 'ready');
  if (before.found && before.state === 'ready') assert.deepEqual(before.data.approvals.filter((a) => a.status === 'pending').map((a) => a.id), [ask.approvalId]);
  assert.deepEqual(await w.runs(A), [], 'nothing runs until it is approved');

  const reply = await runApprovalsOp({ availability: ON, rt: () => w.rt, deps: w.deps }, A, { kind: 'decide', approvalId: ask.approvalId, decision: 'approve', confirmed: true });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const stored = await w.sa.automation.approvals(automationContext(w.deps, A));
  assert.equal(stored.find((a) => a.id === ask.approvalId)?.status, 'approved');
  assert.equal((await w.runs(A)).length, 1, 'the approved request is now a run on the Operator page');
});

test('AMP-140 wiring: the runtime carries the service and the source returns it (not the separate demo)', () => {
  const runtime = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /\n {2}automation: StartAutomation;/);
  assert.match(runtime, /const automation = createStartAutomation\(\);/);
  assert.match(runtime, /\n {4}automation,\n {2}\};/);
  assert.doesNotMatch(runtime, /automationDemo/, 'the old alias is gone');
  const source = readFileSync(new URL('../app/app/[business]/approvals/_server/source.ts', import.meta.url), 'utf8');
  assert.match(source, /return \(\) => runtime\(\)\.automation\.automation;/);
  assert.doesNotMatch(source, /automationDemo/);
  assert.doesNotMatch(source, /demoAutomation\(\)/);
  const mod = readFileSync(new URL('../app/start/_server/automation-runtime.ts', import.meta.url), 'utf8');
  assert.match(mod, /createProviderRegistry\(\{ env: \{\} \}\)/, 'real provider keys are never read');
});

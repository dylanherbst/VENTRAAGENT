// Operator runs (screen 34, AMP-128; G04, G05, I06). The page's real loader, guard and action function run against the REAL
// automation service on its in-memory store and the real in-memory job engine with fixture providers (`createDemoAutomation`).
// `actions.ts` itself is a one-line wrapper around `runOperatorOp` with the server's constants and imports Next-only modules, so it
// is not loaded here. What this does not prove: the Next page itself and the browser layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BAD_REQUEST, FAILED, NO_BUSINESS, NO_RUN, NOT_FAILED, RETRIED, guardOperatorOp, readOp, runOperatorOp,
} from '../app/app/[business]/operator/_server/operator-guard.ts';
import type { OperatorGuardInput } from '../app/app/[business]/operator/_server/operator-guard.ts';
import { loadOperator, operatorContext } from '../app/app/[business]/operator/_server/operator.ts';
import type { OperatorDeps } from '../app/app/[business]/operator/_server/operator.ts';
import {
  DEMO_TEXT, NO_RUNS, NO_RUNS_TEXT, NOT_IN_DEMO, NOT_IN_DEMO_TEXT, RUN_LIMIT, STATUS_WORDS, UNKNOWN_STATUS_WORDS, buildOperator, headingOutline, operatorHref, runsOf,
} from '../app/app/[business]/operator/view-model.ts';
import { createDemoAutomation } from '../lib/aimp/automation/demo.ts';
import type { ActivityEntry } from '../lib/aimp/automation/types.ts';

const WS = 'demo-workspace';
const OTHER_WS = 'other-workspace';
const OWNER = 'demo-owner';
const A = 'biz-a';
const B = 'biz-b';
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };

function world(known: string[] = [A, B]) {
  const d = createDemoAutomation({});
  const rt = { businesses: new Set<string>(known), seeds: new Map<string, unknown>(), slugs: new Map<string, string>(), productIds: new Map<string, string[]>() };
  let serviceCalls = 0;
  const deps: OperatorDeps = { automation: () => { serviceCalls += 1; return d.automation; }, workspaceId: WS, actorUserId: OWNER };
  const input = (over: Partial<OperatorGuardInput> = {}): OperatorGuardInput => ({ availability: ON, rt: () => rt, deps, ...over });
  const ctx = (key: string, businessId = A, workspaceId = WS) => ({ workspaceId, businessId, actorUserId: OWNER, idempotencyKey: key });
  const jobs = async (businessId = A, workspaceId = WS) => (await d.jobs.service.list(ctx('x', businessId, workspaceId))).filter((j) => j.businessId === businessId && j.workspaceId === workspaceId);
  /** Starts a real site-publishing job for a business and runs the queue. With `fail`, its publish step is refused once. */
  const publish = async (key: string, opts: { fail?: boolean; businessId?: string; workspaceId?: string } = {}) => {
    const businessId = opts.businessId ?? A;
    const workspaceId = opts.workspaceId ?? WS;
    if (opts.fail) d.jobs.faults.add({ kind: 'publish-site', step: 'publish', times: 1, type: 'permanent', when: 'before', message: 'Provider refused.' });
    await d.automation.setMode(ctx('m', businessId, workspaceId), 'publishing', 'automatic');
    const r = await d.automation.start(ctx(key, businessId, workspaceId), { kind: 'publish-site' });
    assert.equal(r.outcome, 'started');
    if (r.outcome !== 'started') throw new Error('unreachable');
    await d.jobs.runner.drain();
    const job = (await jobs(businessId, workspaceId)).find((j) => j.id === r.jobId);
    assert.equal(job?.status, opts.fail ? 'failed' : 'succeeded');
    return r.jobId;
  };
  const page = async (businessId = A) => {
    const r = await loadOperator(rt, deps, businessId);
    assert.ok(r.found && r.state === 'ready');
    if (!(r.found && r.state === 'ready')) throw new Error('unreachable');
    return buildOperator(businessId, null, r.data);
  };
  const act = (raw: unknown, businessId: unknown = A) => runOperatorOp(input(), businessId, raw);
  const published = () => d.jobs.effects.executed().filter((e) => e.label === 'site.publish').length;
  const retryEvents = async (businessId = A) => (await d.automation.activity(ctx('x', businessId), { limit: 500 })).entries.filter((e) => /^You chose Retry/.test(e.title)).length;
  return { d, rt, deps, input, ctx, jobs, publish, page, act, published, retryEvents, serviceCalls: () => serviceCalls };
}

test('AMP-128 listing: no runs is an honest empty state, and reading the page starts nothing', async () => {
  const w = world();
  const vm = await w.page();
  assert.deepEqual(vm.runs, []);
  assert.equal(vm.failedShown, 0);
  assert.equal(vm.failedText, null);
  assert.equal(vm.runsHidden, false);
  assert.equal(NO_RUNS, 'No runs yet');
  assert.doesNotMatch(NO_RUNS_TEXT, /\d/, 'words, never a number that looks real');
  assert.deepEqual(await w.jobs(), []);
  // Settings changes and approvals are activity, not runs.
  await w.d.automation.setMode(w.ctx('m'), 'marketing', 'paused');
  await w.d.automation.start(w.ctx('k1'), { kind: 'publish-site', description: 'Publish version 2' });
  assert.deepEqual((await w.page()).runs, []);
  assert.deepEqual(await w.jobs(), []);
});

test('AMP-128 listing: recent runs newest first, each with a plain status; only a failed run can be retried', async () => {
  const w = world();
  const done = await w.publish('ok-1');
  w.d.jobs.clock.advance(60_000);
  const failed = await w.publish('bad-1', { fail: true });
  w.d.jobs.clock.advance(60_000);
  w.d.jobs.faults.add({ kind: 'generate-product', step: 'draft-spec', times: 1, type: 'temporary', when: 'before' });
  const started = await w.d.automation.start(w.ctx('g1'), { kind: 'generate-product' });
  assert.equal(started.outcome, 'started');
  await w.d.jobs.runner.runDue();

  const vm = await w.page();
  assert.deepEqual(vm.runs.map((r) => [r.title, r.status, r.statusLabel, r.canRetry]), [
    ['Product generation', 'waiting-retry', 'Retrying', false],
    ['Site publishing', 'failed', 'Failed', true],
    ['Site publishing', 'succeeded', 'Complete', false],
  ]);
  assert.deepEqual(vm.runs.map((r) => r.id).slice(1), [failed, done]);
  for (const r of vm.runs) {
    assert.equal(r.words, STATUS_WORDS[r.status]);
    assert.match(r.whenLabel, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  }
  const [retrying, stopped, finished] = vm.runs;
  assert.match(retrying.words, /will try again by itself/);
  assert.match(retrying.nextTryLabel ?? '', /UTC$/);
  assert.equal(retrying.tone, 'warn');
  assert.match(stopped.words, /stopped and will not try again by itself/);
  assert.equal(stopped.detail, 'What went wrong: Provider refused.');
  assert.equal(stopped.tone, 'danger');
  assert.equal(stopped.areaLabel, 'Publishing');
  assert.equal(stopped.nextTryLabel, null);
  assert.equal(finished.words, 'Finished.');
  assert.equal(finished.detail, null, 'a detail that only repeats the status is not shown twice');
  assert.equal(vm.failedShown, 1);
  assert.equal(vm.failedText, 'One run stopped and needs you.');
  // The request key, the input and the engine's internals never reach the page.
  assert.doesNotMatch(JSON.stringify(vm), /bad-1|ok-1|idempotency|leaseOwner|demo-runner|"input"/);
});

test('AMP-128 listing: bounded, and a status the page does not know is said to be unknown', () => {
  const row = (i: number, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: `job:j${i}`, at: 1_000 + i, source: 'job', status: 'succeeded', label: 'Complete', title: 'Site publishing', detail: 'Finished.', area: 'publishing',
    needsOwner: false, nextAction: null, nextRetryAt: null, approvalId: null, jobId: `j${i}`, ...over,
  });
  const entries = Array.from({ length: RUN_LIMIT + 3 }, (_, i) => row(i));
  const vm = buildOperator(A, 'Leaf and Loom', { entries });
  assert.equal(vm.runs.length, RUN_LIMIT);
  assert.equal(vm.runsHidden, true);
  assert.equal(vm.runs[0].id, `j${RUN_LIMIT + 2}`, 'newest first');
  assert.equal(vm.businessName, 'Leaf and Loom');
  // Rows that are not a job run (no job id, or another source) are never drawn as runs.
  assert.deepEqual(runsOf([row(1, { jobId: null }), row(2, { jobId: '' }), row(3, { source: 'setting' }), row(4)]).map((e) => e.jobId), ['j4']);
  const odd = buildOperator(A, null, { entries: [row(1, { status: 'constructor' as ActivityEntry['status'], label: 'Odd' }), row(2, { status: 'failed', label: 'Failed', detail: 'It stopped.' })] });
  assert.equal(odd.runs[1].words, UNKNOWN_STATUS_WORDS);
  assert.equal(odd.runs[1].canRetry, false);
  assert.equal(odd.runs[1].tone, 'neutral');
  assert.equal(odd.runs[0].canRetry, true);
  assert.equal(odd.runs[0].detail, null);
});

test('AMP-128 retry: goes through retryJob once; a repeated click never retries twice and never publishes twice', async () => {
  const w = world();
  const id = await w.publish('bad-1', { fail: true });
  assert.equal(w.published(), 0);
  const op = { kind: 'retry', runId: id };

  assert.deepEqual(await w.act(op), { ok: true, message: RETRIED });
  assert.equal((await w.jobs())[0].status, 'queued', 'handed back to the queue; this page does not run it');
  assert.equal(await w.retryEvents(), 1);
  const queued = (await w.page()).runs.find((r) => r.id === id);
  assert.equal(queued?.statusLabel, 'Queued');
  assert.equal(queued?.canRetry, false, 'no Retry button once it is no longer failed');

  assert.deepEqual(await w.act(op), { ok: false, message: NOT_FAILED });
  for (const r of await Promise.all([w.act(op), w.act(op)])) assert.deepEqual(r, { ok: false, message: NOT_FAILED });
  assert.equal(await w.retryEvents(), 1, 'still one retry');
  assert.equal((await w.jobs()).length, 1, 'retry made no second job');

  await w.d.jobs.runner.drain();
  assert.equal((await w.jobs())[0].status, 'succeeded');
  assert.equal(w.published(), 1, 'published exactly once');
  assert.deepEqual(await w.act(op), { ok: false, message: NOT_FAILED }, 'a finished run is not retried');
  await w.d.jobs.runner.drain();
  assert.equal(w.published(), 1);
  assert.equal(await w.retryEvents(), 1);
  assert.match(RETRIED, /has not run again yet/);
  assert.doesNotMatch(RETRIED, /fixed|done|finished\.$/i);
});

test('AMP-128 retry: simultaneous first clicks retry once', async () => {
  const w = world();
  const id = await w.publish('bad-1', { fail: true });
  const op = { kind: 'retry', runId: id };
  const rs = await Promise.all([w.act(op), w.act(op), w.act(op)]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  for (const r of rs.filter((x) => !x.ok)) assert.equal(r.message, NOT_FAILED);
  assert.equal(await w.retryEvents(), 1);
  await w.d.jobs.runner.drain();
  assert.equal(w.published(), 1);
  assert.equal((await w.jobs()).length, 1);
});

test('AMP-128 retry: a run that is not failed is refused and left alone', async () => {
  const w = world();
  const done = await w.publish('ok-1');
  assert.deepEqual(await w.act({ kind: 'retry', runId: done }), { ok: false, message: NOT_FAILED });
  assert.equal((await w.jobs())[0].status, 'succeeded');
  assert.equal(w.published(), 1);
  assert.equal(await w.retryEvents(), 0);
});

test('AMP-128 another business: its runs are never listed here and can not be retried from here', async () => {
  const w = world();
  const mine = await w.publish('bad-1', { fail: true });
  const theirs = await w.publish('bad-1', { fail: true, businessId: B });
  assert.deepEqual((await w.page(A)).runs.map((r) => r.id), [mine]);
  assert.deepEqual((await w.page(B)).runs.map((r) => r.id), [theirs]);
  assert.deepEqual(await w.act({ kind: 'retry', runId: theirs }, A), { ok: false, message: NO_RUN });
  // A business or workspace smuggled into the body is ignored: the route's business is the only one used.
  assert.deepEqual(await w.act({ kind: 'retry', runId: theirs, businessId: B, workspaceId: WS }, A), { ok: false, message: NO_RUN });
  assert.equal((await w.jobs(B))[0].status, 'failed', 'still failed for its owner');
  assert.equal(await w.retryEvents(B), 0);
  assert.equal(await w.retryEvents(A), 0);
  assert.deepEqual(await w.act({ kind: 'retry', runId: theirs }, B), { ok: true, message: RETRIED });
  assert.equal((await w.jobs(B))[0].status, 'queued');
  assert.equal((await w.jobs(A))[0].status, 'failed', 'the other business is untouched');
});

test('AMP-128 another workspace: same business id elsewhere is invisible, and a business unknown here is refused before any read', async () => {
  const w = world([A]);
  const foreign = await w.publish('bad-1', { fail: true, workspaceId: OTHER_WS });
  assert.deepEqual((await w.page(A)).runs, []);
  assert.deepEqual(await w.act({ kind: 'retry', runId: foreign }), { ok: false, message: NO_RUN });
  assert.deepEqual(await w.act({ kind: 'retry', runId: foreign, workspaceId: OTHER_WS }), { ok: false, message: NO_RUN });
  assert.equal((await w.jobs(A, OTHER_WS))[0].status, 'failed');
  assert.equal(operatorContext(w.deps, A).workspaceId, WS);

  // biz-b was never set up in this runtime (which is how another workspace's business looks here).
  const before = w.serviceCalls();
  assert.deepEqual(await loadOperator(w.rt, w.deps, B), { found: false });
  assert.deepEqual(await w.act({ kind: 'retry', runId: foreign }, B), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(await w.act({ kind: 'retry', runId: foreign }, 'someone-elses-business'), { ok: false, message: NO_BUSINESS });
  assert.equal(w.serviceCalls(), before, 'the automation service was not touched');
});

test('AMP-128 guard: demo storage off, bad ids, prototype keys, unknown runs and unknown requests are refused', async () => {
  const w = world();
  const id = await w.publish('bad-1', { fail: true });
  const retry = { kind: 'retry', runId: id };
  let rtReads = 0;
  const off = await runOperatorOp(w.input({ availability: OFF, rt: () => { rtReads += 1; return w.rt; } }), A, retry);
  assert.deepEqual(off, { ok: false, message: OFF.reason });
  assert.equal(rtReads, 0, 'nothing is read while demo storage is off');

  for (const bad of ['__proto__', 'constructor', 'prototype', '', '../biz-a', 'biz a', 'x'.repeat(300), null, undefined, 7, {}, ['biz-a']]) {
    assert.deepEqual(await runOperatorOp(w.input(), bad, retry), { ok: false, message: NO_BUSINESS }, String(bad));
  }
  // Even if a prototype key were somehow a known business, it is refused.
  w.rt.businesses.add('constructor');
  assert.deepEqual(await w.act(retry, 'constructor'), { ok: false, message: NO_BUSINESS });

  const before = w.serviceCalls();
  for (const runId of ['__proto__', 'constructor', 'prototype', '', ' ', 'a'.repeat(101), '<script>', `${id} `, null, undefined, 5, { id }, [id]]) {
    assert.deepEqual(await w.act({ kind: 'retry', runId }), { ok: false, message: NO_RUN }, String(runId));
  }
  for (const raw of [null, undefined, 'retry', 7, [], {}, { runId: id }, { kind: 'cancel', runId: id }, { kind: '__proto__', runId: id }, { kind: ['retry'], runId: id }, JSON.parse(`{"__proto__":{"kind":"retry","runId":"${id}"}}`)]) {
    assert.deepEqual(await w.act(raw), { ok: false, message: BAD_REQUEST }, JSON.stringify(raw));
  }
  assert.equal(w.serviceCalls(), before, 'a request with a bad shape never reaches the automation service');
  assert.deepEqual(await w.act({ kind: 'retry', runId: 'no-such-run' }), { ok: false, message: NO_RUN });
  assert.equal((await w.jobs())[0].status, 'failed', 'no refusal retried anything');
  assert.equal(await w.retryEvents(), 0);
  assert.deepEqual(readOp(retry), retry);
  assert.equal(guardOperatorOp(w.input(), A, retry).ok, true);
});

test('AMP-128 service errors come back as plain words and never claim a retry', async () => {
  const w = world();
  const id = await w.publish('bad-1', { fail: true });
  const broken: OperatorDeps = { ...w.deps, automation: () => ({ ...w.d.automation, retryJob: async () => { throw new Error('socket hang up at /Users/me/secret.ts'); } }) };
  const r = await runOperatorOp(w.input({ deps: broken }), A, { kind: 'retry', runId: id });
  assert.deepEqual(r, { ok: false, message: FAILED });
  assert.match(FAILED, /we do not know if that went through/);
  // A service that answers about a different run is not reported as a success.
  const wrong: OperatorDeps = { ...w.deps, automation: () => ({ ...w.d.automation, retryJob: async () => ({ jobId: 'another-run', jobStatus: 'queued' as const, message: '' }) }) };
  assert.deepEqual(await runOperatorOp(w.input({ deps: wrong }), A, { kind: 'retry', runId: id }), { ok: false, message: FAILED });
  assert.equal((await w.jobs())[0].status, 'failed');
});

test('AMP-128 no automation store: the page says "not available in the demo yet" and retry is refused', async () => {
  const w = world();
  const deps: OperatorDeps = { automation: null, workspaceId: WS, actorUserId: OWNER };
  assert.deepEqual(await loadOperator(w.rt, deps, A), { found: true, state: 'unavailable' });
  assert.deepEqual(await loadOperator(w.rt, deps, 'unknown-biz'), { found: false });
  assert.deepEqual(await runOperatorOp(w.input({ deps }), A, { kind: 'retry', runId: 'abc' }), { ok: false, message: NOT_IN_DEMO_TEXT });
  assert.equal(NOT_IN_DEMO, 'Not available in the demo yet');
  assert.match(NOT_IN_DEMO_TEXT, /not available in the demo yet/);
  assert.match(NOT_IN_DEMO_TEXT, /nothing was changed/);
  assert.doesNotMatch(NOT_IN_DEMO_TEXT, /\d/, 'words, never a number that looks real');
  const page = readFileSync(new URL('../app/app/[business]/operator/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /data-testid="operator-unavailable"/);
});

test('AMP-128 structure: same gates as the sibling pages, one h1, glass library, 44px targets, honest copy', async () => {
  const w = world();
  await w.publish('bad-1', { fail: true });
  const vm = await w.page();
  const outline = headingOutline(vm);
  assert.equal(outline.filter((h) => h.level === 1).length, 1);
  assert.deepEqual(outline.filter((h) => h.level === 2).map((h) => h.text), ['Recent runs']);
  assert.equal(operatorHref(A), '/app/biz-a/operator');
  assert.equal(vm.overviewHref, '/app/biz-a');
  assert.equal(vm.approvalsHref, '/app/biz-a/approvals');
  assert.equal(vm.demoText, DEMO_TEXT);
  assert.match(DEMO_TEXT, /lost when the server restarts/);
  assert.match(DEMO_TEXT, /this page does not run the queue/);

  const read = (f: string) => readFileSync(new URL(`../app/app/[business]/operator/${f}`, import.meta.url), 'utf8');
  const page = read('page.tsx');
  assert.match(page, /availability\(\)/);
  assert.match(page, /if \(!checkBusiness\(business\)\) return <UnknownBusiness \/>/);
  assert.match(page, /if \(!found\.found\) return <UnknownBusiness \/>/);
  assert.match(page, /dynamic = 'force-dynamic'/);
  assert.ok(page.indexOf('availability()') < page.indexOf('checkBusiness(business)') && page.indexOf('checkBusiness(business)') < page.indexOf('loadOperator('));
  const actions = read('actions.ts');
  assert.match(actions, /^'use server';/);
  assert.match(actions, /runOperatorOp\(\{ availability: availability\(\), rt: runtime, deps: \{ automation: automationSource\(\), workspaceId: WORKSPACE, actorUserId: OWNER \} \}, businessId, rawOp\)/);
  const guard = read('_server/operator-guard.ts');
  assert.equal(guard.match(/\.retryJob\(/g)?.length, 1, 'one call to the service, and it is retryJob');
  assert.match(guard, /automation\.retryJob\(ctx, op\.runId\)/);
  const view = read('operator-view.tsx');
  assert.match(view, /from '..\/..\/..\/design-system\/aimp-glass'/);
  assert.equal(view.match(/<h1/g), null, 'the one h1 comes from AppIntro');
  assert.equal(view.match(/<AppIntro/g)?.length, 1);
  assert.match(view, /if \(busyRef\.current\) return;/);
  assert.match(view, /operatorAction\(vm\.businessId, \{ kind: 'retry', runId \}\)/);
  assert.match(view, /\{r\.canRetry \? \(/, 'Retry is drawn only for a failed run');
  assert.match(view, /aria-live="polite"/);
  const css = read('operator.css');
  assert.match(css, /\.aop-link \{[^}]*min-block-size: 44px/);
  assert.match(css, /\.aop-actions > \* \{[^}]*min-block-size: 44px/);
  assert.match(css, /\.aop-list \{[^}]*list-style: none; padding: 0; margin: 0/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /(?<![-\w])width:\s*\d{3,}px|min-width:\s*\d{3,}px/, 'no fixed width that could force sideways scrolling');
  const claims = /guarantee|passive income|you will earn|profit|was (posted|sent|published|fixed)|has been (posted|sent|published|fixed)|is fixed/i;
  for (const [name, text] of [['vm', JSON.stringify(vm)], ['view', view], ['page', page], ['view-model', read('view-model.ts')], ['guard', guard]]) {
    assert.equal(claims.exec(text)?.[0] ?? null, null, `${name} makes no claim`);
  }
});

// Approvals and activity (screen 35, AMP-127; G02, G03, I06). The page's real loader, guard and action function run against the REAL
// automation service on its in-memory store and the real in-memory job engine with fixture providers (`createDemoAutomation`).
// `actions.ts` itself is a one-line wrapper around `runApprovalsOp` with the server's constants and imports Next-only modules, so it
// is not loaded here. What this does not prove: the Next page itself and the browser layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APPROVED, BAD_CAP, BAD_MODE, BAD_REQUEST, NO_APPROVAL, NO_BUSINESS, NOT_CONFIRMED, REJECTED, guardApprovalsOp, readCap, runApprovalsOp,
} from '../app/app/[business]/approvals/_server/approvals-guard.ts';
import type { ApprovalsGuardInput } from '../app/app/[business]/approvals/_server/approvals-guard.ts';
import { automationContext, loadApprovals } from '../app/app/[business]/approvals/_server/approvals.ts';
import type { ApprovalsDeps } from '../app/app/[business]/approvals/_server/approvals.ts';
import {
  ACTIVITY_LIMIT, NOTHING_PENDING, NOT_IN_DEMO, NOT_IN_DEMO_TEXT, approvalsHref, buildApprovals, headingOutline, whenLabel,
} from '../app/app/[business]/approvals/view-model.ts';
import { createDemoAutomation } from '../lib/aimp/automation/demo.ts';
import { MAX_CAP } from '../lib/aimp/automation/types.ts';

const WS = 'demo-workspace';
const OWNER = 'demo-owner';
const A = 'biz-a';
const B = 'biz-b';
const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'This step runs on demo storage, which is switched off on this site. Nothing was saved.' };

function world(known: string[] = [A, B]) {
  const d = createDemoAutomation({});
  const rt = { businesses: new Set<string>(known), seeds: new Map<string, unknown>(), slugs: new Map<string, string>(), productIds: new Map<string, string[]>() };
  let serviceCalls = 0;
  const deps: ApprovalsDeps = { automation: () => { serviceCalls += 1; return d.automation; }, workspaceId: WS, actorUserId: OWNER };
  const input = (over: Partial<ApprovalsGuardInput> = {}): ApprovalsGuardInput => ({ availability: ON, rt: () => rt, deps, ...over });
  const ctx = (key: string, businessId = A, workspaceId = WS) => ({ workspaceId, businessId, actorUserId: OWNER, idempotencyKey: key });
  /** Asks for a scheduled post (marketing is "Ask me first" by default), which records a pending approval and starts nothing. */
  const ask = async (key: string, description: string, businessId = A, workspaceId = WS) => {
    const r = await d.automation.start(ctx(key, businessId, workspaceId), { kind: 'scheduled-post', input: { post: key }, description });
    assert.equal(r.outcome, 'needs_approval');
    if (r.outcome !== 'needs_approval') throw new Error('unreachable');
    return r.approvalId;
  };
  const jobs = async (businessId = A, workspaceId = WS) => (await d.jobs.service.list(ctx('x', businessId, workspaceId))).filter((j) => j.businessId === businessId && j.workspaceId === workspaceId);
  const page = async (businessId = A) => {
    const r = await loadApprovals(rt, deps, businessId);
    assert.ok(r.found && r.state === 'ready');
    if (!(r.found && r.state === 'ready')) throw new Error('unreachable');
    return buildApprovals(businessId, null, r.data);
  };
  const act = (raw: unknown, businessId: unknown = A) => runApprovalsOp(input(), businessId, raw);
  return { d, rt, deps, input, ask, jobs, page, act, serviceCalls: () => serviceCalls };
}

test('AMP-127 listing: pending approvals in plain words, usage against the cap, modes, and an honest empty state', async () => {
  const w = world();
  const empty = await w.page();
  assert.deepEqual(empty.pending, []);
  assert.equal(empty.pendingTitle, 'Waiting for you');
  assert.deepEqual(empty.activity, []);
  assert.equal(empty.usage.words, '0 of 3 AI generations used this period');
  assert.deepEqual(empty.modes.map((m) => [m.label, m.modeLabel]), [['Marketing', 'Ask me first'], ['Product generation', 'Automatic'], ['Publishing', 'Ask me first']]);

  const id = await w.ask('k1', 'Post the spring planner to the newsletter');
  const vm = await w.page();
  assert.equal(vm.pendingTitle, 'Waiting for you (1)');
  assert.equal(vm.pending.length, 1);
  assert.equal(vm.pending[0].id, id);
  assert.equal(vm.pending[0].title, 'Post the spring planner to the newsletter');
  assert.equal(vm.pending[0].areaLabel, 'Marketing');
  assert.equal(vm.pending[0].kindLabel, 'Scheduled post');
  assert.match(vm.pending[0].expiresLabel, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  assert.match(vm.pending[0].effect, /Nothing has started yet/);
  assert.deepEqual(await w.jobs(), [], 'listing starts nothing');
  // The stored input, request key and hash never reach the page.
  assert.doesNotMatch(JSON.stringify(vm), /requestKey|requestHash|"input"|k1/);
});

test('AMP-127 approve: runs the job once; a repeated click or a replayed request never runs it twice', async () => {
  const w = world();
  const id = await w.ask('k1', 'Post one');
  const op = { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true };
  assert.deepEqual(await w.act({ ...op, confirmed: false }), { ok: false, message: NOT_CONFIRMED });
  assert.deepEqual(await w.act({ kind: 'decide', approvalId: id, decision: 'approve' }), { ok: false, message: NOT_CONFIRMED });
  assert.equal((await w.jobs()).length, 0, 'an unconfirmed approve starts nothing');

  assert.deepEqual(await w.act(op), { ok: true, message: APPROVED });
  assert.equal((await w.jobs()).length, 1);
  const again = await w.act(op);
  assert.equal(again.ok, true);
  assert.match(again.message, /already approved\. Nothing was run again/);
  const both = await Promise.all([w.act(op), w.act(op)]);
  for (const r of both) assert.match(r.message, /Nothing was run again/);
  assert.equal((await w.jobs()).length, 1, 'still one job');
  // The opposite decision afterwards is refused and changes nothing.
  const flip = await w.act({ ...op, decision: 'reject' });
  assert.equal(flip.ok, false);
  assert.match(flip.message, /already approved/);
  const vm = await w.page();
  assert.deepEqual(vm.pending, []);
  assert.deepEqual(vm.decided.map((x) => [x.id, x.statusLabel]), [[id, 'Approved']]);
  assert.equal((await w.jobs()).length, 1);
});

test('AMP-127 approve: two simultaneous first clicks start one job', async () => {
  const w = world();
  const id = await w.ask('k1', 'Post one');
  const op = { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true };
  const rs = await Promise.all([w.act(op), w.act(op), w.act(op)]);
  assert.equal(rs.filter((r) => r.message === APPROVED).length, 1);
  assert.equal((await w.jobs()).length, 1);
});

test('AMP-127 reject: never runs, repeat is harmless, and approving afterwards is refused', async () => {
  const w = world();
  const id = await w.ask('k1', 'Post one');
  const op = { kind: 'decide', approvalId: id, decision: 'reject', confirmed: true };
  assert.deepEqual(await w.act(op), { ok: true, message: REJECTED });
  const again = await w.act(op);
  assert.equal(again.ok, true);
  assert.match(again.message, /already rejected/);
  const flip = await w.act({ ...op, decision: 'approve' });
  assert.equal(flip.ok, false);
  assert.match(flip.message, /already rejected/);
  assert.deepEqual(await w.jobs(), []);
  const vm = await w.page();
  assert.deepEqual(vm.decided.map((x) => x.statusLabel), ['Rejected']);
  assert.equal(vm.activity[0].title, 'You rejected: Post one');
  assert.equal(vm.activity[0].statusLabel, 'Cancelled');
});

test('AMP-127 approve is refused while the area is paused, and an expired request can not be approved', async () => {
  const w = world();
  const id = await w.ask('k1', 'Post one');
  assert.deepEqual(await w.act({ kind: 'mode', area: 'marketing', mode: 'paused' }), { ok: true, message: 'Setting saved.' });
  const blocked = await w.act({ kind: 'decide', approvalId: id, decision: 'approve', confirmed: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /Marketing is paused/);
  assert.deepEqual(await w.jobs(), []);
  assert.equal((await w.page()).pending.length, 1, 'still waiting');

  await w.act({ kind: 'mode', area: 'marketing', mode: 'owner_approval' });
  w.d.jobs.clock.advance(25 * 60 * 60_000);
  const late = await w.act({ kind: 'decide', approvalId: id, decision: 'approve', confirmed: true });
  assert.equal(late.ok, false);
  assert.match(late.message, /expired/);
  assert.deepEqual(await w.jobs(), []);
  const vm = await w.page();
  assert.deepEqual(vm.pending, []);
  assert.deepEqual(vm.decided.map((x) => x.statusLabel), ['Expired']);
});

test('AMP-127 mode: goes through setMode, and anything that is not a real area and mode is refused', async () => {
  const w = world();
  assert.deepEqual(await w.act({ kind: 'mode', area: 'publishing', mode: 'automatic' }), { ok: true, message: 'Setting saved.' });
  assert.equal((await w.d.automation.getSettings(automationContext(w.deps, A))).modes.publishing, 'automatic');
  assert.equal((await w.d.automation.getSettings(automationContext(w.deps, B))).modes.publishing, 'owner_approval', 'the other business is untouched');
  const bad: unknown[] = [
    { kind: 'mode', area: 'publishing', mode: 'always' }, { kind: 'mode', area: 'publishing', mode: '' }, { kind: 'mode', area: 'publishing' },
    { kind: 'mode', area: 'publishing', mode: '__proto__' }, { kind: 'mode', area: '__proto__', mode: 'paused' }, { kind: 'mode', area: 'constructor', mode: 'paused' },
    { kind: 'mode', area: 'delivery', mode: 'paused' }, { kind: 'mode', area: ['publishing'], mode: 'paused' }, { kind: 'mode', area: 'publishing', mode: 1 },
  ];
  for (const op of bad) assert.deepEqual(await w.act(op), { ok: false, message: BAD_MODE }, JSON.stringify(op));
  const vm = await w.page();
  assert.equal(vm.modes.find((m) => m.area === 'publishing')?.modeLabel, 'Automatic');
  assert.equal(vm.activity.length, 1, 'one real change, one activity row');
  assert.match(vm.activity[0].title, /Publishing changed from "owner_approval" to "automatic"/);
});

test('AMP-127 cap: goes through setCap, and a negative, fractional, huge or non-number value is refused in plain words', async () => {
  const w = world();
  assert.deepEqual(await w.act({ kind: 'cap', limit: 7 }), { ok: true, message: 'The allowance is now 7 AI generations per period.' });
  assert.equal((await w.page()).usage.words, '0 of 7 AI generations used this period');
  assert.equal((await w.act({ kind: 'cap', limit: ' 12 ' })).ok, true, 'plain digits typed into the box');
  assert.equal((await w.act({ kind: 'cap', limit: MAX_CAP })).ok, true);
  assert.equal((await w.act({ kind: 'cap', limit: 0 })).ok, true);
  const zero = await w.page();
  assert.equal(zero.usage.reached, true);
  assert.match(zero.usage.note, /used up/);
  const bad: unknown[] = [-1, 1.5, MAX_CAP + 1, 1e21, Number.NaN, Number.POSITIVE_INFINITY, '', '-1', '1.5', '1e3', '0x10', 'ten', '99999999', null, undefined, true, [5], { valueOf: () => 5 }];
  for (const limit of bad) {
    assert.equal(readCap(limit), null, String(limit));
    assert.deepEqual(await w.act({ kind: 'cap', limit }), { ok: false, message: BAD_CAP }, String(limit));
  }
  assert.match(BAD_CAP, /whole number from 0 to 100000/);
  assert.equal((await w.d.automation.usage(automationContext(w.deps, A))).limit, 0, 'refused values changed nothing');
  assert.equal((await w.d.automation.usage(automationContext(w.deps, B))).limit, 3);
});

test('AMP-127 activity: newest first, bounded, with plain statuses', async () => {
  const w = world();
  for (let i = 0; i < ACTIVITY_LIMIT + 5; i += 1) {
    w.d.jobs.clock.advance(60_000);
    await w.act({ kind: 'cap', limit: i + 10 });
  }
  const vm = await w.page();
  assert.equal(vm.activity.length, ACTIVITY_LIMIT);
  assert.equal(vm.activityHidden, true);
  assert.match(vm.activity[0].title, new RegExp(`allowance is now ${ACTIVITY_LIMIT + 14} per period`));
  const times = vm.activity.map((e) => e.whenIso);
  assert.deepEqual(times, [...times].sort().reverse());
  for (const e of vm.activity) assert.match(e.statusLabel, /^(Complete|Paused|Cancelled|Needs you|Queued|Building|Retrying|Failed)$/);
  assert.equal(whenLabel(Date.UTC(2026, 10, 15, 9, 5)), '2026-11-15 09:05 UTC');
  assert.equal(whenLabel(Number.NaN), 'Unknown time');
});

test('AMP-127 another business: its approvals are never listed here and can not be decided from here', async () => {
  const w = world();
  const mine = await w.ask('k1', 'Mine');
  const theirs = await w.ask('k1', 'Theirs', B);
  assert.deepEqual((await w.page(A)).pending.map((p) => p.id), [mine]);
  assert.deepEqual((await w.page(B)).pending.map((p) => p.id), [theirs]);
  for (const decision of ['approve', 'reject']) {
    assert.deepEqual(await w.act({ kind: 'decide', approvalId: theirs, decision, confirmed: true }, A), { ok: false, message: NO_APPROVAL });
  }
  // A business id smuggled into the body is ignored: the route's business is the only one used.
  assert.deepEqual(await w.act({ kind: 'decide', approvalId: theirs, decision: 'approve', confirmed: true, businessId: B, workspaceId: WS }, A), { ok: false, message: NO_APPROVAL });
  assert.deepEqual(await w.jobs(B), []);
  assert.equal((await w.page(B)).pending.length, 1, 'still pending for its owner');
  assert.deepEqual(await w.act({ kind: 'decide', approvalId: theirs, decision: 'approve', confirmed: true }, B), { ok: true, message: APPROVED });
  assert.equal((await w.jobs(B)).length, 1);
  assert.deepEqual(await w.jobs(A), []);
});

test('AMP-127 another workspace: same business id elsewhere is invisible, and a business unknown here is refused before any read', async () => {
  const w = world([A]);
  const foreign = await w.ask('k1', 'Other workspace post', A, 'other-workspace');
  assert.deepEqual((await w.page(A)).pending, []);
  assert.deepEqual(await w.act({ kind: 'decide', approvalId: foreign, decision: 'approve', confirmed: true, workspaceId: 'other-workspace' }), { ok: false, message: NO_APPROVAL });
  assert.deepEqual(await w.jobs(A, 'other-workspace'), []);
  await w.act({ kind: 'cap', limit: 9, workspaceId: 'other-workspace' });
  assert.equal((await w.d.automation.usage({ workspaceId: 'other-workspace', businessId: A, actorUserId: OWNER, idempotencyKey: 'x' })).limit, 3);

  // biz-b was never set up in this runtime (which is how another workspace's business looks here).
  const before = w.serviceCalls();
  assert.deepEqual(await loadApprovals(w.rt, w.deps, B), { found: false });
  assert.deepEqual(await w.act({ kind: 'cap', limit: 9 }, B), { ok: false, message: NO_BUSINESS });
  assert.deepEqual(await w.act({ kind: 'mode', area: 'marketing', mode: 'paused' }, 'someone-elses-business'), { ok: false, message: NO_BUSINESS });
  assert.equal(w.serviceCalls(), before, 'the automation service was not touched');
});

test('AMP-127 guard: demo storage off, bad ids, prototype keys, unknown approvals and unknown requests are refused', async () => {
  const w = world();
  const id = await w.ask('k1', 'Post one');
  const approve = { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true };
  let rtReads = 0;
  const off = await runApprovalsOp(w.input({ availability: OFF, rt: () => { rtReads += 1; return w.rt; } }), A, approve);
  assert.deepEqual(off, { ok: false, message: OFF.reason });
  assert.equal(rtReads, 0, 'nothing is read while demo storage is off');

  for (const bad of ['__proto__', 'constructor', 'prototype', '', '../biz-a', 'biz a', 'x'.repeat(300), null, undefined, 7, {}, ['biz-a']]) {
    assert.deepEqual(await runApprovalsOp(w.input(), bad, approve), { ok: false, message: NO_BUSINESS }, String(bad));
  }
  // Even if a prototype key were somehow a known business, it is refused.
  w.rt.businesses.add('constructor');
  assert.deepEqual(await w.act(approve, 'constructor'), { ok: false, message: NO_BUSINESS });

  for (const approvalId of ['__proto__', 'constructor', 'prototype', 'no-such-approval', '', ' ', 'a'.repeat(101), '<script>', null, undefined, 5, { id }, [id]]) {
    assert.deepEqual(await w.act({ ...approve, approvalId }), { ok: false, message: NO_APPROVAL }, String(approvalId));
  }
  for (const raw of [null, undefined, 'approve', 7, [], {}, { kind: 'retry' }, { kind: '__proto__' }, { ...approve, decision: 'maybe' }, { ...approve, decision: undefined }, JSON.parse('{"__proto__":{"kind":"cap","limit":5}}')]) {
    assert.deepEqual(await w.act(raw), { ok: false, message: BAD_REQUEST }, JSON.stringify(raw));
  }
  assert.deepEqual(await w.jobs(), [], 'no refusal started anything');
  assert.equal((await w.page()).pending.length, 1);
  assert.equal(guardApprovalsOp(w.input(), A, approve).ok, true);
});

test('AMP-127 no automation store: the page says "not available in the demo yet" and every action is refused', async () => {
  const w = world();
  const deps: ApprovalsDeps = { automation: null, workspaceId: WS, actorUserId: OWNER };
  assert.deepEqual(await loadApprovals(w.rt, deps, A), { found: true, state: 'unavailable' });
  assert.deepEqual(await loadApprovals(w.rt, deps, 'unknown-biz'), { found: false });
  for (const op of [{ kind: 'cap', limit: 5 }, { kind: 'mode', area: 'marketing', mode: 'paused' }, { kind: 'decide', approvalId: 'abc', decision: 'approve', confirmed: true }]) {
    assert.deepEqual(await runApprovalsOp(w.input({ deps }), A, op), { ok: false, message: NOT_IN_DEMO_TEXT });
  }
  assert.match(NOT_IN_DEMO, /^Not available in the demo yet$/);
  assert.match(NOT_IN_DEMO_TEXT, /not available in the demo yet/);
  assert.doesNotMatch(NOT_IN_DEMO_TEXT, /\d/, 'words, never a number that looks real');
  const page = readFileSync(new URL('../app/app/[business]/approvals/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /data-testid="approvals-unavailable"/);
});

test('AMP-161 onDecided runs after a successful decision (approve or reject), never after a refusal or a failure', async () => {
  const w = world();
  const seen: string[] = [];
  const input = w.input({ onDecided: (id) => { seen.push(id); } });
  const id = await w.ask('k1', 'Post one');
  const id2 = await w.ask('k2', 'Post two');
  // Refusals: not confirmed, bad shape, unknown approval, unknown business, demo storage off.
  await runApprovalsOp(input, A, { kind: 'decide', approvalId: id, decision: 'approve', confirmed: false });
  await runApprovalsOp(input, A, { kind: 'decide', approvalId: id, decision: 'maybe', confirmed: true });
  await runApprovalsOp(input, A, { kind: 'decide', approvalId: 'nope', decision: 'approve', confirmed: true });
  await runApprovalsOp(input, 'biz-unknown', { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true });
  await runApprovalsOp({ ...input, availability: OFF }, A, { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true });
  await runApprovalsOp(input, A, { kind: 'cap', limit: 5 });
  assert.deepEqual(seen, []);
  // A failing service: no hook.
  const boom = () => { throw new Error('store down'); };
  const quiet = console.error; console.error = () => {};
  try { await runApprovalsOp({ ...input, deps: { ...w.deps, automation: boom as never } }, A, { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true }); } finally { console.error = quiet; }
  assert.deepEqual(seen, []);
  // Successes: one call each, with the route's business id.
  assert.equal((await runApprovalsOp(input, A, { kind: 'decide', approvalId: id, decision: 'approve', confirmed: true })).ok, true);
  assert.deepEqual(seen, [A]);
  assert.equal((await runApprovalsOp(input, A, { kind: 'decide', approvalId: id2, decision: 'reject', confirmed: true })).ok, true);
  assert.deepEqual(seen, [A, A]);
  // A hook that throws never hides the decision.
  const id3 = await w.ask('k3', 'Post three');
  const r = await runApprovalsOp({ ...input, onDecided: () => { throw new Error('x'); } }, A, { kind: 'decide', approvalId: id3, decision: 'approve', confirmed: true });
  assert.deepEqual(r, { ok: true, message: APPROVED });
});

test('AMP-127 structure: same gates as the sibling pages, one h1, glass library, 44px targets, honest copy', async () => {
  const w = world();
  await w.ask('k1', 'Post one');
  const vm = await w.page();
  const outline = headingOutline(vm);
  assert.equal(outline.filter((h) => h.level === 1).length, 1);
  assert.deepEqual(outline.filter((h) => h.level === 2).map((h) => h.text), ['Waiting for you (1)', 'AI generation allowance', 'What needs your OK', 'Recent activity']);
  assert.equal(approvalsHref(A), '/app/biz-a/approvals');
  assert.equal(vm.overviewHref, '/app/biz-a');
  assert.equal(NOTHING_PENDING, 'Nothing is waiting for you');

  const read = (f: string) => readFileSync(new URL(`../app/app/[business]/approvals/${f}`, import.meta.url), 'utf8');
  const page = read('page.tsx');
  assert.match(page, /availability\(\)/);
  assert.match(page, /if \(!checkBusiness\(business\)\) return <UnknownBusiness \/>/);
  assert.match(page, /if \(!found\.found\) return <UnknownBusiness \/>/);
  assert.match(page, /dynamic = 'force-dynamic'/);
  assert.ok(page.indexOf('availability()') < page.indexOf('checkBusiness(business)') && page.indexOf('checkBusiness(business)') < page.indexOf('loadApprovals('));
  const actions = read('actions.ts');
  assert.match(actions, /^'use server';/);
  assert.match(actions, /runApprovalsOp\(\{\s*availability: availability\(\), rt: runtime, deps: \{ automation: automationSource\(\), workspaceId: WORKSPACE, actorUserId: OWNER \},\s*(?:\/\/[^\n]*\s*)?onDecided: \(id\) => invalidateSharedOverview\(runtime\(\), WORKSPACE, id\),\s*\}, businessId, rawOp\)/);
  const view = read('approvals-view.tsx');
  assert.match(view, /from '..\/..\/..\/design-system\/aimp-glass'/);
  assert.equal(view.match(/<h1/g), null, 'the one h1 comes from AppIntro');
  assert.equal(view.match(/<AppIntro/g)?.length, 1);
  assert.match(view, /if \(busyRef\.current\) return;/);
  assert.match(view, /confirmed: true/);
  const css = read('approvals.css');
  assert.match(css, /\.aap-link \{[^}]*min-block-size: 44px/);
  assert.match(css, /\.aap-actions > \* \{[^}]*min-block-size: 44px/);
  assert.match(css, /\.aap-list \{[^}]*list-style: none; padding: 0; margin: 0/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /(?<![-\w])width:\s*\d{3,}px|min-width:\s*\d{3,}px/, 'no fixed width that could force sideways scrolling');
  const claims = /guarantee|passive income|you will earn|profit|was (posted|sent|published)|has been (posted|sent|published)/i;
  for (const [name, text] of [['vm', JSON.stringify(vm)], ['view', view], ['view-model', read('view-model.ts')], ['guard', read('_server/approvals-guard.ts')]]) {
    assert.equal(claims.exec(text)?.[0] ?? null, null, `${name} makes no claim`);
  }
});

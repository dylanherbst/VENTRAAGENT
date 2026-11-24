// AMP-051 rework: size caps on edits, regenerate ceiling, required revision, archive on a new campaign version, the regenerate
// in-flight guard, and the export-time re-check of a tampered approved asset.
import assert from 'node:assert/strict';
import test from 'node:test';
import { approveCampaign, regenerateCampaign } from '../lib/aimp/campaigns/service.ts';
import { demoCtx } from '../lib/aimp/catalogue/demo.ts';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import {
  approveAsset, createTemplateGenerator, EDIT_CAPS, editAsset, exportCampaign, generateCampaignAssets, listArchivedAssets, listAssets,
  MAX_REGENERATIONS, regenerateAsset,
} from '../lib/aimp/campaign-assets/index.ts';
import type { AssetGenerator, AssetRecord, PinContent } from '../lib/aimp/campaign-assets/index.ts';

const ENV = { AIMP_STORE_ROOT_DOMAIN: 'stores.example.test' };
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++));

async function setup() {
  const demo = await buildAssetsDemo(clock, ENV);
  const g = await generateCampaignAssets(demo.deps, demo.scope, demo.campaignId, { actor: 'tester' });
  assert.ok(g.ok);
  const pin = g.set.assets.find((a) => a.kind === 'pin')!;
  const get = async (id: string): Promise<AssetRecord> => {
    const l = await listAssets(demo.deps, demo.scope, demo.campaignId);
    assert.ok(l.ok);
    return l.set.assets.find((a) => a.id === id)!;
  };
  return { demo, g, pin, get, d: demo.deps, s: demo.scope, c: demo.campaignId };
}

/** The template writer wrapped so a test can count calls and hold or fail them. */
function wrapped(hook?: () => Promise<void>) {
  const base = createTemplateGenerator();
  let calls = 0;
  const gen: AssetGenerator = {
    id: base.id,
    async generate(input) {
      calls++;
      if (hook) await hook();
      return base.generate(input);
    },
  };
  return { gen, calls: () => calls };
}

// ---- 1. size caps on edits ----

test('an oversized edit is refused with too_large and nothing is stored or written to history', async () => {
  const { d, s, c, pin, get } = await setup();
  const big = 'x'.repeat(EDIT_CAPS.fieldChars + 1);
  const patches: Record<string, unknown>[] = [
    { description: big },
    { title: 'ok', description: big },
    { keywords: Array.from({ length: EDIT_CAPS.listItems + 1 }, () => 'k') },
    { keywords: [big] },
    // Each piece is under the per-field cap; together they exceed the total cap.
    { title: 'y'.repeat(EDIT_CAPS.fieldChars), description: 'y'.repeat(EDIT_CAPS.fieldChars), altText: 'y'.repeat(EDIT_CAPS.fieldChars), imageBrief: 'y'.repeat(EDIT_CAPS.fieldChars), board: 'z' },
  ];
  for (const patch of patches) {
    const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch, expectedRevision: pin.revision });
    assert.ok(!r.ok && r.errors[0]!.code === 'too_large', JSON.stringify(Object.keys(patch)));
    assert.equal(r.errors[0]!.field, 'patch');
  }
  const after = await get(pin.id);
  assert.equal(after.revision, pin.revision);
  assert.equal(after.history.length, pin.history.length);
  assert.deepEqual(after.content, pin.content);
});

test('an edit over the platform limit but under the hard cap is still saved and flagged too_long', async () => {
  const { d, s, c, pin } = await setup();
  const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { description: 'a'.repeat(800) }, expectedRevision: pin.revision });
  assert.ok(r.ok);
  assert.ok(r.asset.limitIssues.some((i) => i.code === 'too_long'));
  const exact = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { description: 'a'.repeat(EDIT_CAPS.fieldChars) }, expectedRevision: r.asset.revision });
  assert.ok(exact.ok, 'exactly at the cap is accepted');
});

test('a non-finite number is refused', async () => {
  const { d, s, c, g } = await setup();
  const v = g.set.assets.find((a) => a.kind === 'video_script')!;
  const r = await editAsset(d, s, c, v.id, { actor: 'o', patch: { targetLengthSeconds: Number.NaN }, expectedRevision: v.revision });
  assert.ok(!r.ok && r.errors[0]!.code === 'invalid');
});

// ---- 3. required revision ----

test('edit and regenerate refuse a call with no revision, and a wrong revision, without changing anything', async () => {
  const { d, s, c, pin, get } = await setup();
  for (const rev of [undefined, 0, -1, 1.5, '1', null]) {
    const e = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'Changed' }, expectedRevision: rev as never });
    assert.ok(!e.ok && e.errors[0]!.code === 'invalid' && e.errors[0]!.field === 'revision', `edit ${String(rev)}`);
    const g = await regenerateAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: rev as never });
    assert.ok(!g.ok && g.errors[0]!.code === 'invalid' && g.errors[0]!.field === 'revision', `regenerate ${String(rev)}`);
  }
  const staleEdit = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'Changed' }, expectedRevision: 7 });
  assert.ok(!staleEdit.ok && staleEdit.errors[0]!.code === 'stale');
  const staleRegen = await regenerateAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: 7 });
  assert.ok(!staleRegen.ok && staleRegen.errors[0]!.code === 'stale');
  const after = await get(pin.id);
  assert.equal(after.revision, 1);
  assert.equal(after.attempt, 0);
  assert.deepEqual(after.content, pin.content);
});

test('two edits made from the same screen: the second is a lost update and is refused', async () => {
  const { d, s, c, pin } = await setup();
  const first = await editAsset(d, s, c, pin.id, { actor: 'a', patch: { title: 'First person title' }, expectedRevision: pin.revision });
  assert.ok(first.ok);
  const second = await editAsset(d, s, c, pin.id, { actor: 'b', patch: { title: 'Second person title' }, expectedRevision: pin.revision });
  assert.ok(!second.ok && second.errors[0]!.code === 'stale');
  const l = await listAssets(d, s, c);
  assert.ok(l.ok);
  assert.equal((l.set.assets.find((a) => a.id === pin.id)!.content as PinContent).title, 'First person title');
});

// ---- 2. regenerate attempt cap ----

test('regenerate stops after the per-asset maximum, with a plain message and no generator call', async () => {
  const { demo, d, s, c, pin, get } = await setup();
  const w = wrapped();
  const deps = { ...d, generator: w.gen };
  let rev = pin.revision;
  for (let i = 1; i <= MAX_REGENERATIONS; i++) {
    const r = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: rev });
    assert.ok(r.ok, `attempt ${i}`);
    assert.equal(r.asset.attempt, i);
    rev = r.asset.revision;
  }
  assert.equal(w.calls(), MAX_REGENERATIONS);
  const over = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: rev });
  assert.ok(!over.ok && over.errors[0]!.code === 'attempt_limit');
  assert.match(over.errors[0]!.message, new RegExp(`${MAX_REGENERATIONS} times`));
  assert.equal(w.calls(), MAX_REGENERATIONS, 'the generator was not called');
  const after = await get(pin.id);
  assert.equal(after.attempt, MAX_REGENERATIONS);
  assert.equal(after.revision, rev);
  // Editing by hand is still possible, and approving then replacing is still capped.
  assert.ok((await editAsset(deps, s, c, pin.id, { actor: 'o', patch: { title: 'Written by hand' }, expectedRevision: rev })).ok);
  const forced = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: rev + 1, replaceApproved: true });
  assert.ok(!forced.ok && forced.errors[0]!.code === 'attempt_limit');
  assert.ok(demo);
});

// ---- 5. in-flight guard ----

test('a double regenerate calls the generator once; the second call is refused and the guard is released afterwards', async () => {
  const { d, s, c, pin, get } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const w = wrapped(() => gate);
  const deps = { ...d, generator: w.gen };
  const first = regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: pin.revision });
  const second = regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: pin.revision });
  const refused = await second;
  assert.ok(!refused.ok && refused.errors[0]!.code === 'in_progress');
  release();
  const done = await first;
  assert.ok(done.ok);
  assert.equal(w.calls(), 1, 'the generator ran once');
  const after = await get(pin.id);
  assert.equal(after.attempt, 1);
  assert.equal(after.history.filter((h) => h.action === 'regenerated').length, 1);
  // Released: a later call with the new revision goes through.
  const next = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: after.revision });
  assert.ok(next.ok);
  assert.equal(w.calls(), 2);
});

test('the in-flight guard is released when the generator fails, and other assets are not blocked', async () => {
  const { d, s, c, pin, g, get } = await setup();
  let fail = true;
  const w = wrapped(async () => { if (fail) throw new Error('model unavailable'); });
  const deps = { ...d, generator: w.gen };
  const bad = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: pin.revision });
  assert.ok(!bad.ok && bad.errors[0]!.code === 'generator_failed');
  assert.deepEqual(await get(pin.id), pin, 'the asset was not changed');
  fail = false;
  const retry = await regenerateAsset(deps, s, c, pin.id, { actor: 'o', expectedRevision: pin.revision });
  assert.ok(retry.ok, 'not stuck in progress');

  // Different assets can regenerate at the same time.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const held = wrapped(() => gate);
  const other = g.set.assets.find((a) => a.kind === 'seo')!;
  const p1 = regenerateAsset({ ...d, generator: held.gen }, s, c, pin.id, { actor: 'o', expectedRevision: retry.asset.revision });
  const p2 = regenerateAsset({ ...d, generator: held.gen }, s, c, other.id, { actor: 'o', expectedRevision: other.revision });
  await Promise.resolve();
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(r1.ok && r2.ok);
});

// ---- 4. archive on a new campaign version ----

test('a new campaign version archives the old set read-only instead of discarding it', async () => {
  const { demo, d, s, c, g } = await setup();
  const pin = g.set.assets.find((a) => a.kind === 'pin')!;
  const ap = await approveAsset(d, s, c, pin.id, { actor: 'owner-1', expectedRevision: pin.revision });
  assert.ok(ap.ok);
  assert.deepEqual((await listArchivedAssets(d, s, c)), { ok: true, sets: [] });

  // New campaign version: plan again and approve.
  const ctx = await demo.campaignDemo.context();
  const re = await regenerateCampaign({ store: demo.campaignDemo.campaigns, now: clock }, { ...ctx });
  assert.ok(re.ok);
  const ap2 = await approveCampaign({ store: demo.campaignDemo.campaigns, now: clock }, ctx, demoCtx.actorUserId, { expectedVersion: re.campaign.version });
  assert.ok(ap2.ok);
  assert.ok(ap2.campaign.version > g.set.campaignVersion);

  const g2 = await generateCampaignAssets(d, s, c, { actor: 'tester' });
  assert.ok(g2.ok && g2.created);
  assert.equal(g2.archivedVersion, g.set.campaignVersion);
  assert.equal(g2.set.campaignVersion, ap2.campaign.version);
  assert.ok(g2.set.assets.every((a) => a.state === 'draft'));

  const arch = await listArchivedAssets(d, s, c, g.set.campaignVersion);
  assert.ok(arch.ok);
  assert.equal(arch.sets.length, 1);
  const old = arch.sets[0]!;
  assert.equal(old.supersededByVersion, ap2.campaign.version);
  assert.ok(old.archivedAt);
  const oldPin = old.assets.find((a) => a.id === pin.id)!;
  assert.equal(oldPin.state, 'approved');
  assert.equal(oldPin.decidedBy, 'owner-1');
  assert.deepEqual(oldPin.history.map((h) => h.action), ['generated', 'approved']);
  assert.deepEqual((await listArchivedAssets(d, s, c, 999)), { ok: true, sets: [] });

  // Never exportable as current: the new set has nothing approved, so the old approval does not leak into the export.
  const ex = await exportCampaign(d, s, c);
  assert.ok(!ex.ok && ex.errors[0]!.code === 'nothing_approved');
  // Asking again for the same version creates nothing new and archives nothing more.
  const again = await generateCampaignAssets(d, s, c);
  assert.ok(again.ok && !again.created);
  const archAll = await listArchivedAssets(d, s, c);
  assert.ok(archAll.ok && archAll.sets.length === 1);

  // Read-only: a returned copy cannot change the archive, and the edit/approve functions only reach the current set.
  oldPin.state = 'rejected';
  const reread = await listArchivedAssets(d, s, c);
  assert.ok(reread.ok && reread.sets[0]!.assets.find((a) => a.id === pin.id)!.state === 'approved');
  const stillOld = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: oldPin.revision });
  assert.ok(stillOld.ok);
  const reread2 = await listArchivedAssets(d, s, c);
  assert.ok(reread2.ok && reread2.sets[0]!.assets.find((a) => a.id === pin.id)!.history.length === 2, 'archive untouched by work on the current set');
});

test('the archive is scoped to workspace and business', async () => {
  const { demo, d, s, c, g } = await setup();
  const ctx = await demo.campaignDemo.context();
  const re = await regenerateCampaign({ store: demo.campaignDemo.campaigns, now: clock }, { ...ctx });
  assert.ok(re.ok);
  assert.ok((await approveCampaign({ store: demo.campaignDemo.campaigns, now: clock }, ctx, demoCtx.actorUserId, { expectedVersion: re.campaign.version })).ok);
  assert.ok((await generateCampaignAssets(d, s, c)).ok);
  const mine = await listArchivedAssets(d, s, c);
  assert.ok(mine.ok && mine.sets.length === 1 && mine.sets[0]!.campaignVersion === g.set.campaignVersion);
  for (const o of [{ workspaceId: s.workspaceId, businessId: 'other-business' }, { workspaceId: 'other-workspace', businessId: s.businessId }]) {
    const r = await listArchivedAssets(d, o, c);
    assert.ok(r.ok && r.sets.length === 0);
    assert.deepEqual(await d.assets.archived(o.workspaceId, o.businessId, c), []);
  }
  const bad = await listArchivedAssets(d, { workspaceId: '', businessId: s.businessId }, c);
  assert.ok(!bad.ok && bad.errors[0]!.code === 'scope');
});

// ---- 6. export-time re-check of a tampered approved asset ----

async function tamper(d: Awaited<ReturnType<typeof setup>>['d'], s: Awaited<ReturnType<typeof setup>>['s'], c: string, id: string, patch: Record<string, unknown>) {
  await d.assets.mutate(s.workspaceId, s.businessId, c, (cur) => {
    const set = structuredClone(cur!);
    Object.assign(set.assets.find((a) => a.id === id)!.content as unknown as Record<string, unknown>, patch);
    return { set, result: null };
  });
}

test('export refuses an approved asset whose text was altered past a limit, and emits no ZIP', async () => {
  const { d, s, c, g } = await setup();
  const [pin1, pin2] = g.set.assets.filter((a) => a.kind === 'pin');
  for (const a of [pin1!, pin2!]) assert.ok((await approveAsset(d, s, c, a.id, { actor: 'o', expectedRevision: a.revision })).ok);
  assert.ok((await exportCampaign(d, s, c)).ok, 'untampered export works');
  await tamper(d, s, c, pin1!.id, { title: 'T'.repeat(300) });
  const r = await exportCampaign(d, s, c);
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0]!.code, 'needs_fixes');
  assert.equal(r.errors[0]!.field, pin1!.id);
  assert.ok(!('zip' in r));
});

test('export refuses an approved asset whose text was altered to break a claims rule', async () => {
  const { d, s, c, g } = await setup();
  const cap = g.set.assets.find((a) => a.kind === 'caption')!;
  assert.ok((await approveAsset(d, s, c, cap.id, { actor: 'o', expectedRevision: cap.revision })).ok);
  await tamper(d, s, c, cap.id, { variants: ['Earn extra income from home. Guaranteed results.'] });
  const r = await exportCampaign(d, s, c);
  assert.ok(!r.ok && r.errors[0]!.code === 'needs_fixes' && r.errors[0]!.field === cap.id);
  // The record still says approved: only the export-time re-check stopped it.
  const l = await listAssets(d, s, c);
  assert.ok(l.ok && l.set.assets.find((a) => a.id === cap.id)!.state === 'approved');
});

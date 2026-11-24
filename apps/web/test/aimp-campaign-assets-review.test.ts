import assert from 'node:assert/strict';
import test from 'node:test';
import { regenerateCampaign } from '../lib/aimp/campaigns/service.ts';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import {
  approveAsset, editAsset, exportCampaign, generateCampaignAssets, listAssets, regenerateAsset, rejectAsset,
} from '../lib/aimp/campaign-assets/index.ts';
import type { AssetRecord, PinContent } from '../lib/aimp/campaign-assets/index.ts';

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
  return { demo, pin, get, d: demo.deps, s: demo.scope, c: demo.campaignId };
}

test('draft -> approved records who and when, and keeps the history', async () => {
  const { d, s, c, pin } = await setup();
  const r = await approveAsset(d, s, c, pin.id, { actor: 'owner-1', expectedRevision: pin.revision });
  assert.ok(r.ok);
  assert.equal(r.asset.state, 'approved');
  assert.equal(r.asset.decidedBy, 'owner-1');
  assert.ok(r.asset.decidedAt);
  assert.deepEqual(r.asset.history.map((h) => h.action), ['generated', 'approved']);
  const again = await approveAsset(d, s, c, pin.id, { actor: 'owner-1', expectedRevision: pin.revision });
  assert.ok(!again.ok && again.errors[0]!.code === 'wrong_state');
});

test('reject needs a reason; a rejected asset is not exportable and is kept with its reason', async () => {
  const { d, s, c, pin, get } = await setup();
  const noReason = await rejectAsset(d, s, c, pin.id, { actor: 'o', reason: '  ', expectedRevision: 1 });
  assert.ok(!noReason.ok && noReason.errors[0]!.code === 'invalid');
  const r = await rejectAsset(d, s, c, pin.id, { actor: 'o', reason: 'Image idea is off-brand', expectedRevision: 1 });
  assert.ok(r.ok);
  const a = await get(pin.id);
  assert.equal(a.state, 'rejected');
  assert.equal(a.rejectionReason, 'Image idea is off-brand');
  assert.equal(a.history.at(-1)!.reason, 'Image idea is off-brand');
  const ex = await exportCampaign(d, s, c);
  assert.ok(!ex.ok && ex.errors[0]!.code === 'nothing_approved');
});

test('edit keeps the replaced text in history, re-checks the rules, and sends an approved asset back to draft', async () => {
  const { d, s, c, pin } = await setup();
  const ok = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: 1 });
  assert.ok(ok.ok);
  const e = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'A calmer week with the planner' }, expectedRevision: ok.asset.revision });
  assert.ok(e.ok);
  assert.equal(e.asset.state, 'draft');
  assert.equal(e.asset.revision, 2);
  assert.equal((e.asset.content as PinContent).title, 'A calmer week with the planner');
  const last = e.asset.history.at(-1)!;
  assert.equal(last.action, 'edited');
  assert.equal((last.before as PinContent).title, (pin.content as PinContent).title);
  assert.equal(e.asset.decidedBy, null);
});

test('an edit that breaks a limit or claim rule is saved but flagged, and cannot be approved until fixed', async () => {
  const { d, s, c, pin } = await setup();
  const bad = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: `Earn extra income ${'x'.repeat(100)}` }, expectedRevision: pin.revision });
  assert.ok(bad.ok);
  assert.ok(bad.asset.limitIssues.length > 0 && bad.asset.claimFlags.some((f) => f.ruleId === 'income'));
  const r = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: bad.asset.revision });
  assert.ok(!r.ok && r.errors[0]!.code === 'needs_fixes');
  const fixed = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'Plan the week at a glance' }, expectedRevision: bad.asset.revision });
  assert.ok(fixed.ok && fixed.asset.limitIssues.length === 0 && fixed.asset.claimFlags.length === 0);
});

test('edits cannot change the link, dates or image size, and bad patches are refused', async () => {
  const { d, s, c, pin } = await setup();
  for (const patch of [{ destinationUrl: 'https://evil.test' }, { publishDate: '2030-01-01' }, { imageSpec: {} }, { title: 5 }, {}, { keywords: 'a' }]) {
    const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch: patch as never, expectedRevision: pin.revision });
    assert.ok(!r.ok && r.errors[0]!.code === 'invalid', JSON.stringify(patch));
  }
});

test('a decision made on text that has since changed is refused (stale revision)', async () => {
  const { d, s, c, pin } = await setup();
  await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'New title' }, expectedRevision: 1 });
  const r = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: 1 });
  assert.ok(!r.ok && r.errors[0]!.code === 'stale');
});

test('regenerate writes a new draft and keeps the old text; it never overwrites an approved asset silently', async () => {
  const { d, s, c, pin, get } = await setup();
  const r = await regenerateAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: pin.revision });
  assert.ok(r.ok);
  assert.equal(r.asset.attempt, 1);
  assert.equal(r.asset.state, 'draft');
  assert.notEqual((r.asset.content as PinContent).title, (pin.content as PinContent).title);
  assert.equal(r.asset.history.at(-1)!.action, 'regenerated');
  assert.deepEqual(r.asset.history.at(-1)!.before, pin.content);

  const ap = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: r.asset.revision });
  assert.ok(ap.ok);
  const refused = await regenerateAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: ap.asset.revision });
  assert.ok(!refused.ok && refused.errors[0]!.code === 'approved_asset');
  const still = await get(pin.id);
  assert.equal(still.state, 'approved');
  assert.deepEqual(still.content, ap.asset.content);

  const forced = await regenerateAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: ap.asset.revision, replaceApproved: true });
  assert.ok(forced.ok && forced.asset.state === 'draft');
  assert.deepEqual(forced.asset.history.at(-1)!.before, ap.asset.content);
});

test('unknown asset ids and missing actors are refused', async () => {
  const { d, s, c, pin } = await setup();
  const r = await approveAsset(d, s, c, 'nope:pin', { actor: 'o', expectedRevision: 1 });
  assert.ok(!r.ok && r.errors[0]!.code === 'not_found');
  const noActor = await approveAsset(d, s, c, pin.id, { actor: ' ', expectedRevision: 1 });
  assert.ok(!noActor.ok && noActor.errors[0]!.code === 'invalid');
});

test('business isolation: another business or workspace can never read or change these assets', async () => {
  const { d, s, c, pin } = await setup();
  const others = [{ workspaceId: s.workspaceId, businessId: 'other-business' }, { workspaceId: 'other-workspace', businessId: s.businessId }];
  for (const o of others) {
    const l = await listAssets(d, o, c);
    assert.ok(!l.ok && l.errors[0]!.code === 'campaign_not_approved');
    assert.ok(!(await generateCampaignAssets(d, o, c)).ok);
    assert.ok(!(await approveAsset(d, o, c, pin.id, { actor: 'x', expectedRevision: 1 })).ok);
    assert.ok(!(await rejectAsset(d, o, c, pin.id, { actor: 'x', reason: 'r', expectedRevision: 1 })).ok);
    assert.ok(!(await editAsset(d, o, c, pin.id, { actor: 'x', patch: { title: 'hijack' }, expectedRevision: 1 })).ok);
    assert.ok(!(await regenerateAsset(d, o, c, pin.id, { actor: 'x', expectedRevision: 1 })).ok);
    assert.ok(!(await exportCampaign(d, o, c)).ok);
    assert.equal(await d.assets.get(o.workspaceId, o.businessId, c), null);
  }
  const mine = await listAssets(d, s, c);
  assert.ok(mine.ok && mine.set.assets.find((a) => a.id === pin.id)!.state === 'draft');
});

test('a business whose own campaign id differs cannot reach the demo campaign assets', async () => {
  const { d, s, c } = await setup();
  const wrongId = await listAssets(d, s, 'some-other-campaign');
  assert.ok(!wrongId.ok && wrongId.errors[0]!.code === 'campaign_not_approved');
  const bad = await listAssets(d, { workspaceId: '', businessId: s.businessId }, c);
  assert.ok(!bad.ok && bad.errors[0]!.code === 'scope');
});

test('when the campaign is regenerated, old assets are stale and need generating again', async () => {
  const { demo, d, s, c, pin } = await setup();
  const ctx = await demo.campaignDemo.context();
  const r = await regenerateCampaign({ store: demo.campaignDemo.campaigns, now: clock }, { ...ctx });
  assert.ok(r.ok);
  // The new draft campaign is no longer approved, so nothing can be changed or exported.
  const ap = await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: 1 });
  assert.ok(!ap.ok && ap.errors[0]!.code === 'campaign_not_approved');
  assert.ok(!(await exportCampaign(d, s, c)).ok);
});

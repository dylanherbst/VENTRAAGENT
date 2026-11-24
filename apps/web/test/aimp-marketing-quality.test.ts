import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import { generateCampaignAssets, listAssets } from '../lib/aimp/campaign-assets/service.ts';

// The quality bar in docs/aimp/marketing/GOLD_EXAMPLES.md, checked on the real demo campaign.
async function assets() {
  const d = await buildAssetsDemo(() => new Date('2026-11-20T00:00:00Z'), {});
  await generateCampaignAssets(d.deps, d.scope, d.campaignId);
  const r = await listAssets(d.deps, d.scope, d.campaignId);
  assert.ok(r.ok);
  return (r as unknown as { set: { assets: { kind: string; content: Record<string, unknown> }[] } }).set.assets;
}

test('Pins: image headline is short and never cut off; boards are topics; no repeated price sentence', async () => {
  const pins = (await assets()).filter((a) => a.kind === 'pin').map((a) => a.content as { textOverlay?: string; imageSpec: { textOverlay: string }; board: string; description: string; title: string });
  assert.ok(pins.length >= 4);
  for (const p of pins) {
    assert.ok(p.imageSpec.textOverlay.split(/\s+/).length <= 6, p.imageSpec.textOverlay);
    assert.ok(!p.imageSpec.textOverlay.includes('…'));
    assert.ok(!/\(.*\)$/.test(p.board) && !/printable (planner|tracker)/i.test(p.board), p.board);
    assert.ok((p.description.match(/A\$\d+/g) ?? []).length <= 1, p.description);
    assert.ok(!/New from .*: .*New from/.test(p.title));
  }
});

test('keywords are never cut off or repeat a word; captions read as sentences', async () => {
  const all = await assets();
  for (const a of all.filter((x) => x.kind === 'pin' || x.kind === 'seo')) {
    for (const k of a.content.keywords as string[]) {
      assert.ok(!k.includes('…'), k);
      const w = k.split(/\s+/); assert.equal(new Set(w).size, w.length, k);
    }
  }
  for (const a of all.filter((x) => x.kind === 'caption')) {
    for (const v of a.content.variants as string[]) {
      assert.ok(!/planner Wedding|tracker Wedding/.test(v), v);
      assert.ok(/[.!?]$/.test(v.trim()), v);
    }
  }
});

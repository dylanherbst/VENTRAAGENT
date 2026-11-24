// AMP-134: an edit patch may only carry the asset's own editable fields, never an inherited object key.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import { editAsset, generateCampaignAssets, listAssets } from '../lib/aimp/campaign-assets/index.ts';
import type { AssetRecord, PinContent } from '../lib/aimp/campaign-assets/index.ts';

const ENV = { AIMP_STORE_ROOT_DOMAIN: 'stores.example.test' };
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++));

async function setup() {
  const demo = await buildAssetsDemo(clock, ENV);
  const g = await generateCampaignAssets(demo.deps, demo.scope, demo.campaignId, { actor: 'tester' });
  assert.ok(g.ok);
  const get = async (id: string): Promise<AssetRecord> => {
    const l = await listAssets(demo.deps, demo.scope, demo.campaignId);
    assert.ok(l.ok);
    return l.set.assets.find((a) => a.id === id)!;
  };
  return { d: demo.deps, s: demo.scope, c: demo.campaignId, pin: g.set.assets.find((a) => a.kind === 'pin')!, get };
}

const INHERITED = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'prototype'];

for (const key of INHERITED) {
  test(`AMP-134: patch key "${key}" is refused and nothing is stored`, async () => {
    const { d, s, c, pin, get } = await setup();
    // JSON.parse makes "__proto__" a real own key, as it would arrive from a request body.
    const patch = JSON.parse(`{"${key}":["x"]}`) as Record<string, unknown>;
    const before = JSON.stringify(await get(pin.id));
    const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch, expectedRevision: pin.revision });
    assert.equal(r.ok, false, `"${key}" must not be accepted`);
    assert.equal(JSON.stringify(await get(pin.id)), before);
    const stored = await get(pin.id);
    assert.equal(Object.hasOwn(stored.content, key), false);
    assert.equal(Object.getPrototypeOf(stored.content), Object.prototype);
  });
}

test('AMP-134: an inherited key mixed with a real field refuses the whole edit', async () => {
  const { d, s, c, pin, get } = await setup();
  const before = JSON.stringify(await get(pin.id));
  const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch: JSON.parse('{"title":"New","constructor":["x"]}') as Record<string, unknown>, expectedRevision: pin.revision });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(await get(pin.id)), before);
});

test('AMP-134: a normal editable field still saves', async () => {
  const { d, s, c, pin, get } = await setup();
  const r = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: 'A fresh title' }, expectedRevision: pin.revision });
  assert.ok(r.ok);
  assert.equal(((await get(pin.id)).content as PinContent).title, 'A fresh title');
});

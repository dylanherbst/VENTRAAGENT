import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import {
  approveAsset, editAsset, exportCampaign, generateCampaignAssets, PIN_CSV_COLUMNS, rejectAsset,
} from '../lib/aimp/campaign-assets/index.ts';
import type { AssetRecord, CampaignExport } from '../lib/aimp/campaign-assets/index.ts';

const ENV = { AIMP_STORE_ROOT_DOMAIN: 'stores.example.test' };
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++));

/** Minimal ZIP reader: central directory, stored or deflated entries. */
function unzip(zip: Uint8Array): Map<string, string> {
  const b = Buffer.from(zip);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0);
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const body = b.subarray(start, start + size);
    out.set(name, (method === 8 ? inflateRawSync(body) : body).toString('utf8'));
    p += 46 + nameLen;
  }
  return out;
}

async function setup(env: Record<string, string> = ENV, placeholderDomain = true) {
  const demo = await buildAssetsDemo(clock, env, { placeholderDomain });
  const g = await generateCampaignAssets(demo.deps, demo.scope, demo.campaignId, { actor: 'tester' });
  assert.ok(g.ok);
  const approve = async (a: AssetRecord) => { const r = await approveAsset(demo.deps, demo.scope, demo.campaignId, a.id, { actor: 'o', expectedRevision: a.revision }); assert.ok(r.ok); };
  const first = (kind: AssetRecord['kind']) => g.set.assets.filter((a) => a.kind === kind);
  return { demo, d: demo.deps, s: demo.scope, c: demo.campaignId, all: g.set.assets, first, approve };
}
const ok = (r: Awaited<ReturnType<typeof exportCampaign>>): CampaignExport => { assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors)); return r; };
const csvRows = (csv: string) => csv.trim().split('\r\n');

test('export contains only approved assets, with absolute links, and says nothing was published', async () => {
  const { d, s, c, first, approve } = await setup();
  const [pin1, pin2, pin3] = first('pin');
  const [cap1, cap2] = first('caption');
  const vid = first('video_script')[0]!;
  const seo = first('seo')[0]!;
  for (const a of [pin1!, pin2!, cap1!, vid, seo]) await approve(a);
  await rejectAsset(d, s, c, pin3!.id, { actor: 'o', reason: 'no', expectedRevision: 1 });

  const ex = ok(await exportCampaign(d, s, c));
  assert.equal(ex.publishing, 'not_connected');
  assert.match(ex.notice, /Nothing was published/);
  assert.deepEqual(ex.counts, { pins: 2, captions: 1, videoScripts: 1, seo: 1 });
  const files = unzip(ex.zip);
  assert.deepEqual([...files.keys()].sort(), ['README.txt', 'captions.txt', 'pin-images.md', 'pins.csv', 'seo.json', 'video-scripts.md']);
  assert.deepEqual(ex.files.slice().sort(), [...files.keys()].sort());

  const rows = csvRows(files.get('pins.csv')!);
  assert.equal(rows.length, 3);
  assert.equal(rows[0], PIN_CSV_COLUMNS.map((x) => `"${x}"`).join(','));
  const p1 = pin1!.content as { title: string; destinationUrl: string };
  assert.ok(rows[1]!.includes(`"${p1.title}"`));
  assert.ok(!files.get('pins.csv')!.includes((pin3!.content as { title: string }).title));
  assert.ok(rows.slice(1).every((r) => r.includes('"https://')));

  const cap = files.get('captions.txt')!;
  assert.ok(cap.includes((cap1!.content as { variants: string[] }).variants[0]!));
  assert.ok(cap.includes(`=== ${cap1!.itemId}`) || cap.includes(cap1!.itemId));
  assert.ok(!cap.includes(cap2!.itemId));
  assert.equal(cap.split('=== ').length - 1, 1);
  assert.ok(files.get('video-scripts.md')!.includes('**Hook:**'));
  const seoJson = JSON.parse(files.get('seo.json')!) as { pages: { url: string; pageTitle: string }[] };
  assert.equal(seoJson.pages.length, 1);
  assert.match(seoJson.pages[0]!.url, /^https:\/\//);

  // No relative link and no draft-only text anywhere.
  for (const [name, text] of files) {
    if (name === 'README.txt') continue;
    assert.ok(!/(^|[\s",(])\/s\/[a-z0-9-]+\/products\//.test(text), `${name} has a relative link`);
  }
  const readme = files.get('README.txt')!;
  assert.match(readme, /NOTHING HAS BEEN PUBLISHED/);
  assert.match(readme, /No publishing account is connected/);
  for (const f of ['pins.csv', 'captions.txt', 'video-scripts.md', 'seo.json']) assert.ok(readme.includes(f));
});

test('only files with approved content are included', async () => {
  const { d, s, c, first, approve } = await setup();
  await approve(first('seo')[0]!);
  const ex = ok(await exportCampaign(d, s, c));
  assert.deepEqual(ex.files.slice().sort(), ['README.txt', 'seo.json']);
  assert.ok(!unzip(ex.zip).get('README.txt')!.includes('- pins.csv'));
});

test('export is refused with a clear message when nothing is approved', async () => {
  const { d, s, c } = await setup();
  const r = await exportCampaign(d, s, c);
  assert.ok(!r.ok);
  assert.equal(r.errors[0]!.code, 'nothing_approved');
  assert.match(r.errors[0]!.message, /Approve at least one asset/);
});

test('export works with no publishing account (the only state today) and never needs one', async () => {
  const { demo, first, approve } = await setup();
  assert.equal(demo.deps.publishing, undefined);
  await approve(first('pin')[0]!);
  assert.equal(ok(await exportCampaign(demo.deps, demo.scope, demo.campaignId)).publishing, 'not_connected');
});

test('export is refused, not emitted with relative links, when no store domain is set', async () => {
  const { d, s, c, first, approve } = await setup({}, false);
  const pin = first('pin')[0]!;
  assert.match((pin.content as { destinationUrl: string }).destinationUrl, /^\/s\//);
  await approve(pin);
  const r = await exportCampaign(d, s, c);
  assert.ok(!r.ok);
  assert.equal(r.errors[0]!.code, 'links_not_absolute');
  assert.match(r.errors[0]!.message, /store's domain/);
});

test('an approved asset that was edited back to draft is left out of the export', async () => {
  const { d, s, c, first, approve } = await setup();
  const [a, b] = first('pin');
  await approve(a!);
  await approve(b!);
  await editAsset(d, s, c, b!.id, { actor: 'o', patch: { title: 'Edited and not yet approved' }, expectedRevision: b!.revision });
  const ex = ok(await exportCampaign(d, s, c));
  assert.equal(ex.counts.pins, 1);
  assert.ok(!unzip(ex.zip).get('pins.csv')!.includes('Edited and not yet approved'));
});

test('csv cells are quoted and cannot start a spreadsheet formula', async () => {
  const { d, s, c, first } = await setup();
  const pin = first('pin')[0]!;
  const e = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: '=HYPERLINK("x") plan, "quoted"', board: '@Boards' }, expectedRevision: pin.revision });
  assert.ok(e.ok);
  // Claim rules flag the @handle board, so it cannot be approved; use a clean formula-like title with a safe board instead.
  const clean = await editAsset(d, s, c, pin.id, { actor: 'o', patch: { title: '-Plan the week, "calmly"', board: 'Weekly planners' }, expectedRevision: e.asset.revision });
  assert.ok(clean.ok && clean.asset.claimFlags.length === 0, JSON.stringify(clean.ok && clean.asset.claimFlags));
  assert.ok((await approveAsset(d, s, c, pin.id, { actor: 'o', expectedRevision: clean.asset.revision })).ok);
  const row = csvRows(unzip(ok(await exportCampaign(d, s, c)).zip).get('pins.csv')!)[1]!;
  assert.ok(row.startsWith(`"'-Plan the week, ""calmly"""`), row);
});

test('the same approved assets give the same ZIP bytes', async () => {
  const { d, s, c, first, approve } = await setup();
  await approve(first('pin')[0]!);
  const a = ok(await exportCampaign(d, s, c)).zip;
  const b = ok(await exportCampaign(d, s, c)).zip;
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

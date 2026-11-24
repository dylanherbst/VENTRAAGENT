import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetsDemo } from '../lib/aimp/campaign-assets/demo.ts';
import {
  claimFlagsFor, createTemplateGenerator, fit, generateCampaignAssets, kindsForFormat, LIMITS, limitIssuesFor, listAssets, themeFor,
} from '../lib/aimp/campaign-assets/index.ts';
import type { AssetDeps, AssetGenerator, PinContent, SeoContent } from '../lib/aimp/campaign-assets/index.ts';

const ENV = { AIMP_STORE_ROOT_DOMAIN: 'stores.example.test' };
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 14, 9, 0, tick++));

async function setup() {
  const demo = await buildAssetsDemo(clock, ENV);
  const g = await generateCampaignAssets(demo.deps, demo.scope, demo.campaignId, { actor: 'tester' });
  assert.ok(g.ok, g.ok ? '' : JSON.stringify(g.errors));
  const campaign = (await demo.deps.campaigns.get(demo.scope.workspaceId, demo.scope.businessId))!;
  return { demo, set: g.set, campaign };
}

test('generation covers every plan item: pin + seo for pin items, caption, video script', async () => {
  const { set, campaign } = await setup();
  assert.equal(set.campaignVersion, campaign.version);
  for (const item of campaign.plan.items) {
    const kinds = set.assets.filter((a) => a.itemId === item.id).map((a) => a.kind).sort();
    assert.deepEqual(kinds, [...kindsForFormat[item.format]].sort(), item.id);
  }
  assert.equal(set.assets.length, campaign.plan.items.reduce((n, i) => n + kindsForFormat[i.format].length, 0));
  assert.ok(set.assets.every((a) => a.state === 'draft' && a.history.length === 1 && a.history[0]!.action === 'generated' && a.revision === 1));
  assert.equal(new Set(set.assets.map((a) => a.id)).size, set.assets.length);
});

test('every template asset is inside the limits and passes the claim rules', async () => {
  const { set } = await setup();
  for (const a of set.assets) {
    assert.deepEqual(a.limitIssues, [], a.id);
    assert.deepEqual(a.claimFlags, [], a.id);
  }
  const pin = set.assets.find((a) => a.kind === 'pin')!.content as PinContent;
  assert.ok(pin.title.length <= 100 && pin.description.length <= 500);
  assert.deepEqual([pin.imageSpec.width, pin.imageSpec.height], [1000, 1500]);
  assert.ok(pin.altText.length > 0 && pin.board.length > 0 && pin.imageBrief.length > 0 && pin.keywords.length > 0);
  assert.match(pin.destinationUrl, /^https:\/\/[a-z0-9-]+\.stores\.example\.test\/products\//);
  const seo = set.assets.find((a) => a.kind === 'seo')!.content as SeoContent;
  assert.ok(seo.pageTitle.length <= 60 && seo.metaDescription.length <= 160);
  const video = set.assets.find((a) => a.kind === 'video_script')!.content;
  assert.ok('beats' in video && video.beats.length >= 3 && video.onScreenText.length >= 1 && video.targetLengthSeconds > 0 && video.hook && video.callToAction);
  const cap = set.assets.find((a) => a.kind === 'caption')!.content;
  assert.ok('variants' in cap && cap.variants.length >= 2);
});

test('generation is deterministic and asking again never overwrites the existing set', async () => {
  const a = await setup();
  const b = await setup();
  assert.deepEqual(a.set.assets.map((x) => x.content), b.set.assets.map((x) => x.content));
  const again = await generateCampaignAssets(a.demo.deps, a.demo.scope, a.demo.campaignId);
  assert.ok(again.ok && !again.created);
  const listed = await listAssets(a.demo.deps, a.demo.scope, a.demo.campaignId);
  assert.ok(listed.ok && listed.current && listed.set.assets.length === a.set.assets.length);
});

test('the limits validator flags every limit instead of fixing it', () => {
  const base: PinContent = {
    title: 'x'.repeat(101), description: 'y'.repeat(501), altText: '', destinationUrl: 'https://a.test/p', board: 'b',
    imageBrief: 'brief', imageSpec: { width: 1000, height: 1500, aspect: '2:3', fileName: 'a.png', textOverlay: 't' }, publishDate: '2026-12-01', keywords: [],
  };
  const fields = limitIssuesFor('pin', base).map((i) => `${i.field}:${i.code}`);
  assert.ok(fields.includes('title:too_long') && fields.includes('description:too_long') && fields.includes('altText:missing') && fields.includes('keywords:too_short'));
  const bad = { ...base, imageSpec: { ...base.imageSpec, width: 500 as never } };
  assert.ok(limitIssuesFor('pin', bad).some((i) => i.field === 'imageSpec'));
  const seo = limitIssuesFor('seo', { pageTitle: 'p'.repeat(61), metaDescription: 'm'.repeat(161), keywords: ['k'], url: 'https://a.test' });
  assert.deepEqual(seo.map((i) => i.field).sort(), ['metaDescription', 'pageTitle']);
  const video = limitIssuesFor('video_script', { hook: 'h', beats: ['one', 'two'], callToAction: 'c', onScreenText: ['t'], targetLengthSeconds: 500, destinationUrl: 'https://a.test', publishDate: '2026-12-01' });
  assert.deepEqual(video.map((i) => i.field).sort(), ['beats', 'targetLengthSeconds']);
  assert.equal(fit('word '.repeat(100), 60).length <= 60, true);
});

test('claim rules flag income claims, guarantees and wrong prices on every text field', () => {
  const listing = { priceMinor: 1400, currency: 'AUD' as const };
  const flags = claimFlagsFor('pin', {
    title: 'Earn extra income with this planner', description: 'A guaranteed result for A$99.', altText: 'ok', destinationUrl: 'https://a.test', board: 'Planners',
    imageBrief: 'Show a happy photo', imageSpec: { width: 1000, height: 1500, aspect: '2:3', fileName: 'a.png', textOverlay: 'Limited time' }, publishDate: '2026-12-01', keywords: ['planner'],
  }, listing);
  const by = (f: string) => flags.filter((x) => x.field === f).map((x) => x.ruleId);
  assert.ok(by('title').includes('income'));
  assert.ok(by('description').includes('guarantee') && by('description').includes('price'));
  assert.ok(by('imageSpec.textOverlay').includes('scarcity'));
  assert.deepEqual(by('altText'), []);
});

test('a generator that writes a claim or an over-long title is flagged on the asset, not silently passed', async () => {
  const demo = await buildAssetsDemo(clock, ENV);
  const tpl = createTemplateGenerator();
  const naughty: AssetGenerator = {
    id: 'naughty-model',
    async generate(input) {
      const c = await tpl.generate(input);
      if (input.kind === 'pin') return { ...c, title: `Make money fast. ${'z'.repeat(120)}` } as never;
      return c;
    },
  };
  const deps: AssetDeps = { ...demo.deps, generator: naughty };
  const g = await generateCampaignAssets(deps, demo.scope, demo.campaignId);
  assert.ok(g.ok);
  const pin = g.set.assets.find((a) => a.kind === 'pin')!;
  assert.equal(pin.generator, 'naughty-model');
  assert.ok(pin.limitIssues.some((i) => i.field === 'title' && i.code === 'too_long'));
  assert.ok(pin.claimFlags.some((f) => f.field === 'title' && f.ruleId === 'income'));
});

test('a failing generator saves nothing', async () => {
  const demo = await buildAssetsDemo(clock, ENV);
  const deps: AssetDeps = { ...demo.deps, generator: { id: 'broken', generate: async () => { throw new Error('model offline'); } } };
  const g = await generateCampaignAssets(deps, demo.scope, demo.campaignId);
  assert.ok(!g.ok && g.errors[0]!.code === 'generator_failed');
  const listed = await listAssets(demo.deps, demo.scope, demo.campaignId);
  assert.ok(!listed.ok && listed.errors[0]!.code === 'not_found');
});

test('themes are chosen from the plan only', async () => {
  const { campaign } = await setup();
  for (const item of campaign.plan.items) assert.ok(campaign.plan.seoThemes.includes(themeFor(campaign.plan, item)!));
  assert.equal(LIMITS.pinTitle, 100);
});

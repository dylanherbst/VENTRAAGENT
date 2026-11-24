// AMP-135: campaign store and campaign-asset store on the /start runtime, so Marketing, Creative Studio and Calendar leave "not available".
// app/start/_server/runtime.ts is not loadable in node (extensionless imports), so this wires the helper runtime.ts calls
// (`createStartMarketing` from marketing-runtime.ts) onto the same shapes the pages read, with the real brand, catalogue and site-version
// services of the campaign demo fixtures, and runs the pages' own loaders and guards. No AI provider, no network, env never read.
// Operator (F-screen 34) does not read the runtime: its page passes the automation demo source (see the last test).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadCalendar } from '../app/app/[business]/marketing/calendar/_server/calendar.ts';
import { creativeStoresOf, loadCreative } from '../app/app/[business]/marketing/creative/_server/creative.ts';
import type { CreativeRuntime } from '../app/app/[business]/marketing/creative/_server/creative.ts';
import { runCreativeOp } from '../app/app/[business]/marketing/creative/_server/creative-guard.ts';
import { runMarketingOp } from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import { campaignContext, campaignStoreOf, loadMarketing } from '../app/app/[business]/marketing/_server/marketing.ts';
import type { MarketingContexts } from '../app/app/[business]/marketing/_server/marketing.ts';
import { createStartMarketing } from '../app/start/_server/marketing-runtime.ts';
import { getApprovedBrand } from '../lib/aimp/branding/service.ts';
import { buildCampaignDemo } from '../lib/aimp/campaigns/demo.ts';
import { getCampaign } from '../lib/aimp/campaigns/service.ts';
import { checkLaunchKit } from '../lib/aimp/launch/kit.ts';
import { DEMO_BUSINESS, DEMO_WORKSPACE, demoCtx } from '../lib/aimp/catalogue/demo.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

const A = DEMO_BUSINESS;
const B = 'biz-other';
const ON = { available: true, reason: '' };
const actor: Actor = { workspaceId: DEMO_WORKSPACE, userId: 'demo-owner' };
const now = () => new Date(Date.UTC(2026, 10, 15, 9, 30));
const ctx: MarketingContexts = { workspaceId: DEMO_WORKSPACE, ownerId: 'demo-owner', catalogueCtx: (businessId) => ({ ...demoCtx, businessId }) };

/** A /start-shaped runtime: stores from the helper, brand and listings of business A from the fixtures, business B known but empty. */
async function setup() {
  const demo = await buildCampaignDemo(now, {});
  const brand = await getApprovedBrand({ store: demo.d.brands }, { workspaceId: DEMO_WORKSPACE }, A);
  assert.ok(brand);
  const sites = createSiteVersionStore({ now });
  assert.equal((await sites.createSite(actor, { ...demoStore, slug: brand.slug })).ok, true);
  const d = await sites.getDraft(actor, brand.slug);
  assert.ok(d.ok);
  assert.equal((await sites.publish(actor, brand.slug, { note: '', expectedRevision: d.value.revision })).ok, true);
  const marketing = createStartMarketing();
  const rt: CreativeRuntime = {
    businesses: new Set([A, B]), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>(), slugs: new Map([[A, brand.slug]]),
    brands: demo.d.brands, catalogue: demo.d.catalogue, sites, ...marketing,
  };
  const input = { availability: ON, rt: () => rt, ctx, now };
  return { rt, marketing, input };
}

test('the /start runtime provides both stores, so the three pages read them instead of "not available"', async () => {
  const { rt, marketing } = await setup();
  assert.equal(campaignStoreOf(rt), marketing.campaigns);
  assert.ok(creativeStoresOf(rt));
  assert.deepEqual(await loadMarketing(rt, ctx, A), { found: true, state: 'ready', model: { state: 'none' } });
  const creative = await loadCreative(rt, ctx, A, now);
  assert.deepEqual(creative, { found: true, state: 'ready', model: { state: 'no_campaign', plan: 'none' } });
  const cal = await loadCalendar(rt, ctx, A, now);
  assert.ok(cal.found && cal.state === 'ready');
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.createStartMarketing\(\)/);
  assert.match(src, /campaigns: StartMarketing\['campaigns'\]/);
  assert.match(src, /campaignAssets: StartMarketing\['campaignAssets'\]/);
});

test('"draft a plan" works through the real campaign service, then approval and drafts work on the helper stores', async () => {
  const { rt, marketing, input } = await setup();
  const drafted = await runMarketingOp(input, A, { kind: 'draft', confirmed: true });
  assert.equal(drafted.ok, true, JSON.stringify(drafted));
  const m = await loadMarketing(rt, ctx, A);
  assert.ok(m.found && m.state === 'ready' && m.model.state === 'draft');
  assert.equal(m.model.summary.wording, 'Built-in plan (no AI call)');
  const saved = await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A });
  assert.equal(saved?.status, 'draft');
  assert.equal((await runMarketingOp(input, A, { kind: 'approve', expectedVersion: 1, confirmed: true })).ok, true);
  const approved = await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A });
  assert.ok(approved);
  const g = await runCreativeOp(input, A, { kind: 'generate', campaignId: approved.id });
  assert.equal(g.ok, true, JSON.stringify(g));
  const c = await loadCreative(rt, ctx, A, now);
  assert.ok(c.found && c.state === 'ready' && c.model.state === 'assets');
  assert.ok(c.model.assets.length > 0);
  assert.ok(await marketing.campaignAssets.get(DEMO_WORKSPACE, A, approved.id));
});

test('two businesses never see each other\'s campaign or assets, and a draft for the other business writes nothing', async () => {
  const { rt, marketing, input } = await setup();
  assert.equal((await runMarketingOp(input, A, { kind: 'draft', confirmed: true })).ok, true);
  assert.equal((await runMarketingOp(input, A, { kind: 'approve', expectedVersion: 1, confirmed: true })).ok, true);
  const a = await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A });
  assert.ok(a);
  assert.equal((await runCreativeOp(input, A, { kind: 'generate', campaignId: a.id })).ok, true);

  // B reads nothing of A's.
  assert.deepEqual(await loadMarketing(rt, ctx, B), { found: true, state: 'ready', model: { state: 'none' } });
  assert.deepEqual(await loadCreative(rt, ctx, B, now), { found: true, state: 'ready', model: { state: 'no_campaign', plan: 'none' } });
  assert.equal(await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: B }), undefined);
  assert.equal(await marketing.campaignAssets.get(DEMO_WORKSPACE, B, a.id), null, 'A\'s campaign id under B finds no assets');
  // B cannot generate for A's campaign id, and drafting for B (no brand) stores nothing under B or A.
  assert.equal((await runCreativeOp(input, B, { kind: 'generate', campaignId: a.id })).ok, false);
  assert.equal((await runMarketingOp(input, B, { kind: 'draft', confirmed: true })).ok, false);
  assert.equal(await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: B }), undefined);
  assert.equal((await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A }))?.id, a.id);
  // A different workspace reads nothing of this workspace.
  const other: MarketingContexts = { ...ctx, workspaceId: 'other-workspace' };
  assert.deepEqual(await loadMarketing(rt, other, A), { found: true, state: 'ready', model: { state: 'none' } });
  // Two runtimes do not share stores.
  const second = createStartMarketing();
  assert.equal(await getCampaign({ store: second.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A }), undefined);
});

test('Operator reads the automation demo source passed by its page, not the runtime (no runtime property is needed)', () => {
  const page = readFileSync(new URL('../app/app/[business]/operator/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /automation: automationSource\(\)/);
});

test('launch kit: every post names the real product and links to the live shop, and a stale or foreign link is caught', async () => {
  const { rt, marketing, input } = await setup();
  assert.equal((await runMarketingOp(input, A, { kind: 'draft', confirmed: true })).ok, true);
  const kit = await getCampaign({ store: marketing.campaigns }, { workspaceId: DEMO_WORKSPACE, businessId: A });
  assert.ok(kit);
  const cctx = await campaignContext(rt, ctx, A);
  const good = checkLaunchKit(kit.plan, cctx);
  assert.deepEqual(good.problems, []);
  assert.ok(good.ok && good.items > 0 && good.products.length > 0);
  const slug = cctx.store.slug;
  assert.ok(kit.plan.items.every((i) => i.targetUrl.includes(slug) && i.targetUrl.includes('/products/')), 'each link is a product page of this shop');

  const wrongLink = structuredClone(kit.plan);
  wrongLink.items[0].targetUrl = 'https://example.com/elsewhere';
  assert.match(checkLaunchKit(wrongLink, cctx).problems.join(' '), /not to your live product page/);
  const wrongTitle = structuredClone(kit.plan);
  wrongTitle.items[0].productTitle = 'Some other product';
  assert.match(checkLaunchKit(wrongTitle, cctx).problems.join(' '), /but your listing is/);
  const wrongPrice = structuredClone(kit.plan);
  wrongPrice.items[0].priceMinor += 100;
  assert.match(checkLaunchKit(wrongPrice, cctx).problems.join(' '), /old price/);
  const wrongShop = structuredClone(kit.plan);
  wrongShop.store.slug = 'someone-elses-shop';
  assert.match(checkLaunchKit(wrongShop, cctx).problems.join(' '), /different shop/);
  // a paused shop cannot be linked to
  const paused = { ...cctx, store: { ...cctx.store, status: 'paused' as const } };
  assert.equal(checkLaunchKit(kit.plan, paused).ok, false);
});

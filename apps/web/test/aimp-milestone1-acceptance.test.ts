// Milestone 1 acceptance, on the real services with fixtures (no network, no Stripe, nothing sent): a fresh customer's journey from
// intake to a published shop, a test payment, one delivery (and none on replay) and a launch kit that names the right product and
// links to the live shop. This is the node-level proof; the phone-viewport run in a browser is separate and not covered here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { runMarketingOp } from '../app/app/[business]/marketing/_server/marketing-guard.ts';
import { campaignContext } from '../app/app/[business]/marketing/_server/marketing.ts';
import type { MarketingContexts } from '../app/app/[business]/marketing/_server/marketing.ts';
import { createStartMarketing } from '../app/start/_server/marketing-runtime.ts';
import { DOWNLOAD_PATH, createStartOrders, runTestPurchase } from '../app/start/_server/orders-runtime.ts';
import { blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import { approveBrand, createBrandDraft, getApprovedBrand } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { getCampaign } from '../lib/aimp/campaigns/service.ts';
import { createCatalogueService } from '../lib/aimp/catalogue/service.ts';
import { createMemoryCoverAssets } from '../lib/aimp/catalogue/store.ts';
import { generateProductSpec, renderSamplePdf } from '../lib/aimp/factory/index.ts';
import { checkLaunchKit } from '../lib/aimp/launch/kit.ts';
import { reviewLaunch } from '../lib/aimp/launch/review.ts';
import { validateContext } from '../lib/aimp/onboarding/context.ts';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';
import { createProductService } from '../lib/aimp/products/service.ts';
import { createMemoryProductStore } from '../lib/aimp/products/store.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/store.ts';
import type { Actor } from '../lib/aimp/site-versions/store.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

const WORKSPACE = 'demo-workspace';
const OWNER = 'demo-owner';
const BIZ = 'biz-m1';
const START = Date.parse('2026-11-15T09:30:00Z');
const now = () => new Date(START);

test('milestone 1: intake > ideas > product + sample > publish review > test payment > one delivery > launch kit', async () => {
  // 1. intake: Australia and English are fully supported; the five ideas each say who buys first and what the owner still does
  const ctxIn = validateContext({ country: 'AU', language: 'en', timezone: 'Australia/Perth', knownPeople: 'a parents group' });
  assert.ok(ctxIn.ok);
  const found = findOpportunities({ budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' }, { now });
  assert.equal(found.ideas.length, 5);
  assert.ok(found.ideas.every((i) => i.firstBuyerChannel && i.ownerWork.length > 0));
  const idea = found.ideas[0];

  // 2. one product: approved file, listing and a price
  const llm = createProviderRegistry({ env: {} }).llm;
  const productStore = createMemoryProductStore();
  const products = createProductService({ store: productStore, now, generateSpec: async () => { throw new Error('not used'); } });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  const catalogue = createCatalogueService({ products, brands, assets, now });
  const blueprint = blueprintRegistry.find(idea.blueprint.id);
  assert.ok(blueprint);
  const spec = await generateProductSpec({ blueprint, provider: llm, now, inputs: { niche: idea.niche, audience: idea.whoToSellTo, pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 } });
  const pctx = { workspaceId: WORKSPACE, actorId: OWNER };
  const { product, version } = await products.createProduct(pctx, { businessId: BIZ, spec });
  await products.approve(pctx, version.id);
  for (const role of ['cover', 'preview', 'master'] as const) assets.add({ id: `${product.id}-${role}`, workspaceId: WORKSPACE, businessId: BIZ, productId: product.id, role });
  const bd = { store: brands, now };
  assert.ok((await createBrandDraft(bd, { workspaceId: WORKSPACE }, BIZ, { niche: idea.niche, audience: idea.whoToSellTo, productTitle: spec.title, productType: 'printable planner', formats: ['PDF'] })).ok);
  assert.ok((await approveBrand(bd, { workspaceId: WORKSPACE }, BIZ, OWNER)).ok);
  const octx = { workspaceId: WORKSPACE, actorUserId: OWNER, idempotencyKey: `t:${BIZ}` };
  const draft = await catalogue.createDraft(octx, { businessId: BIZ, productId: product.id });
  await catalogue.approveListing(octx, draft.listingId);
  const sample = renderSamplePdf(spec);
  assert.ok(sample.pageCount >= 2 && sample.pageCount < blueprint.output.sections.reduce((n, s) => n + s.pages, 0));

  // 3. publish: the review says it can be approved while payments are pending, and the shop goes live
  const brand = await getApprovedBrand({ store: brands }, { workspaceId: WORKSPACE }, BIZ);
  assert.ok(brand);
  const actor: Actor = { workspaceId: WORKSPACE, userId: OWNER };
  const sites = createSiteVersionStore({ now });
  assert.equal((await sites.createSite(actor, { ...demoStore, slug: brand.slug })).ok, true);
  const d = await sites.getDraft(actor, brand.slug);
  assert.ok(d.ok);
  const review = reviewLaunch({
    brandApproved: true, approvedListings: 1, hasStoreDraft: true, formDirty: false, hasUnpublishedChanges: true, hasLiveVersion: false, paused: false,
    buyEnabled: false, paymentsNextAction: 'Connect Stripe', paymentsWhy: 'Stripe is how you get paid.', paymentsOutstanding: [],
  });
  assert.equal(review.canApprove, true);
  assert.ok(review.paymentsHolding.length > 0, 'what holds up payments is stated');
  assert.equal((await sites.publish(actor, brand.slug, { note: '', expectedRevision: d.value.revision })).ok, true);
  assert.equal((await sites.resolvePublished(brand.slug)).status, 'live');

  // 4. test payment: paid once, one delivery, the emailed link gives the approved file, a replayed payment gives no second delivery
  const slugs = new Map([[BIZ, brand.slug]]);
  const orderDemo = createStartOrders({ workspaceId: WORKSPACE, actorId: OWNER, productStore, catalogue, now });
  const paid = await runTestPurchase(orderDemo, { catalogue, products, slugs }, BIZ, 'owner@example.com');
  assert.ok(paid.ok, JSON.stringify(paid));
  assert.equal(paid.summary.orderStatus, 'paid');
  assert.deepEqual(paid.summary.deliveries, { grants: 1, emails: 1 });
  assert.equal(paid.summary.replay.secondDelivery, false);
  assert.ok(paid.summary.downloadToken);
  const got = await orderDemo.files.redeem(paid.summary.downloadToken);
  assert.ok(got.ok);
  const approved = await products.getBuyerFile(pctx, product.id);
  assert.deepEqual(Buffer.from(got.file.bytes), Buffer.from(approved.bytes));
  assert.ok(paid.summary.downloadPath?.startsWith(DOWNLOAD_PATH));

  // 5. launch kit: every post names this product and links to the live shop
  const marketing = createStartMarketing();
  const rt = { businesses: new Set([BIZ]), seeds: new Map<string, unknown>(), productIds: new Map<string, string[]>(), slugs, brands, catalogue, sites, ...marketing };
  const mctx: MarketingContexts = { workspaceId: WORKSPACE, ownerId: OWNER, catalogueCtx: (businessId) => ({ workspaceId: WORKSPACE, businessId, actorUserId: OWNER, idempotencyKey: `t:${businessId}` }) };
  const input = { availability: { available: true, reason: '' }, rt: () => rt, ctx: mctx, now };
  const drafted = await runMarketingOp(input, BIZ, { kind: 'draft', confirmed: true });
  assert.equal(drafted.ok, true, JSON.stringify(drafted));
  const kit = await getCampaign({ store: marketing.campaigns }, { workspaceId: WORKSPACE, businessId: BIZ });
  assert.ok(kit);
  const check = checkLaunchKit(kit.plan, await campaignContext(rt, mctx, BIZ));
  assert.deepEqual(check.problems, []);
  assert.ok(check.products.length > 0 && check.items > 0);
  assert.ok(kit.plan.items.every((i) => i.targetUrl.includes(brand.slug)));
});

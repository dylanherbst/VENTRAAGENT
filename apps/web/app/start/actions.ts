'use server';
// Server actions for the guided-setup journey. Each one is a thin call into the same lib/aimp functions the test pages
// under app/tools use (named beside each action); no business rule lives here. Stateful steps run on the shared DEMO
// runtime in _server/runtime.ts and answer with the fresh state, so the page always shows what the server holds.
import { applyTemplate } from '../../lib/aimp/storefront/templates';
import { blueprintRegistry } from '../../lib/aimp/blueprints/index';
import { approveBrand, createBrandDraft, editBrand, getApprovedBrand, getApprovedBrandOutputs, listBrandVersions } from '../../lib/aimp/branding/service';
import type { BrandEdits, BrandInput, BrandIssue } from '../../lib/aimp/branding/types';
import { CatalogueError, estimateFees, listingIdFor } from '../../lib/aimp/catalogue/index';
import { ProductFactoryError } from '../../lib/aimp/factory/generate';
import { parseFlags } from '../../lib/aimp/flags';
import { findOpportunities, InvalidProfileError } from '../../lib/aimp/opportunities/index';
import type { FinderProfile, OpportunityIdea } from '../../lib/aimp/opportunities/index';
import { defaultInputs, ideaIdOf } from '../../lib/aimp/selection/preview';
import { MAX_REGENERATIONS } from '../../lib/aimp/products/service';
import { ProductError } from '../../lib/aimp/products/types';
import type { ProductVersion } from '../../lib/aimp/products/types';
import { createProviderRegistry } from '../../lib/aimp/providers/index';
import { resolveStatus } from '../../lib/aimp/providers/status';
import type { ProviderStatus } from '../../lib/aimp/providers/types';
import { DISCONNECTED_REASON } from '../../lib/aimp/sellers/connect';
import { FIXTURE_SELLERS } from '../../lib/aimp/sellers/fixtures';
import { checkoutGate } from '../../lib/aimp/sellers/gate';
import { deriveReadiness } from '../../lib/aimp/sellers/readiness';
import { createInMemorySellerStore } from '../../lib/aimp/sellers/store';
import type { Result } from '../../lib/aimp/site-versions/store';
import { purchaseState } from '../../lib/aimp/storefront/load';
import {
  MAX_PRODUCTS_PER_BUSINESS, WORKSPACE, OWNER, admit, availability, brandCtx, catalogueCtx, checkBusiness, makeSpec, productCtx, runtime, siteActor,
} from './_server/runtime';
import type { JourneyRuntime, PlanInputs } from './_server/runtime';
import type {
  ActionReply, BrandOp, BrandReply, BrandState, CatalogueOp, CatalogueState, Connection, IdeasResponse, ListingRow, PaymentsState, ProductView, ProductsOp,
  ProductsState, StoreOp, StoreState, VersionView,
} from './journey-types';
import { runTestPurchase } from './_server/orders-runtime';
import type { TestPurchaseResult } from './_server/orders-runtime';
import { buildStoreDraft, storeProductsFrom } from './store-draft';
import type { ListingExtras } from './store-draft';

const conn = (s: ProviderStatus): Connection => ({ status: s.status, label: s.label, reason: s.reason, demo: s.demo });
const NO_BUSINESS = 'Choose a business idea first.';
const FULL = 'The demo store on this server is full. Nothing was saved.';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------- Ideas: same call as tools/opportunity-finder ----------
export async function findIdeasAction(profile: unknown): Promise<IdeasResponse> {
  const llm = createProviderRegistry({ env: process.env }).llm.status;
  const mode = llm.status === 'live' ? 'live' : 'fixture';
  try {
    return { ok: true, mode, connection: conn(llm), result: findOpportunities(profile, { now: () => new Date(), mode }) };
  } catch (e) {
    if (e instanceof InvalidProfileError) return { ok: false, mode, connection: conn(llm), problems: e.issues.map((i) => i.message) };
    throw e;
  }
}

// ---------- Demo fast-forward (owner request, 14 Nov evening): one click from Welcome straight to a filled-in
// store, for showing someone the app without typing anything. Picks a fixture idea, then drives the SAME actions
// below (brand, products, catalogue, store) that a person clicking through each real step would trigger. Always
// fixture mode, even when a live model key is configured, so it is fast and deterministic. Nothing here is a
// forecast and nothing is published -- the store is left as an unpublished draft, exactly like "Create store draft".
export interface DemoFastForwardReply {
  ok: boolean;
  message: string;
  businessId?: string;
  ideaId?: string;
  idea?: OpportunityIdea;
}

const DEMO_FAST_FORWARD_PROFILE: FinderProfile = {
  budgetMinor: 60000,
  weeklyHours: 10,
  interests: ['organisation', 'wellbeing', 'small business'],
  skills: ['writing', 'design'],
  preferredEffort: 'medium',
};

export async function demoFastForwardAction(): Promise<DemoFastForwardReply> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason };

  let idea: OpportunityIdea;
  try {
    const result = findOpportunities(DEMO_FAST_FORWARD_PROFILE, { now: () => new Date(), mode: 'fixture' });
    if (!result.ideas[0]) return { ok: false, message: 'No demo idea is available right now.' };
    idea = result.ideas[0];
  } catch {
    return { ok: false, message: 'Could not generate a demo idea.' };
  }

  const businessId = `demo-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const inputs = defaultInputs(idea);

  let b = await brandAction(businessId, { kind: 'start', input: { niche: idea.niche, audience: idea.whoToSellTo, productType: idea.whatToSell }, nameIndex: 0 });
  if (!b.ok) return { ok: false, message: `Brand step failed: ${b.message || b.errors.join(', ')}` };
  b = await brandAction(businessId, { kind: 'approve' });
  if (!b.ok) {
    // A second demo business gets the same example name, so its store address is already taken by the first one.
    // Give this one its own address (name unchanged) and approve again.
    const draft = b.state.versions.find((v) => v.status === 'draft');
    const suffix = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
    if (draft) {
      b = await brandAction(businessId, { kind: 'save', edits: { slug: `${draft.slug.slice(0, 36)}-${suffix}` } });
      if (b.ok) b = await brandAction(businessId, { kind: 'approve' });
    }
  }
  if (!b.ok) return { ok: false, message: `Could not approve the demo brand: ${[b.message, ...b.errors].filter(Boolean).join(' ')}` };

  let p = await productsAction(businessId, { kind: 'create', blueprintId: idea.blueprint.id, inputs });
  if (!p.ok) return { ok: false, message: `Could not build the demo product: ${p.message || p.errors.join(', ')}` };
  const product = p.state.products[0];
  const version = product?.versions[0];
  if (!product || !version) return { ok: false, message: 'The demo product was built but is missing a version.' };
  p = await productsAction(businessId, { kind: 'approve', versionId: version.id });
  if (!p.ok) return { ok: false, message: `Could not approve the demo product: ${p.message || p.errors.join(', ')}` };

  let c = await catalogueAction(businessId, { kind: 'start', productId: product.id });
  if (!c.ok) return { ok: false, message: `Could not list the demo product: ${c.message || c.errors.join(', ')}` };
  const row = c.state.rows.find((r) => r.productId === product.id);
  if (!row?.latest) return { ok: false, message: 'The demo listing is missing a draft.' };
  c = await catalogueAction(businessId, { kind: 'approve', listingId: row.listingId, version: row.latest.version });
  if (!c.ok) return { ok: false, message: `Could not approve the demo listing: ${c.message || c.errors.join(', ')}` };

  const s = await storeAction(businessId, { kind: 'create' });
  if (!s.ok) return { ok: false, message: `Could not create the demo store: ${s.message || s.errors.join(', ')}` };

  return { ok: true, message: 'Demo business ready.', businessId, ideaId: ideaIdOf(idea), idea };
}

// ---------- Brand: same calls as tools/aimp-branding, on the shared runtime ----------
async function brandState(rt: JourneyRuntime, businessId: string): Promise<BrandState> {
  const deps = { store: rt.brands };
  const outputs = await getApprovedBrandOutputs(deps, brandCtx, businessId);
  return { ...availability(), versions: await listBrandVersions(deps, brandCtx, businessId), storefront: outputs?.storefront ?? null };
}
const emptyBrand = (): BrandState => ({ ...availability(), versions: [], storefront: null });

export async function brandAction(businessId: string, op: BrandOp): Promise<BrandReply> {
  const fail = (message: string, issues: BrandIssue[] = []): BrandReply => ({ ok: false, message, errors: issues.map((i) => i.message), issues, state: emptyBrand() });
  const a = availability();
  if (!a.available) return fail(a.reason);
  if (!checkBusiness(businessId)) return fail(NO_BUSINESS);
  const rt = runtime();
  const deps = { store: rt.brands, now: () => new Date() };
  if (op.kind === 'load') return { ok: true, message: '', errors: [], issues: [], state: await brandState(rt, businessId) };
  if (!admit(rt, businessId)) return fail(FULL);
  const r = op.kind === 'start' ? await createBrandDraft(deps, brandCtx, businessId, op.input as BrandInput, { nameIndex: Number(op.nameIndex) || 0 })
    : op.kind === 'save' ? await editBrand(deps, brandCtx, businessId, (isObj(op.edits) ? op.edits : {}) as BrandEdits)
      : await approveBrand(deps, brandCtx, businessId, OWNER);
  const state = await brandState(rt, businessId);
  if (!r.ok) return { ok: false, message: 'Nothing was saved. Please fix the points below.', errors: r.errors.map((e) => e.message), issues: r.errors, state };
  const message = op.kind === 'start' ? `Draft version ${r.brand.version} saved.`
    : op.kind === 'save' ? `Saved as ${r.brand.status === 'draft' ? 'a draft' : r.brand.status} (version ${r.brand.version}).`
      : `Version ${r.brand.version} approved. Your store and listings will use this brand.`;
  return { ok: true, message, errors: [], issues: [], state };
}

// ---------- Products: same calls as tools/product-factory and tools/product-review ----------
const productErr = (e: unknown): string[] =>
  e instanceof ProductError || e instanceof ProductFactoryError ? [e.message, ...e.problems] : ['Something went wrong and nothing was saved. Please try again.'];

function versionView(v: ProductVersion): VersionView {
  return {
    id: v.id, version: v.version, status: v.status, title: v.spec.title, mode: v.spec.mode, note: v.spec.ai.note,
    pageCount: v.pageCount, fileHash: v.fileHash, fileBytes: v.fileBytes, qa: v.qa, qaPassed: v.qaPassed,
    claims: v.spec.claims.map((c) => c.text), sections: v.spec.sections.map((s) => ({ title: s.title, pages: s.pages.length })),
    createdAt: v.createdAt, approvedAt: v.approvedAt,
  };
}
async function productViews(rt: JourneyRuntime, businessId: string): Promise<ProductView[]> {
  const out: ProductView[] = [];
  for (const id of rt.productIds.get(businessId) ?? []) {
    const versions = await rt.products.listVersions(productCtx, id);
    const first = versions[0];
    if (!first) continue;
    out.push({
      id, blueprintId: first.spec.blueprint.id, title: versions[versions.length - 1].spec.title, versions: [...versions].reverse().map(versionView),
      approvedVersion: versions.find((v) => v.status === 'approved')?.version ?? null, regenerationsLeft: Math.max(0, MAX_REGENERATIONS - (versions.length - 1)),
    });
  }
  return out;
}
async function productsState(rt: JourneyRuntime | null, businessId: string): Promise<ProductsState> {
  const connection = conn(createProviderRegistry({ env: process.env }).llm.status);
  return { ...availability(), connection, products: rt ? await productViews(rt, businessId) : [], maxProducts: MAX_PRODUCTS_PER_BUSINESS };
}

export async function productsAction(businessId: string, op: ProductsOp): Promise<ActionReply<ProductsState>> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason, errors: [], state: await productsState(null, '') };
  if (!checkBusiness(businessId)) return { ok: false, message: NO_BUSINESS, errors: [], state: await productsState(null, '') };
  const rt = runtime();
  const done = async (ok: boolean, message: string, errors: string[] = []) => ({ ok, message, errors, state: await productsState(rt, businessId) });
  if (op.kind === 'load') return done(true, '');
  if (!admit(rt, businessId)) return done(false, FULL);
  const mine = rt.productIds.get(businessId) ?? [];
  try {
    if (op.kind === 'create') {
      if (mine.length >= MAX_PRODUCTS_PER_BUSINESS) return done(false, `This demo is limited to ${MAX_PRODUCTS_PER_BUSINESS} products per business.`);
      if (typeof op.blueprintId !== 'string' || !blueprintRegistry.find(op.blueprintId)) return done(false, 'That product type is not available.');
      if (!isObj(op.inputs)) return done(false, 'The details for this business are missing. Go back to your idea and choose it again.');
      const seed = { blueprintId: op.blueprintId, inputs: op.inputs as PlanInputs };
      const spec = await makeSpec(rt, seed);
      rt.seeds.set(businessId, seed);
      const { product, version } = await rt.products.createProduct(productCtx, { businessId, spec });
      // The same three image records the catalogue demo registers (lib/aimp/catalogue/demo.ts): ids only, no real image yet.
      for (const role of ['cover', 'preview', 'master'] as const) rt.assets.add({ id: `${product.id}-${role}`, workspaceId: WORKSPACE, businessId, productId: product.id, role });
      rt.productIds.set(businessId, [...mine, product.id]);
      return done(true, version.qaPassed ? `"${spec.title}" was built and passed every check. Review it, then approve it.` : `"${spec.title}" was built but failed a check, so it cannot be approved yet.`);
    }
    if (op.kind === 'regenerate') {
      if (!mine.includes(op.productId)) return done(false, 'That product was not found.');
      const v = await rt.products.regenerate(productCtx, op.productId);
      return done(true, `Version ${v.version} was built. Earlier versions are unchanged.`);
    }
    const owned = (await productViews(rt, businessId)).some((p) => p.versions.some((v) => v.id === op.versionId));
    if (!owned) return done(false, 'That version was not found.');
    const v = await rt.products.approve(productCtx, op.versionId);
    return done(true, `Version ${v.version} approved. This exact file is what buyers would receive.`);
  } catch (e) {
    const [message, ...errors] = productErr(e);
    return done(false, message, errors);
  }
}

// ---------- Listings and pricing: same calls as tools/catalogue ----------
const catalogueErr = (e: unknown): { message: string; errors: string[] } => {
  if (e instanceof CatalogueError) return e.issues.length ? { message: 'Nothing was saved. Please fix the points below.', errors: e.issues.map((i) => i.message) } : { message: e.message, errors: [] };
  if (e instanceof ProductError) return { message: e.message, errors: e.problems };
  return { message: 'Something went wrong and nothing was saved. Please try again.', errors: [] };
};

async function catalogueState(rt: JourneyRuntime | null, businessId: string): Promise<CatalogueState> {
  const payments = conn(resolveStatus('payments', process.env));
  if (!rt) return { ...availability(), brandApproved: false, payments, rows: [] };
  const ctx = catalogueCtx(businessId);
  const rows: ListingRow[] = [];
  for (const p of await productViews(rt, businessId)) {
    const listingId = listingIdFor(p.id);
    const versions = await rt.catalogue.listVersions(ctx, listingId).catch(() => []);
    const latest = versions[versions.length - 1] ?? null;
    const approved = versions.find((v) => v.status === 'approved') ?? null;
    const suggestion = latest ? await rt.catalogue.suggestPrice(ctx, listingId) : null;
    let checkout: ListingRow['checkout'] = null;
    let checkoutReason = 'Not approved yet, so checkout has no price for this product and cannot sell it.';
    if (approved) { try { checkout = await rt.catalogue.getCheckoutPrice(ctx, listingId); checkoutReason = ''; } catch (e) { checkoutReason = catalogueErr(e).message; } }
    rows.push({
      productId: p.id, productTitle: p.title, productApprovedVersion: p.approvedVersion, listingId, latest, approved,
      versions: versions.map((v) => ({ version: v.version, status: v.status, priceMinor: v.priceMinor, title: v.title })),
      suggestion, fees: latest && suggestion ? estimateFees(latest.priceMinor, { costPerSaleMinor: suggestion.costShareMinor }) : null,
      checkout, checkoutReason,
      productVersionBehind: Boolean(latest && p.approvedVersion !== null && latest.productVersion !== p.approvedVersion),
    });
  }
  return { ...availability(), brandApproved: Boolean(await getApprovedBrand({ store: rt.brands }, brandCtx, businessId)), payments, rows };
}

export async function catalogueAction(businessId: string, op: CatalogueOp): Promise<ActionReply<CatalogueState>> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason, errors: [], state: await catalogueState(null, '') };
  if (!checkBusiness(businessId)) return { ok: false, message: NO_BUSINESS, errors: [], state: await catalogueState(null, '') };
  const rt = runtime();
  const done = async (ok: boolean, message: string, errors: string[] = []) => ({ ok, message, errors, state: await catalogueState(rt, businessId) });
  if (op.kind === 'load') return done(true, '');
  const ctx = catalogueCtx(businessId);
  const mine = rt.productIds.get(businessId) ?? [];
  try {
    if (op.kind === 'start') {
      if (!mine.includes(op.productId)) return done(false, 'That product was not found.');
      await rt.catalogue.createDraft(ctx, { businessId, productId: op.productId });
      return done(true, 'Listing draft written from your approved product and brand. Check the wording and the price, then approve it.');
    }
    if (!mine.some((id) => listingIdFor(id) === op.listingId)) return done(false, 'That listing was not found.');
    if (op.kind === 'save') {
      const saved = await rt.catalogue.editListing(ctx, op.listingId, { title: op.title, shortDescription: op.shortDescription, longDescription: op.longDescription, priceMinor: op.priceMinor }, { expectedVersion: op.version });
      return done(true, `Saved as a draft (version ${saved.version}).${saved.version > 1 ? ' The approved price stays in use until you approve this one.' : ''}`);
    }
    if (op.kind === 'repin') {
      const l = await rt.catalogue.repinProduct(ctx, op.listingId);
      return done(true, `The draft now sells product version ${l.productVersion}. Approve it to make that live.`);
    }
    const l = await rt.catalogue.approveListing(ctx, op.listingId, { expectedVersion: op.version });
    return done(true, `Version ${l.version} approved. Checkout would charge the stored price for this listing.`);
  } catch (e) {
    const x = catalogueErr(e);
    return done(false, x.message, x.errors);
  }
}

// ---------- Store: same calls as tools/site-publish (and the buy-button rule from tools/storefront) ----------
async function storeState(rt: JourneyRuntime | null, businessId: string, withPreview = false): Promise<StoreState> {
  if (!rt) return { ...availability(), brandApproved: false, approvedListings: 0, site: null };
  const brandApproved = Boolean(await getApprovedBrand({ store: rt.brands }, brandCtx, businessId));
  const approvedListings = (await rt.catalogue.listApprovedForBusiness(catalogueCtx(businessId), businessId)).length;
  const slug = rt.slugs.get(businessId);
  let site: StoreState['site'] = null;
  if (slug) {
    const [d, h] = [await rt.sites.getDraft(siteActor, slug), await rt.sites.history(siteActor, slug)];
    if (d.ok && h.ok) {
      const p = withPreview ? await rt.sites.previewDraft(siteActor, slug) : null;
      site = { slug, draft: d.value, history: h.value, publicView: await rt.sites.resolvePublished(slug), purchase: purchaseState(d.value.config), preview: p?.ok ? p.value : null };
    }
  }
  return { ...availability(), brandApproved, approvedListings, site };
}

async function storeProducts(rt: JourneyRuntime, businessId: string) {
  const brand = await getApprovedBrand({ store: rt.brands }, brandCtx, businessId);
  const listings = await rt.catalogue.listApprovedForBusiness(catalogueCtx(businessId), businessId);
  const extras: Record<string, ListingExtras> = {};
  for (const p of await productViews(rt, businessId)) {
    const v = p.versions.find((x) => x.status === 'approved');
    if (v) extras[p.id] = { ...(v.pageCount ? { pages: v.pageCount } : {}), includes: v.claims };
  }
  return { brand, listings, products: brand ? storeProductsFrom(listings, brand.visual.coverStyle, extras) : [] };
}

export async function storeAction(businessId: string, op: StoreOp): Promise<ActionReply<StoreState>> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason, errors: [], state: await storeState(null, '') };
  if (!checkBusiness(businessId)) return { ok: false, message: NO_BUSINESS, errors: [], state: await storeState(null, '') };
  const rt = runtime();
  const done = async (ok: boolean, message: string, errors: string[] = [], preview = false) => ({ ok, message, errors, state: await storeState(rt, businessId, preview) });
  const from = async <T>(label: string, r: Result<T>, okText: string, preview = false) => (r.ok ? done(true, okText, [], preview) : done(false, `${label} did not go through, so nothing changed.`, r.errors));
  if (op.kind === 'load') return done(true, '');
  const slug = rt.slugs.get(businessId);

  if (op.kind === 'create') {
    if (slug) return done(false, 'You already have a store draft.');
    if (!admit(rt, businessId)) return done(false, FULL);
    const { brand, listings, products } = await storeProducts(rt, businessId);
    const outputs = await getApprovedBrandOutputs({ store: rt.brands }, brandCtx, businessId);
    if (!brand || !outputs) return done(false, 'Approve your brand first. The store takes its name, colours and wording from it.');
    if (listings.length === 0) return done(false, 'Approve at least one listing first. A store needs something to sell.');
    const r = await rt.sites.createSite(siteActor, buildStoreDraft(outputs.storefront, products));
    if (r.ok) rt.slugs.set(businessId, r.value.slug);
    return from('Create store draft', r, 'Store draft created from your approved brand and listings. Nothing is public yet.');
  }
  if (!slug) return done(false, 'Create the store draft first.');
  switch (op.kind) {
    case 'save':
      return from('Save draft', await rt.sites.editDraft(siteActor, slug, (d) => { d.hero.heading = op.heading; d.hero.subheading = op.subheading; d.brand.tagline = op.tagline; }, { expectedRevision: op.expectedRevision }), 'Draft saved. Nothing was published.');
    case 'look': {
      const cur = await rt.sites.getDraft(siteActor, slug);
      if (!cur.ok) return done(false, 'We could not open your store draft, so nothing changed.', cur.errors);
      const look = applyTemplate(cur.value.config, op.template, { accent: op.accent, ...(op.logo !== undefined ? { logo: op.logo } : {}) });
      if (!look.ok) return done(false, look.message);
      return from('Change look', await rt.sites.editDraft(siteActor, slug, () => look.config, { expectedRevision: op.expectedRevision }), 'New look saved to your draft. Nothing was published.');
    }
    case 'sync': {
      const { products } = await storeProducts(rt, businessId);
      if (products.length === 0) return done(false, 'There are no approved listings to bring in.');
      return from('Update products', await rt.sites.editDraft(siteActor, slug, (d) => { d.products = products; }, { expectedRevision: op.expectedRevision }), 'The draft now shows your approved listings and prices. Nothing was published.');
    }
    case 'preview':
      return from('Preview', await rt.sites.previewDraft(siteActor, slug), 'Preview ready. Nothing was published.', true);
    case 'publish': {
      const r = await rt.sites.publish(siteActor, slug, { note: op.note, expectedRevision: op.expectedRevision });
      return from('Publish', r, r.ok && r.value.unchanged ? 'Nothing to publish: the draft matches the live version.' : `Version ${r.ok ? r.value.version : ''} is now the live version in this demo.`);
    }
    case 'pause': return from('Pause store', await rt.sites.pause(siteActor, slug), 'Store paused. Visitors would see a "temporarily unavailable" page.');
    case 'unpause': return from('Resume store', await rt.sites.unpause(siteActor, slug), 'Store resumed. The live version is being served again.');
    case 'rollback': {
      const r = await rt.sites.rollback(siteActor, slug, Number(op.version));
      return from('Go back', r, `Version ${op.version} was restored as a new live version${r.ok ? ` (version ${r.value.version})` : ''}.`);
    }
    default: return done(false, 'That action is not available.');
  }
}

// ---------- Payments: same calls as tools/seller-readiness ----------
export async function paymentsState(): Promise<PaymentsState> {
  const flags = parseFlags(process.env);
  const provider = resolveStatus('payments', process.env, flags);
  const BUSINESS = 'journey-business';
  const gateFor = (snapshot: (typeof FIXTURE_SELLERS)[number]['snapshot']) => {
    const accounts = createInMemorySellerStore();
    if (snapshot) accounts.register({ workspaceId: WORKSPACE, businessId: BUSINESS, stripeAccountId: snapshot.id, snapshot, lastEventCreated: 0 });
    return { readiness: deriveReadiness(accounts.get(WORKSPACE, BUSINESS)?.snapshot ?? null), gate: checkoutGate({ workspaceId: WORKSPACE, businessId: BUSINESS, accounts, payments: provider }) };
  };
  // No Stripe account can be connected from this app yet (the live adapter reports disconnected), so the real state
  // for every business is "no account": the same rules, an empty account store.
  const real = gateFor(null);
  return {
    mode: provider.status === 'live' ? 'LIVE' : 'DEMO',
    provider: conn(provider), adapterNote: DISCONNECTED_REASON, readiness: real.readiness, gate: real.gate,
    samples: FIXTURE_SELLERS.map((s) => ({ key: s.key, label: s.label, ...gateFor(s.snapshot) })),
  };
}

// ---------- Payments: one test purchase through the real checkout, paid-event and delivery path (fixtures only) ----------
export async function testPurchaseAction(businessId: string, buyerEmail: string): Promise<TestPurchaseResult> {
  const a = availability();
  if (!a.available) return { ok: false, message: a.reason };
  if (!checkBusiness(businessId)) return { ok: false, message: NO_BUSINESS };
  const rt = runtime();
  if (!rt.businesses.has(businessId)) return { ok: false, message: NO_BUSINESS };
  return runTestPurchase(rt.orderDemo, { catalogue: rt.catalogue, products: rt.products, slugs: rt.slugs }, businessId, buyerEmail);
}

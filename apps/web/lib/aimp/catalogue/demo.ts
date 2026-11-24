// Demo wiring (fixtures only) for the catalogue test page and tests: the REAL product service, brand service and catalogue
// service on in-memory stores. Nothing here changes behaviour; it only builds an approved product, an approved brand and
// registers public images so the real catalogue code has something to sell.
import { blueprintRegistry } from '../blueprints/index.ts';
import { approveBrand, createBrandDraft } from '../branding/service.ts';
import { createMemoryBrandStore } from '../branding/store.ts';
import type { BrandStore } from '../branding/store.ts';
import { generateProductSpec } from '../factory/generate.ts';
import { DEFAULT_INPUTS } from '../factory/request.ts';
import { createProviderRegistry } from '../providers/index.ts';
import { createMemoryProductStore } from '../products/store.ts';
import { createProductService } from '../products/service.ts';
import type { ProductService } from '../products/service.ts';
import type { ProductRecord } from '../products/types.ts';
import { createCatalogueService } from './service.ts';
import type { CatalogueService } from './service.ts';
import { createMemoryCoverAssets } from './store.ts';
import type { CoverAsset, OperationContext } from './types.ts';

export const DEMO_WORKSPACE = 'demo-workspace';
export const DEMO_BUSINESS = 'demo-business';
export const demoCtx: OperationContext = { workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS, actorUserId: 'demo-merchant', idempotencyKey: 'demo' };

export interface DemoCatalogue {
  products: ProductService;
  brands: BrandStore;
  assets: ReturnType<typeof createMemoryCoverAssets>;
  catalogue: CatalogueService;
  llm: Llm;
}
type Llm = ReturnType<typeof createProviderRegistry>['llm'];

/** The real services on in-memory stores. Tests pass their own clock and an empty env (no live AI). */
export function createDemoCatalogue(now: () => Date = () => new Date(), env: Readonly<Record<string, string | undefined>> = process.env): DemoCatalogue {
  const llm = createProviderRegistry({ env }).llm;
  const products = createProductService({
    store: createMemoryProductStore(),
    generateSpec: (p: ProductRecord) => demoSpec(p.blueprintId, llm),
    now,
  });
  const brands = createMemoryBrandStore();
  const assets = createMemoryCoverAssets();
  return { products, brands, assets, llm, catalogue: createCatalogueService({ products, brands, assets, now }) };
}

async function demoSpec(blueprintId: string, llm: Llm) {
  const blueprint = blueprintRegistry.find(blueprintId);
  if (!blueprint) throw new Error('That blueprint does not exist.');
  return generateProductSpec({
    blueprint, provider: llm,
    inputs: { niche: DEFAULT_INPUTS.niche, audience: DEFAULT_INPUTS.audience, pricePointMinor: Number(DEFAULT_INPUTS.pricePointMinor), weeklyHours: Number(DEFAULT_INPUTS.weeklyHours), budgetMinor: Number(DEFAULT_INPUTS.budgetMinor) },
  });
}

/** Approve a brand for the business (once), written for the same niche as the demo products. */
export async function seedApprovedBrand(d: DemoCatalogue, ctx: OperationContext, businessId: string, productTitle: string): Promise<void> {
  const bctx = { workspaceId: ctx.workspaceId };
  const brandDeps = { store: d.brands, now: () => new Date() };
  const made = await createBrandDraft(brandDeps, bctx, businessId, { niche: DEFAULT_INPUTS.niche, audience: DEFAULT_INPUTS.audience, productTitle, productType: 'printable planner', formats: ['PDF'] });
  if (!made.ok) throw new Error(made.errors.map((e) => e.message).join(' '));
  const done = await approveBrand(brandDeps, bctx, businessId, ctx.actorUserId);
  if (!done.ok) throw new Error(done.errors.map((e) => e.message).join(' '));
}

export interface SeededProduct { productId: string; versionId: string; title: string; assets: { cover: CoverAsset; preview: CoverAsset; master: CoverAsset } }

/** Generate a product from a real blueprint, pass QA, approve it, and register its images (a cover, a preview and the private master). */
export async function seedApprovedProduct(d: DemoCatalogue, ctx: OperationContext, businessId: string, blueprintId = 'printable-planner'): Promise<SeededProduct> {
  const spec = await demoSpec(blueprintId, d.llm);
  const { product, version } = await d.products.createProduct({ workspaceId: ctx.workspaceId, actorId: ctx.actorUserId }, { businessId, spec });
  const approved = await d.products.approve({ workspaceId: ctx.workspaceId, actorId: ctx.actorUserId }, version.id);
  const mk = (role: CoverAsset['role']): CoverAsset => ({ id: `${product.id}-${role}`, workspaceId: ctx.workspaceId, businessId, productId: product.id, role });
  const assets = { cover: mk('cover'), preview: mk('preview'), master: mk('master') };
  for (const a of Object.values(assets)) d.assets.add(a);
  return { productId: product.id, versionId: approved.id, title: spec.title, assets };
}

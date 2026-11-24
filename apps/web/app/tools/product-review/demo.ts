// Demo wiring for the product-review test page: the real product service on an in-memory store, kept on globalThis so it
// survives hot reloads. Spec generation is the real Product Factory (demo wording unless a live AI provider is configured).
import { blueprintRegistry } from '../../../lib/aimp/blueprints/index.ts';
import { generateProductSpec, ProductFactoryError } from '../../../lib/aimp/factory/generate.ts';
import { DEFAULT_INPUTS } from '../../../lib/aimp/factory/request.ts';
import { createProviderRegistry } from '../../../lib/aimp/providers/index.ts';
import { createProductService, ProductError } from '../../../lib/aimp/products/index.ts';
import type { ProductRecord, ProductService } from '../../../lib/aimp/products/index.ts';

export const DEMO_WORKSPACE = 'demo-workspace';
export const DEMO_BUSINESS = 'demo-business';
export const ctx = { workspaceId: DEMO_WORKSPACE, actorId: 'demo-merchant' };

const inputs = () => ({
  niche: DEFAULT_INPUTS.niche, audience: DEFAULT_INPUTS.audience,
  pricePointMinor: Number(DEFAULT_INPUTS.pricePointMinor), weeklyHours: Number(DEFAULT_INPUTS.weeklyHours), budgetMinor: Number(DEFAULT_INPUTS.budgetMinor),
});

export const llm = () => createProviderRegistry({ env: process.env }).llm;

export async function makeSpec(blueprintId: string) {
  const bp = blueprintRegistry.find(blueprintId);
  if (!bp) throw new ProductFactoryError('That blueprint does not exist.');
  return generateProductSpec({ blueprint: bp, inputs: inputs(), provider: llm() });
}

type G = typeof globalThis & { __aimpProductReview?: ProductService; __aimpProductIds?: string[] };
export function demoService(): ProductService {
  const g = globalThis as G;
  g.__aimpProductReview ??= createProductService({
    generateSpec: (p: ProductRecord) => makeSpec(p.blueprintId),
  });
  return g.__aimpProductReview;
}
export function demoProductIds(): string[] {
  const g = globalThis as G;
  g.__aimpProductIds ??= [];
  return g.__aimpProductIds;
}

export const errText = (e: unknown): string =>
  e instanceof ProductError || e instanceof ProductFactoryError ? [e.message, ...e.problems].join(' ') : 'Something went wrong.';

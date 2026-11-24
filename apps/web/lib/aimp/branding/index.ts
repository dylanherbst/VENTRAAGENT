export * from './contrast.ts';
export * from './types.ts';
export * from './validate.ts';
export * from './generate.ts';
export * from './name-clash.ts';
export * from './known-brands.ts';
export * from './store.ts';
export * from './adapters.ts';
export * from './service.ts';

import type { SelectionPreview } from '../selection/preview.ts';
import type { BrandInput } from './types.ts';

/** The generator input for a selected opportunity, taken from its AMP-013 preview (the sample product and the saved inputs). */
export function brandInputFromPreview(p: Pick<SelectionPreview, 'inputs' | 'sampleProduct'>): BrandInput {
  return {
    niche: String(p.inputs.niche), audience: String(p.inputs.audience), productTitle: p.sampleProduct.title, productSummary: p.sampleProduct.summary,
    formats: [...p.sampleProduct.formats], totalPages: p.sampleProduct.totalPages,
  };
}

// Demo state for the catalogue test page: the real services on in-memory stores, kept on globalThis so it survives hot reloads.
import { createDemoCatalogue } from '../../../lib/aimp/catalogue/demo.ts';
import type { DemoCatalogue, SeededProduct } from '../../../lib/aimp/catalogue/demo.ts';

export const MAX_DEMO_PRODUCTS = 8;
export interface PageState { d: DemoCatalogue; seeded: SeededProduct[]; brandDone: boolean; lastCheckout: string }
type G = typeof globalThis & { __aimpCatalogueDemo?: PageState };

export function pageState(): PageState {
  const g = globalThis as G;
  g.__aimpCatalogueDemo ??= { d: createDemoCatalogue(), seeded: [], brandDone: false, lastCheckout: '' };
  return g.__aimpCatalogueDemo;
}

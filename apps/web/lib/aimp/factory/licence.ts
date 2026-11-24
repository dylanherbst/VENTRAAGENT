// Licence note carried by every Product Factory export (AMP-025). The sentence is the one the ZIP README already
// prints (render.ts buildReadme); a test keeps the two in step so the wording is never invented twice.
import type { ProductSpec } from './spec.ts';

export const LICENCE_SENTENCE = 'Personal use only. Do not resell or share the files.';
export const DEMO_SENTENCE = 'DEMO SAMPLE: wording is placeholder content, not written by a live AI model.';

/** Lines of the licence note for one product (plain ASCII-safe sentences plus the product title). */
export function licenceLines(spec: Pick<ProductSpec, 'title' | 'mode'>): string[] {
  return [spec.title, LICENCE_SENTENCE, ...(spec.mode === 'demo' ? [DEMO_SENTENCE] : [])];
}

/** One-line ASCII form (no title), used as PNG tEXt metadata and as the licence note in every export result. */
export const licenceNote = (spec: Pick<ProductSpec, 'mode'>): string =>
  [LICENCE_SENTENCE, ...(spec.mode === 'demo' ? [DEMO_SENTENCE] : [])].join(' ');

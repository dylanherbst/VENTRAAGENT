// Where a business's offer, edited content and approved product live (in memory, like the rest of the demo runtime; lost on restart).
// An approved product keeps its spec, so the PDF can be rebuilt byte for byte and the shop can say exactly what the buyer gets.
import type { OfferAnswers, OfferFormat, ProductContent } from './build.ts';
import type { ProductSpec } from '../factory/spec.ts';
import type { Linked } from './link.ts';

export interface OfferState {
  answers: OfferAnswers | null;
  offerId: OfferFormat | null;
  content: ProductContent | null;
  /** Set when the seller approved the preview. Changing anything afterwards clears it. */
  approved: { spec: ProductSpec; approvedAt: string; priceMinor: number; version: number } | null;
  /** The product + listing this approved offer became in the products/catalogue pipeline (null until linked). */
  linked: Linked | null;
}
type G = typeof globalThis & { __aimpOffers?: Map<string, OfferState> };
const all = (): Map<string, OfferState> => ((globalThis as G).__aimpOffers ??= new Map());
export const emptyOfferState = (): OfferState => ({ answers: null, offerId: null, content: null, approved: null, linked: null });
export const getOfferState = (business: string): OfferState => all().get(business) ?? emptyOfferState();
export const setOfferState = (business: string, s: OfferState): void => { all().set(business, s); };
export const approvedProduct = (business: string): OfferState['approved'] => getOfferState(business).approved;

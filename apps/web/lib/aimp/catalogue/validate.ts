// Listing validation (AMP-023). Plain-English messages that name the field. Pure; nothing is thrown for bad input.
import { publicAssetRoles } from '../contracts.ts';
import { LONG_MAX, SHORT_MAX } from '../branding/validate.ts';
import { estimateFees, formatAud, PRICE_MAX_MINOR, PRICE_MIN_MINOR } from './pricing.ts';
import type { CatalogueIssue, CoverAsset, CoverRef } from './types.ts';

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const SHORT_MIN = 10;
export const LONG_MIN = 20;
export { SHORT_MAX, LONG_MAX };

// Copy of the brand copy's promise rule: no income or guaranteed-result claims in listing text. The SOURCE OF TRUTH is
// PROMISE_SRC at branding/validate.ts:17 (not exported, and branding/ is out of scope here); keep this in step with it.
const PROMISE = /\b(?:earn|make)\s*\$\s*[\d,.]*\w*|\b(?:guarantee[ds]?|get rich|risk[- ]free|passive income|make money)\b/i;
const aud = formatAud;

function textIssues(v: unknown, field: string, label: string, min: number, max: number): CatalogueIssue[] {
  if (typeof v !== 'string' || v.trim().length === 0) return [{ field, message: `Enter the ${label}.` }];
  const t = v.trim();
  const out: CatalogueIssue[] = [];
  if (t.length < min) out.push({ field, message: `The ${label} needs at least ${min} characters.` });
  if (t.length > max) out.push({ field, message: `The ${label} is ${t.length} characters; the limit is ${max}.` });
  if (/[<>]/.test(t)) out.push({ field, message: `The ${label} cannot contain < or >.` });
  if (PROMISE.test(t)) out.push({ field, message: `The ${label} cannot promise income or guaranteed results.` });
  return out;
}

export function priceIssues(v: unknown): CatalogueIssue[] {
  if (typeof v !== 'number' || !Number.isInteger(v)) return [{ field: 'priceMinor', message: 'The price must be a whole number of cents.' }];
  if (v < PRICE_MIN_MINOR) return [{ field: 'priceMinor', message: `The price is too low: the minimum is ${aud(PRICE_MIN_MINOR)}.` }];
  if (v > PRICE_MAX_MINOR) return [{ field: 'priceMinor', message: `The price is too high: the maximum is ${aud(PRICE_MAX_MINOR)}.` }];
  if (estimateFees(v).sellerNetMinor <= 0) return [{ field: 'priceMinor', message: 'After fees nothing would be left from each sale. Raise the price.' }];
  return [];
}

/**
 * A cover must be a public image (preview, cover or mockup) of THIS product in THIS workspace. A master file is the paid
 * deliverable and is refused whatever else is true about it.
 */
export function coverIssues(cover: CoverRef | null, asset: CoverAsset | null, ctx: { workspaceId: string; productId: string; businessId: string }): CatalogueIssue[] {
  if (!cover) return [{ field: 'cover', message: 'Choose a cover image before approving.' }];
  if (!asset || asset.workspaceId !== ctx.workspaceId || asset.productId !== ctx.productId || asset.businessId !== ctx.businessId) {
    return [{ field: 'cover', message: 'That image was not found for this product.' }];
  }
  if (cover.role === 'master' || asset.role === 'master') return [{ field: 'cover', message: 'A master file is the product buyers pay for and can never be used as a cover. Choose a preview or cover image.' }];
  if (!(publicAssetRoles as readonly string[]).includes(cover.role)) return [{ field: 'cover', message: 'The cover must be a public preview, cover or mockup image.' }];
  if (!(publicAssetRoles as readonly string[]).includes(asset.role)) return [{ field: 'cover', message: 'The cover must be a public preview, cover or mockup image.' }];
  if (asset.role !== cover.role) return [{ field: 'cover', message: 'The cover image role does not match the stored image.' }];
  return [];
}

export interface ListingFields { title: string; shortDescription: string; longDescription: string; priceMinor: number; currency?: string }

/** Every problem with the text and price, so the seller can fix them in one go. The cover is checked separately (it needs a lookup). */
export function listingIssues(f: ListingFields): CatalogueIssue[] {
  const out: CatalogueIssue[] = [
    ...textIssues(f.title, 'title', 'title', TITLE_MIN, TITLE_MAX),
    ...textIssues(f.shortDescription, 'shortDescription', 'short description', SHORT_MIN, SHORT_MAX),
    ...textIssues(f.longDescription, 'longDescription', 'long description', LONG_MIN, LONG_MAX),
    ...priceIssues(f.priceMinor),
  ];
  if (f.currency !== undefined && f.currency !== 'AUD') out.push({ field: 'currency', message: 'Prices are in Australian dollars (AUD).' });
  return out;
}

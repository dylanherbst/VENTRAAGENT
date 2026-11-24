// The checks behind `previewBrandAction`, as a plain function so the node tests call it (actions.ts imports Next-only modules).
// Order: demo storage on, valid business id, known business, then the one read-only preview. Nothing is written.
// The reply carries only what the Brand kit view draws, never the full brand profile.
import type { StorefrontBrand } from '../../../../../lib/aimp/branding/adapters.ts';
import type { BrandCtx } from '../../../../../lib/aimp/branding/service.ts';
import { listBrandVersions } from '../../../../../lib/aimp/branding/service.ts';
import type { NameClash } from '../../../../../lib/aimp/branding/name-clash.ts';
import type { BrandEdits, BrandIssue } from '../../../../../lib/aimp/branding/types.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { ImpactRow } from '../view-model.ts';
import { previewBrandChange } from './brand.ts';
import type { BrandPreview, BrandRuntime } from './brand.ts';

export const NO_BUSINESS = 'We could not find that business.';

/** What the view uses from a preview: the sample, the impact rows and the three warnings. No brand profile, no live copy, no contrast list. */
export type ClientBrandPreview =
  | { ok: false; errors: BrandIssue[] }
  | {
    ok: true;
    name: string;
    tagline: string;
    palette: StorefrontBrand['palette'];
    rows: ImpactRow[];
    changed: boolean;
    slugTaken: boolean;
    clash: Pick<NameClash, 'level' | 'message' | 'notice'>;
  };

export interface BrandGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed. */
  rt: () => BrandRuntime;
  ctx: BrandCtx;
}

const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refuse = (field: string, message: string): ClientBrandPreview => ({ ok: false, errors: [{ field, message }] });

/** Cuts the service's preview down to what the view draws. */
export function trimPreview(p: BrandPreview): ClientBrandPreview {
  if (!p.ok) return { ok: false, errors: p.errors };
  return {
    ok: true, name: p.storefront.brand.name, tagline: p.storefront.brand.tagline, palette: p.storefront.palette,
    rows: p.rows, changed: p.changed, slugTaken: p.slugTaken,
    clash: { level: p.clash.level, message: p.clash.message, notice: p.clash.notice },
  };
}

export async function runBrandPreview(g: BrandGuardInput, businessId: unknown, edits: unknown): Promise<ClientBrandPreview> {
  if (!g.availability.available) return refuse('brand', g.availability.reason);
  if (!isBusinessId(businessId) || UNSAFE_KEYS.includes(businessId)) return refuse('businessId', NO_BUSINESS);
  const rt = g.rt();
  const known = isKnownBusiness(rt, businessId) || (await listBrandVersions({ store: rt.brands }, g.ctx, businessId)).length > 0;
  if (!known) return refuse('businessId', NO_BUSINESS);
  return trimPreview(await previewBrandChange(rt, g.ctx, businessId, (isObj(edits) ? edits : {}) as BrandEdits));
}

// The checks `createProductAction` runs before it hands over to the existing product builder, as a pure function so the node tests
// can run them (actions.ts imports Next-only modules). Order: demo storage on, valid business id, known business, saved idea.
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';

export const NO_IDEA = 'Choose your business idea in guided set-up first. Products are built from it.';
export const NO_BUSINESS = 'We could not find that business.';

export interface GuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is created while demo storage is off. */
  rt: () => Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
    seeds: { has(businessId: string): boolean; get(businessId: string): { blueprintId: string; inputs: Record<string, string | number> } | undefined };
  };
}

export type CreateGuard =
  | { ok: false; message: string }
  | { ok: true; seed: { blueprintId: string; inputs: Record<string, string | number> } };

export function guardCreate(g: GuardInput, businessId: unknown): CreateGuard {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return { ok: false, message: NO_BUSINESS };
  const seed = rt.seeds.get(businessId);
  if (!seed) return { ok: false, message: NO_IDEA };
  return { ok: true, seed };
}

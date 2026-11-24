// The plan catalogue as data. Billing keeps its OWN snapshot of names and prices (PRICE_SNAPSHOT below) and does not import
// the public pricing config (lib/aimp/site-config.ts): editing the marketing page can never change what is charged or break
// billing at import. A test compares the snapshot with the public config and fails loudly on drift, so a price change is a
// deliberate edit here. Entitlements and allowances are PLACEHOLDERS for the owner to confirm ("monthly limits are still being set").
import { planIds } from './types.ts';
import type { Feature, Meter, Plan, PlanId } from './types.ts';

const A = (opportunity_suggestions: number, products: number, ai_generations: number): Record<Meter, number> => ({ opportunity_suggestions, products, ai_generations });

const discoverFeatures: Feature[] = ['opportunity_suggestions', 'sample_preview'];
const launchFeatures: Feature[] = [...discoverFeatures, 'store', 'product_creation', 'seller_payments', 'file_delivery'];
const autopilotFeatures: Feature[] = [...launchFeatures, 'social_publishing', 'daily_checks'];
const scaleFeatures: Feature[] = [...autopilotFeatures, 'multiple_businesses'];

/** What is charged, in whole AUD dollars per period. The only source billing reads prices from. */
export const PRICE_SNAPSHOT: Readonly<Record<PlanId, { name: string; priceAud: number }>> = Object.freeze({
  discover: Object.freeze({ name: 'Discover', priceAud: 0 }),
  launch: Object.freeze({ name: 'Launch', priceAud: 79 }),
  autopilot: Object.freeze({ name: 'Autopilot', priceAud: 149 }),
  scale: Object.freeze({ name: 'Scale', priceAud: 249 }),
});

// PLACEHOLDER numbers. Per billing period. 0 = not included.
const DETAIL: Record<PlanId, { features: Feature[]; allowances: Record<Meter, number>; maxBusinesses: number }> = {
  discover: { features: discoverFeatures, allowances: A(5, 0, 0), maxBusinesses: 0 },
  launch: { features: launchFeatures, allowances: A(5, 20, 40), maxBusinesses: 1 },
  autopilot: { features: autopilotFeatures, allowances: A(5, 40, 80), maxBusinesses: 1 },
  scale: { features: scaleFeatures, allowances: A(5, 120, 300), maxBusinesses: 3 },
};

/** Dollars to whole cents. Refuses anything that is not a finite, non-negative amount in whole cents (79.99 is fine, 79.999 is not). */
export function toMinor(dollars: unknown): number {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0) throw new Error('plan price must be a finite, non-negative number');
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(dollars * 100 - cents) > 1e-6) throw new Error('plan price must be a whole number of cents');
  return cents;
}

function build(): Readonly<Record<PlanId, Plan>> {
  const out = {} as Record<PlanId, Plan>;
  planIds.forEach((id, rank) => {
    const pub = PRICE_SNAPSHOT[id];
    const d = DETAIL[id];
    out[id] = Object.freeze({
      id, name: pub.name, priceMinor: toMinor(pub.priceAud), currency: 'AUD', rank, placeholder: true,
      features: Object.freeze([...d.features]), allowances: Object.freeze({ ...d.allowances }), maxBusinesses: d.maxBusinesses,
    });
  });
  return Object.freeze(out);
}

export const PLANS: Readonly<Record<PlanId, Plan>> = build();
export const FREE_PLAN_ID: PlanId = 'discover';

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (planIds as readonly string[]).includes(v);
export const getPlan = (id: PlanId): Plan => PLANS[id];
export const listPlans = (): Plan[] => planIds.map((id) => PLANS[id]);

// AIMONEYPRINTER-GROWTH: the AI growth team for EXISTING businesses. The business-startup journey (ideas, product builder, store
// builder, launch) is parked, not deleted: its code stays in the repo and comes back by removing a prefix below.
// Pure, so the node tests and the proxy share it.

export const PRODUCT = { name: 'AiMoneyPrinter', tagline: 'Your business. Powered by an AI growth team.' } as const;

/** Where a new owner starts: the existing-business onboarding. */
export const ONBOARDING = '/start/existing';

/** Startup-only pages outside a workspace. /start (welcome), /start/account (sign in) and /start/existing (onboarding) stay open. */
const PARKED_PUBLIC = ['/start/tour', '/start/goals', '/start/about', '/start/ideas', '/start/brand', '/start/products', '/start/catalogue', '/start/store', '/start/payments', '/start/showcase', '/tools/opportunity-finder', '/shop', '/s'];

/** Startup-only pages inside a workspace (/app/<business>/<segment>). */
export const PARKED_SEGMENTS = ['offers', 'products', 'website', 'domains', 'payments', 'orders', 'results', 'brand', 'path-choice'] as const;

/** Where a parked or old address goes in this product, or null to let it through. */
export function growthRedirect(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/') return '/start';
  if (PARKED_PUBLIC.some((x) => p === x || p.startsWith(`${x}/`))) return ONBOARDING;
  const m = /^\/app\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/([^/]+)/.exec(p);
  if (m && (PARKED_SEGMENTS as readonly string[]).includes(m[2]!)) return `/app/${m[1]}/home`;
  return null;
}

/** Subscription tiers (entitlements only; prices live in Stripe and are not changed from code). */
export const tiers = {
  starter: { label: 'Starter', agents: ['social'] as const, aiRunsPerMonth: 60, imagesPerMonth: 20, rendersPerMonth: 4, coordination: false },
  growth: { label: 'Growth', agents: ['social', 'marketing', 'sales'] as const, aiRunsPerMonth: 200, imagesPerMonth: 60, rendersPerMonth: 12, coordination: true },
  autopilot: { label: 'Autopilot', agents: ['social', 'marketing', 'sales'] as const, aiRunsPerMonth: 600, imagesPerMonth: 150, rendersPerMonth: 40, coordination: true },
} as const;
export type Tier = keyof typeof tiers;
export type GrowthAgent = 'social' | 'marketing' | 'sales';
export const allows = (tier: Tier, agent: GrowthAgent): boolean => (tiers[tier].agents as readonly string[]).includes(agent);

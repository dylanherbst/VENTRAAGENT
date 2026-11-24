// Shop funnel: visits -> checkout clicks -> paid orders, per business. Privacy first: we count anonymous browser SESSIONS (a random id
// kept in the shopper's sessionStorage, never a cookie, IP or fingerprint), each session once per day per step. Paid orders are NOT
// counted here: they come from the real order records, so a click is never mistaken for a sale. In memory until the database exists.
export const funnelSteps = ['visit', 'checkout_click'] as const;
export type FunnelStep = (typeof funnelSteps)[number];

const SESSION = /^[A-Za-z0-9_-]{16,64}$/;
const day = (at: Date) => at.toISOString().slice(0, 10);

export interface FunnelStore {
  record(business: string, step: FunnelStep, session: string, at: Date): boolean;
  counts(business: string, sinceDays: number, now: Date): Record<FunnelStep, number>;
}

export function createFunnelStore(limits = { keysPerBusiness: 50_000, businesses: 1_000 }): FunnelStore {
  const seen = new Map<string, Set<string>>(); // business -> "step|day|session"
  return {
    record(business, step, session, at) {
      if (!funnelSteps.includes(step) || !SESSION.test(session) || !business) return false;
      let s = seen.get(business);
      if (!s) { if (seen.size >= limits.businesses) return false; s = new Set(); seen.set(business, s); }
      const key = `${step}|${day(at)}|${session}`;
      if (s.has(key)) return false;
      if (s.size >= limits.keysPerBusiness) s.delete(s.values().next().value as string);
      s.add(key);
      return true;
    },
    counts(business, sinceDays, now) {
      const out: Record<FunnelStep, number> = { visit: 0, checkout_click: 0 };
      const from = day(new Date(now.getTime() - (sinceDays - 1) * 864e5));
      for (const k of seen.get(business) ?? []) { const [step, d] = k.split('|') as [FunnelStep, string]; if (d >= from) out[step]++; }
      return out;
    },
  };
}

export interface FunnelView {
  visits: number; checkoutClicks: number; paidOrders: number;
  /** Share of the previous step that made it to this one, as a whole percent; null when the previous step is 0. */
  clickRate: number | null; payRate: number | null;
  /** Plain-English read of where people drop off. */
  biggestDrop: string;
}

export function funnelView(c: { visits: number; checkoutClicks: number; paidOrders: number }): FunnelView {
  const pct = (a: number, b: number) => (b > 0 ? Math.round((Math.min(a, b) / b) * 100) : null);
  const clickRate = pct(c.checkoutClicks, c.visits), payRate = pct(c.paidOrders, c.checkoutClicks);
  let biggestDrop: string;
  if (c.visits === 0) biggestDrop = 'No visits yet. Share your shop link to get your first visitors.';
  else if (c.checkoutClicks === 0) biggestDrop = 'People visit but nobody has pressed Buy yet. Check the price, the sample and the first lines of your page.';
  else if (c.paidOrders === 0) biggestDrop = 'People press Buy but nobody has paid yet. Check that checkout works and that payment is switched on.';
  else if ((clickRate ?? 0) < (payRate ?? 0)) biggestDrop = `Most people leave before pressing Buy (${100 - (clickRate ?? 0)}% of visitors).`;
  else biggestDrop = `Most people leave at checkout (${100 - (payRate ?? 0)}% of those who pressed Buy).`;
  return { ...c, clickRate, payRate, biggestDrop };
}

type G = typeof globalThis & { __aimpFunnel?: FunnelStore };
export const funnelStore = (): FunnelStore => ((globalThis as G).__aimpFunnel ??= createFunnelStore());

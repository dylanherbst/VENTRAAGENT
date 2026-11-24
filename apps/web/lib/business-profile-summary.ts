import { buildPlan, routeOf, routes } from './onboarding.ts';
import type { Profile } from './onboarding.ts';
import { formatOfferPrice } from './local-offers.ts';
import type { LocalOffer } from './local-offers.ts';
import type { PricingScenarioWorksheet } from './local-pricing-scenario.ts';

// Pure, read-only summary of one business. Every value is copied or counted from the saved profile, offers and pricing worksheet.
// Nothing is estimated or invented. A saved part that could not be read is reported as such and is never shown as empty.

export const UNREADABLE = { unreadable: true } as const;
export type Part<T> = T | null | typeof UNREADABLE;
export const isUnreadable = (v: unknown): v is typeof UNREADABLE => typeof v === 'object' && v !== null && (v as { unreadable?: unknown }).unreadable === true;

export type SummaryInput = { profile: Profile; offers: Part<readonly LocalOffer[]>; pricing: Part<PricingScenarioWorksheet> };
export type SummaryOffer = { id: string; name: string; kind: string; price: string };
export type SummarySection<T> = { status: 'unreadable' } | { status: 'ok'; value: T };
export type BusinessProfileSummary = {
  name: string;
  route: string;
  stage: string;
  pathways: string[];
  details: { label: string; value: string }[]; // only fields the owner filled in
  offers: SummarySection<SummaryOffer[]>;
  pricingScenario: SummarySection<{ saved: boolean; revision: number | null; updatedAt: string | null }>;
  planProgress: { done: number; total: number; nextStep: string | null };
};

const ok = <T,>(value: T): SummarySection<T> => ({ status: 'ok', value });
const bad = { status: 'unreadable' } as const;

export function summariseBusiness(input: SummaryInput): BusinessProfileSummary {
  const p = input.profile;
  const fields: [string, string][] = [['Industry', p.industry], ['Location', p.location], ['Customers', p.audience], ['Main goal', p.goal], ['Expertise', p.expertise], ['Education offer type', p.pathways.includes('education') ? p.educationOffer : ''], ['Business type', p.pathways.includes('business') ? p.businessType : ''], ['Website', p.website], ['Channels', p.channels]];
  const steps = buildPlan(p);
  const done = new Set(p.completed);
  const finished = steps.filter(s => done.has(s.id));
  const next = steps.find(s => !done.has(s.id));
  return {
    name: p.name,
    route: routes.find(r => r.id === routeOf(p))!.title,
    stage: p.stage === 'existing' ? 'Existing business' : 'Starting out',
    pathways: p.pathways.map(x => x === 'education' ? 'Education' : 'Services'),
    details: fields.filter(([, v]) => v.trim()).map(([label, value]) => ({ label, value: value.trim() })),
    offers: isUnreadable(input.offers) ? bad : ok((input.offers ?? []).map(o => ({ id: o.id, name: o.name, kind: o.kind, price: `${formatOfferPrice(o.amountMinor)} ${o.currency}` }))),
    pricingScenario: isUnreadable(input.pricing) ? bad : ok(input.pricing ? { saved: true, revision: input.pricing.revision, updatedAt: input.pricing.updatedAt } : { saved: false, revision: null, updatedAt: null }),
    planProgress: { done: finished.length, total: steps.length, nextStep: next ? next.title : null },
  };
}

// "Choose for me": three quick taps → one recommended model and niche with a plain reason. Pure and deterministic.
import type { BusinessModel } from '../contracts.ts';
import { findNiche, getBlueprint } from './blueprints.ts';

export const budgetOptions = ['<$50', '$50–200', '$200+'] as const;
export const hoursOptions = ['1–3', '4–8', '8+'] as const;
export const interestOptions = ['organising & productivity', 'art & design', 'family & gifts', 'business & marketing'] as const;
export type Budget = (typeof budgetOptions)[number];
export type WeeklyHours = (typeof hoursOptions)[number];
export type Interest = (typeof interestOptions)[number];

export interface RecommendInput { budget: Budget; hours: WeeklyHours; interest: Interest }
export interface Recommendation { model: BusinessModel; niche: string; reason: string }

type Pick = { model: BusinessModel; niche: string; why: string };

function pick({ budget, hours, interest }: RecommendInput): Pick {
  switch (interest) {
    case 'organising & productivity':
      if (hours === '1–3') return { model: 'digital-templates', niche: 'fitness-trackers', why: 'small trackers are quick to review and suit a few hours a week' };
      if (hours === '4–8') return { model: 'digital-templates', niche: 'teacher-planners', why: 'planners sell all year around the school term and fit a steady few hours a week' };
      return { model: 'digital-templates', niche: 'wedding-planning', why: 'wedding planners are a bigger suite that rewards the extra hours you can give it' };
    case 'art & design':
      if (hours === '1–3') return { model: 'printable-art', niche: 'typography-prints', why: 'typography prints are the quickest art to check and list' };
      if (hours === '4–8') return { model: 'printable-art', niche: 'botanical-prints', why: 'botanical sets give you room to build a gallery-wall range over time' };
      return { model: 'printable-art', niche: 'nursery-wall-art', why: 'nursery art adds an editable name sign, which suits someone with more time' };
    case 'family & gifts':
      if (hours === '1–3') return { model: 'printable-art', niche: 'nursery-wall-art', why: 'ready-made nursery prints suit family gifting without per-order personalisation work' };
      if (hours === '4–8') return { model: 'personalised-digital', niche: 'kids-routine-charts', why: 'routine charts are mostly editable templates, with only a few done-for-you orders to check' };
      return { model: 'personalised-digital', niche: 'baby-milestone-cards', why: 'personalised milestone sets make good gifts and your hours cover checking each order' };
    case 'business & marketing':
      if (hours === '1–3' && budget === '<$50') return { model: 'digital-templates', niche: 'small-business-bookkeeping', why: 'bookkeeping spreadsheets serve business buyers but need less hands-on support' };
      if (budget === '$200+') return { model: 'marketing-assets', niche: 'real-estate-social', why: 'real-estate packs have the highest prices, and your budget covers a Canva Pro brand kit if you want one' };
      if (hours === '8+') return { model: 'marketing-assets', niche: 'coach-launch-kits', why: 'launch kits are the deepest product range and benefit from extra hours' };
      return { model: 'marketing-assets', niche: 'salon-promo-templates', why: 'salon owners buy ready-made promo templates and the range is small enough to manage' };
  }
}

const budgetNote: Record<Budget, string> = {
  '<$50': 'it starts well under A$50',
  '$50–200': 'it starts well within your budget',
  '$200+': 'it starts well within your budget',
};

export function recommend(input: RecommendInput): Recommendation {
  const p = pick(input);
  const niche = findNiche(p.model, p.niche);
  const blueprint = getBlueprint(p.model);
  if (!niche) throw new Error(`Recommendation points at a missing niche: ${p.model}/${p.niche}`);
  const reason = `${niche.label} (${blueprint.title.toLowerCase()}) fits because ${p.why}, and ${budgetNote[input.budget]}.`;
  return { model: p.model, niche: p.niche, reason };
}

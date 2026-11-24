// Selection preview (AMP-013): turns one Opportunity Finder idea + its blueprint into what the owner sees before choosing:
// sample product, brand placeholder, storefront sketch, startup costs, price assumptions and the owner actions still needed.
// Pure and deterministic: no clock, no randomness, no network. Nothing here is a forecast; prices are labelled assumptions.
import { blueprintRegistry, generateLaunchPlan, validatePlanInputs, type BlueprintDefinition, type BlueprintRegistry, type LaunchPlan, type PlanInputs } from '../blueprints/index.ts';
import type { OpportunityIdea } from '../opportunities/index.ts';
import { profit } from '../preview/profit.ts';
import { cardFeeMinor } from '../preview/generate.ts';

export interface SelectionIssue { field: string; message: string }

/** Default price per sale, whole cents AUD incl. GST. An assumption the owner can change, not a market finding. */
export const DEFAULT_PRICE_MINOR = 1200;
export const aud = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Two 32-bit FNV-1a style lanes over UTF-16 code units: 10 hex chars, pure JS so it also runs in the browser. */
function shortHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 10);
}
const norm = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ');

/**
 * Stable id for an idea: blueprint id + version + readable niche slug + a short hash of the exact (whitespace-normalised)
 * niche and audience. The slug alone collides ("Pet care" / "Pet-care!", non-Latin niches); the hash keeps those apart.
 * The finder gives ideas a rank, which changes; this does not.
 */
export function ideaIdOf(idea: Pick<OpportunityIdea, 'niche' | 'blueprint'> & { whoToSellTo?: string }): string {
  const hash = shortHash(`${norm(idea.niche)}\u0000${norm(idea.whoToSellTo ?? '')}`);
  return `${idea.blueprint.id}@${idea.blueprint.version}:${slug(idea.niche)}-${hash}`;
}

export interface SelectionPreview {
  ideaId: string;
  label: string;
  blueprint: { id: string; version: string };
  /** The blueprint inputs this preview was built from (what the owner can edit). */
  inputs: PlanInputs;
  sampleProduct: { title: string; summary: string; audience: string; formats: string[]; totalPages: number; sections: { title: string; pages: number }[] };
  brand: { name: string; isPlaceholder: true; note: string };
  storefront: { isSketch: true; blocks: { block: string; shows: string }[]; note: string };
  costs: { lines: { label: string; amountMinor: number; note: string }[]; totalMinor: number; budgetMinor: number; withinBudget: boolean; shortfallMinor: number };
  priceAssumptions: {
    label: string;
    priceMinor: number;
    cardFeeMinor: number;
    afterCardFeeMinor: number;
    /** What one sale leaves if the owner is GST-registered (1/11 of the price is remitted). */
    afterCardFeeAndGstMinor: number;
    /** Sales at the assumed price needed to cover the startup cost, after card fees. null if a sale leaves nothing. */
    salesToCoverCost: number | null;
    notes: string[];
  };
  ownerActions: { order: number; title: string; ownerAction: string; hours: number; finishesInWeek: number }[];
  schedule: { totalHours: number; weeksToLaunch: number };
  notes: string[];
}

export type PreviewResult = { ok: true; preview: SelectionPreview } | { ok: false; errors: SelectionIssue[] };

export interface PreviewDeps { registry?: BlueprintRegistry }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Check the idea has the fields selection relies on, and find its blueprint. Never throws. */
export function resolveIdea(idea: unknown, registry: BlueprintRegistry = blueprintRegistry):
  { ok: true; idea: OpportunityIdea; blueprint: BlueprintDefinition; ideaId: string } | { ok: false; errors: SelectionIssue[] } {
  if (!isObj(idea)) return { ok: false, errors: [{ field: 'idea', message: 'Pick one of the ideas from the Opportunity Finder.' }] };
  const bp = idea.blueprint;
  const errors: SelectionIssue[] = [];
  if (!str(idea.niche)) errors.push({ field: 'niche', message: 'The idea needs a niche.' });
  if (!str(idea.whoToSellTo)) errors.push({ field: 'whoToSellTo', message: 'The idea needs to say who it is for.' });
  if (!isObj(bp) || !str(bp.id) || !str(bp.version)) errors.push({ field: 'blueprint', message: 'The idea needs a blueprint id and version.' });
  if (errors.length) return { ok: false, errors };
  const ref = bp as { id: string; version: string };
  const blueprint = registry.get(ref.id, ref.version);
  if (!blueprint) return { ok: false, errors: [{ field: 'blueprint', message: `Blueprint ${ref.id} version ${ref.version} is not available, so this idea cannot be selected.` }] };
  const typed = idea as unknown as OpportunityIdea;
  return { ok: true, idea: typed, blueprint, ideaId: ideaIdOf(typed) };
}

/** Starting inputs for an idea; every value except the price comes from the idea itself. */
export function defaultInputs(idea: OpportunityIdea): PlanInputs {
  return {
    niche: idea.niche,
    audience: idea.whoToSellTo,
    pricePointMinor: DEFAULT_PRICE_MINOR,
    weeklyHours: Math.min(40, Math.max(1, Math.round(idea.weeklyHours) || 1)),
    budgetMinor: Math.max(0, Math.round(idea.estimatedStartupCostMinor) || 0),
  };
}

/**
 * Build the preview. `inputs` are the owner's edits and are merged over the defaults (or the saved inputs).
 * Invalid ideas or inputs come back as plain-English issues; nothing is thrown.
 */
export function buildPreview(idea: unknown, inputs?: Record<string, unknown>, deps: PreviewDeps = {}): PreviewResult {
  const found = resolveIdea(idea, deps.registry);
  if (!found.ok) return found;
  const merged = { ...defaultInputs(found.idea), ...(inputs ?? {}) };
  const checked = validatePlanInputs(found.blueprint, merged);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const planned = generateLaunchPlan(found.blueprint, checked.inputs);
  if (!planned.ok) return { ok: false, errors: planned.errors };
  return { ok: true, preview: fromPlan(found.ideaId, found.blueprint, planned.plan) };
}

function fromPlan(ideaId: string, bp: BlueprintDefinition, plan: LaunchPlan): SelectionPreview {
  const price = Number(plan.inputs.pricePointMinor);
  const p = profit({ priceMinor: price, salesPerMonth: 0, planMinor: 0, gstRegistered: false });
  const pg = profit({ priceMinor: price, salesPerMonth: 0, planMinor: 0, gstRegistered: true });
  const total = plan.cost.totalMinor;
  const niche = String(plan.inputs.niche);
  return {
    ideaId,
    label: 'Sample preview built from a tested blueprint. Everything here can be edited, and nothing is published or charged until you approve it.',
    blueprint: { id: plan.blueprint.id, version: plan.blueprint.version },
    inputs: { ...plan.inputs },
    sampleProduct: {
      title: plan.product.title, summary: bp.summary, audience: plan.product.audience,
      formats: [...plan.product.formats], totalPages: plan.product.totalPages, sections: plan.product.sections.map((s) => ({ ...s })),
    },
    brand: { name: 'Your brand name (placeholder)', isPlaceholder: true, note: `Name, colours and logo are chosen with you later. Nothing for "${niche}" is registered or reserved.` },
    storefront: {
      isSketch: true,
      blocks: [
        { block: 'Header', shows: 'Brand name placeholder and a Shop link' },
        { block: 'Hero', shows: `${plan.product.title} for ${plan.product.audience}, with one Buy button` },
        { block: 'Product card', shows: `Cover image, ${plan.product.totalPages} pages, ${plan.product.formats.join(' + ')}, price ${aud(price)} (assumption)` },
        { block: 'What is inside', shows: plan.product.sections.map((s) => s.title).join(', ') },
        { block: 'Delivery and support', shows: plan.fulfilment.delivery },
      ],
      note: 'A rough sketch of the layout, not the finished design.',
    },
    costs: { lines: plan.cost.lines.map((l) => ({ ...l })), totalMinor: total, budgetMinor: plan.cost.budgetMinor, withinBudget: plan.cost.withinBudget, shortfallMinor: plan.cost.shortfallMinor },
    priceAssumptions: {
      label: 'Assumption, not a market finding: you set this price and can change it any time.',
      priceMinor: price,
      cardFeeMinor: cardFeeMinor(price),
      afterCardFeeMinor: p.perSaleMinor,
      afterCardFeeAndGstMinor: pg.perSaleMinor,
      salesToCoverCost: total === 0 ? 0 : p.perSaleMinor > 0 ? Math.ceil(total / p.perSaleMinor) : null,
      notes: [
        'Card fee uses the standard Australian domestic card rate; international cards cost more.',
        'This does not predict how many sales you will make.',
      ],
    },
    ownerActions: plan.steps.map((s) => ({ order: s.order, title: s.title, ownerAction: s.ownerAction, hours: s.hours, finishesInWeek: s.finishesInWeek })),
    schedule: { ...plan.schedule },
    notes: [...plan.notes],
  };
}

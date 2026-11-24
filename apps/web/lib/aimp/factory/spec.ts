// Structured product spec for the Product Factory (AMP-021): built from a blueprint, validated before rendering.
import type { BlueprintDefinition } from '../blueprints/index.ts';
import type { PaperSize } from './pdf.ts';

export const templateKinds = ['cover', 'howto', 'year-glance', 'month', 'week', 'checklist', 'tracker', 'prompts', 'notes'] as const;
export type TemplateKind = (typeof templateKinds)[number];

/** Plain-English noun used in listing claims, e.g. "12 monthly pages". */
export const templateLabel: Record<TemplateKind, string> = {
  cover: 'cover page',
  howto: 'how-to-use page',
  'year-glance': 'year-at-a-glance page',
  month: 'monthly page',
  week: 'weekly planner page',
  checklist: 'checklist page',
  tracker: 'habit tracker page',
  prompts: 'goals and reflection page',
  notes: 'notes page',
};

export interface SpecPage {
  template: TemplateKind;
  heading: string;
  subheading?: string;
  /** Paragraph lines (cover, how to use) or writing prompts (prompts template). */
  lines?: string[];
  /** Checklist items, tracker habits, or month names (year-glance). */
  items?: string[];
}
export interface SpecSection { title: string; pages: SpecPage[] }
export interface ListingClaim {
  id: string;
  /** Exactly what the listing says, e.g. "12 monthly pages". */
  text: string;
  template: TemplateKind;
  count: number;
}

export interface ProductSpec {
  specVersion: 1;
  blueprint: { id: string; version: string };
  title: string;
  subtitle: string;
  niche: string;
  audience: string;
  /** demo: fixture AI text and a DEMO mark on every page; live: real AI text. */
  mode: 'demo' | 'live';
  generatedAt: string;
  paperSizes: PaperSize[];
  sections: SpecSection[];
  claims: ListingClaim[];
  ai: { model: string; note: string };
}

export interface SpecValidation { ok: boolean; errors: string[] }

const MAX_PAGES = 200;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const allPages = (spec: ProductSpec): SpecPage[] => spec.sections.flatMap((s) => s.pages);

/** One claim per template used, counting every page of that template ("12 monthly pages"). */
export function deriveClaims(sections: readonly SpecSection[]): ListingClaim[] {
  const counts = new Map<TemplateKind, number>();
  for (const s of sections) for (const p of s.pages) counts.set(p.template, (counts.get(p.template) ?? 0) + 1);
  return templateKinds.filter((t) => counts.has(t)).map((t) => {
    const count = counts.get(t) as number;
    return { id: `claim-${t}`, text: plural(count, templateLabel[t]), template: t, count };
  });
}

/**
 * Validate a spec before rendering. Never throws. Checks the structure, that a cover leads the document,
 * that every claim matches the pages that exist, and (when given) that every blueprint section is present
 * with the promised page count.
 */
export function validateProductSpec(input: unknown, blueprint?: BlueprintDefinition): SpecValidation {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['The product spec must be an object.'] };
  const s = input;
  if (s.specVersion !== 1) errors.push('The spec version must be 1.');
  if (!isObj(s.blueprint) || !nonEmpty(s.blueprint.id) || !nonEmpty(s.blueprint.version)) errors.push('The spec must name its blueprint id and version.');
  if (!nonEmpty(s.title)) errors.push('The product needs a title.');
  if (!nonEmpty(s.subtitle)) errors.push('The product needs a subtitle.');
  if (!nonEmpty(s.niche) || !nonEmpty(s.audience)) errors.push('The product needs a niche and an audience.');
  if (s.mode !== 'demo' && s.mode !== 'live') errors.push('The mode must be demo or live.');
  if (!Array.isArray(s.paperSizes) || s.paperSizes.length === 0 || !s.paperSizes.every((p) => p === 'a4' || p === 'letter')) {
    errors.push('Choose at least one paper size: a4 or letter.');
  }
  if (!Array.isArray(s.sections) || s.sections.length === 0) {
    errors.push('The product needs at least one section.');
    return { ok: false, errors };
  }

  const pages: SpecPage[] = [];
  const titles: string[] = [];
  s.sections.forEach((raw, i) => {
    if (!isObj(raw) || !nonEmpty(raw.title)) { errors.push(`Section ${i + 1} needs a title.`); return; }
    titles.push(raw.title);
    if (!Array.isArray(raw.pages) || raw.pages.length === 0) { errors.push(`Section "${raw.title}" needs at least one page.`); return; }
    raw.pages.forEach((p, j) => {
      if (!isObj(p) || !templateKinds.includes(p.template as TemplateKind)) {
        errors.push(`Page ${j + 1} of "${raw.title}" must use one of these templates: ${templateKinds.join(', ')}.`);
        return;
      }
      if (!nonEmpty(p.heading)) { errors.push(`Page ${j + 1} of "${raw.title}" needs a heading.`); return; }
      for (const key of ['lines', 'items'] as const) {
        const v = p[key];
        if (v !== undefined && (!Array.isArray(v) || !v.every((x) => typeof x === 'string'))) errors.push(`Page ${j + 1} of "${raw.title}": ${key} must be a list of text.`);
      }
      if ((p.template === 'checklist' || p.template === 'tracker' || p.template === 'year-glance') && !(Array.isArray(p.items) && p.items.length > 0)) {
        errors.push(`Page ${j + 1} of "${raw.title}" uses the ${String(p.template)} template and needs items.`);
      }
      pages.push(p as unknown as SpecPage);
    });
  });
  if (pages.length > MAX_PAGES) errors.push(`The product has ${pages.length} pages; the limit is ${MAX_PAGES}.`);
  if (pages.length > 0 && pages[0]?.template !== 'cover') errors.push('The first page must be a cover page.');
  if (pages.length > 0 && pages.length < 2) errors.push('The product needs content pages after the cover.');

  if (!Array.isArray(s.claims) || s.claims.length === 0) {
    errors.push('The product needs listing claims.');
  } else {
    s.claims.forEach((raw, i) => {
      if (!isObj(raw) || !nonEmpty(raw.text) || !templateKinds.includes(raw.template as TemplateKind) || typeof raw.count !== 'number') {
        errors.push(`Listing claim ${i + 1} needs text, a template and a page count.`);
        return;
      }
      const have = pages.filter((p) => p.template === raw.template).length;
      if (have !== raw.count) errors.push(`The claim "${raw.text}" promises ${raw.count} page(s) but the spec has ${have}.`);
    });
  }

  if (blueprint) {
    if (isObj(s.blueprint) && (s.blueprint.id !== blueprint.id || s.blueprint.version !== blueprint.version)) {
      errors.push(`The spec was built for ${String(s.blueprint.id)}@${String(s.blueprint.version)}, not ${blueprint.id}@${blueprint.version}.`);
    }
    for (const bs of blueprint.output.sections) {
      const found = (s.sections as unknown[]).find((x) => isObj(x) && x.title === bs.title);
      if (!found) errors.push(`The required section "${bs.title}" is missing.`);
      else if (isObj(found) && Array.isArray(found.pages) && found.pages.length !== bs.pages) {
        errors.push(`The section "${bs.title}" has ${found.pages.length} page(s); the blueprint promises ${bs.pages}.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

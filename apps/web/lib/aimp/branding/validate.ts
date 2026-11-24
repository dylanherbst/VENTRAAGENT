// Brand validation (AMP-020). Every message is plain English and names the field. Pure; nothing is thrown for bad input.
import { coverStyles, type StoreFont, storeFonts } from '../storefront/schema.ts';
import { isClaimableStoreSlug } from '../storefront/tenant.ts';
import { AA_LARGE, AA_NORMAL, bestTextOn, contrastRatio, normaliseHex, ratioLabel } from './contrast.ts';
import { brandTones, type BrandIssue, type BrandPalette, type BrandProfile, type ContrastCheck } from './types.ts';

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const TAGLINE_MAX = 80;
export const SHORT_MAX = 160;
export const LONG_MAX = 600;

export const NAME_NOTICE = 'Names are suggestions only. Nothing is registered or checked against trademarks, so search for the name before you commit to it.';

const LEGAL_SUFFIX = /\s+(?:inc|incorporated|llc|ltd|limited|pty|corp|corporation|gmbh|plc|official)\.?$/i;
const MARKS = /[™®©℠]/g;
const PROMISE_SRC = String.raw`\b(?:earn|make)\s*\$\s*[\d,.]*\w*|\b(?:guarantee[ds]?|get rich|risk[- ]free|passive income|make money)\b`;
const PROMISE = new RegExp(PROMISE_SRC, 'i');

/** Remove phrases that promise income or guaranteed results, e.g. from opportunity text that is copied into listing copy. */
export function stripPromises(text: string): string {
  return text.replace(new RegExp(PROMISE_SRC, 'gi'), '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').replace(/^[\s,.;:!?-]+/, '').trim();
}

/** Tidy a business name: normalise, drop angle brackets and trademark symbols, collapse spaces. Does not remove legal suffixes (validation reports those). */
export function sanitiseName(raw: string): string {
  return raw.normalize('NFKC').replace(MARKS, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** Store address from a name: lower case letters and digits joined by single hyphens, 3 to 40 characters. */
export function slugify(name: string): string {
  const s = sanitiseName(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s;
}

export function nameIssues(name: unknown, field = 'name'): BrandIssue[] {
  if (typeof name !== 'string') return [{ field, message: 'Enter a business name.' }];
  const issues: BrandIssue[] = [];
  const t = name.trim();
  if (t.length < NAME_MIN) issues.push({ field, message: `The business name needs at least ${NAME_MIN} characters.` });
  if (t.length > NAME_MAX) issues.push({ field, message: `The business name is ${t.length} characters; the limit is ${NAME_MAX}.` });
  if (/[<>]/.test(t)) issues.push({ field, message: 'The business name cannot contain < or >.' });
  if (/[™®©℠]/.test(t)) issues.push({ field, message: 'Leave out the trademark symbols (TM, R, C). Only a registered mark may use them, and this tool registers nothing.' });
  if (LEGAL_SUFFIX.test(t)) issues.push({ field, message: 'Leave company endings such as Inc, LLC, Ltd, Pty or "Official" out of the name. They imply a registration you may not have.' });
  if (t.length >= NAME_MIN && !/[\p{L}\p{N}]/u.test(t)) issues.push({ field, message: 'The business name needs at least one letter or number.' });
  return issues;
}

export function slugIssues(slug: unknown): BrandIssue[] {
  if (typeof slug !== 'string' || !isClaimableStoreSlug(slug)) {
    return [{ field: 'slug', message: 'The store address must be 3 to 63 lower case letters, numbers or single hyphens, and not a reserved word such as "shop" or "admin".' }];
  }
  return [];
}

const LABELS: Record<ContrastCheck['id'], string> = {
  textOnBackground: 'Text on background',
  textOnPrimary: 'Text on primary colour (buttons)',
  accentOnBackground: 'Accent on background (icons and borders)',
};

/** The three contrast checks for a palette whose colours are valid hex. Text checks are required (4.5:1); the accent check is advice (3:1). */
export function contrastChecks(p: BrandPalette): ContrastCheck[] {
  const row = (id: ContrastCheck['id'], a: string, b: string, required: number, blocking: boolean): ContrastCheck => {
    const ratio = contrastRatio(a, b);
    return { id, label: LABELS[id], ratio, required, passed: ratio >= required, blocking };
  };
  return [
    row('textOnBackground', p.text, p.background, AA_NORMAL, true),
    row('textOnPrimary', p.onPrimary, p.primary, AA_NORMAL, true),
    row('accentOnBackground', p.accent, p.background, AA_LARGE, false),
  ];
}

const PALETTE_KEYS = ['primary', 'accent', 'background', 'text', 'onPrimary'] as const;
const KEY_LABEL: Record<(typeof PALETTE_KEYS)[number], string> = { primary: 'Primary colour', accent: 'Accent colour', background: 'Background colour', text: 'Text colour', onPrimary: 'Text-on-primary colour' };

/** Check a full palette. Returns plain-English issues; empty when every required contrast passes. */
export function paletteIssues(p: unknown): BrandIssue[] {
  if (typeof p !== 'object' || p === null) return [{ field: 'palette', message: 'The colour palette is missing.' }];
  const rec = p as Record<string, unknown>;
  const issues: BrandIssue[] = [];
  for (const k of PALETTE_KEYS) {
    if (normaliseHex(rec[k]) === null) issues.push({ field: `palette.${k}`, message: `${KEY_LABEL[k]} must be a hex colour like #1a2b3c.` });
  }
  if (issues.length) return issues;
  const pal = Object.fromEntries(PALETTE_KEYS.map((k) => [k, normaliseHex(rec[k])!])) as unknown as BrandPalette;
  for (const c of contrastChecks(pal)) {
    if (c.passed || !c.blocking) continue;
    const suggest = c.id === 'textOnBackground' ? ` Try ${bestTextOn(pal.background)} for the text.` : ` Try ${bestTextOn(pal.primary)} for the text on buttons.`;
    issues.push({
      field: c.id === 'textOnBackground' ? 'palette.text' : 'palette.onPrimary',
      message: `${c.label} is too faint to read: contrast ${ratioLabel(c.ratio)}:1, and ${c.required}:1 is the minimum.${suggest}`,
    });
  }
  return issues;
}

/** Normalise every palette colour to lower case six digit hex. Call only after paletteIssues returned nothing. */
export function normalisePalette(p: BrandPalette): BrandPalette {
  return { primary: normaliseHex(p.primary)!, accent: normaliseHex(p.accent)!, background: normaliseHex(p.background)!, text: normaliseHex(p.text)!, onPrimary: normaliseHex(p.onPrimary)! };
}

function textIssues(v: unknown, field: string, label: string, min: number, max: number): BrandIssue[] {
  if (typeof v !== 'string') return [{ field, message: `Enter the ${label}.` }];
  const t = v.trim();
  const out: BrandIssue[] = [];
  if (t.length < min) out.push({ field, message: `The ${label} needs at least ${min} characters.` });
  if (t.length > max) out.push({ field, message: `The ${label} is ${t.length} characters; the limit is ${max}.` });
  if (/[<>]/.test(t)) out.push({ field, message: `The ${label} cannot contain < or >.` });
  if (PROMISE.test(t)) out.push({ field, message: `The ${label} cannot promise income or guaranteed results.` });
  return out;
}

export type BrandFields = Pick<BrandProfile, 'name' | 'slug' | 'tone' | 'font' | 'palette' | 'tagline' | 'shortDescription' | 'longDescription' | 'visual'>;

/** Every problem with a full set of brand fields, so the owner can fix them in one go. Empty means it can be approved. */
export function brandIssues(f: BrandFields): BrandIssue[] {
  const out: BrandIssue[] = [...nameIssues(f.name), ...slugIssues(f.slug)];
  if (!(brandTones as readonly string[]).includes(f.tone)) out.push({ field: 'tone', message: `Pick a tone: ${brandTones.join(', ')}.` });
  if (!(storeFonts as readonly string[]).includes(f.font as StoreFont)) out.push({ field: 'font', message: 'Pick a font style: serif, sans or rounded.' });
  out.push(...paletteIssues(f.palette));
  out.push(...textIssues(f.tagline, 'tagline', 'tagline', 3, TAGLINE_MAX));
  out.push(...textIssues(f.shortDescription, 'shortDescription', 'short description', 10, SHORT_MAX));
  out.push(...textIssues(f.longDescription, 'longDescription', 'long description', 20, LONG_MAX));
  if (!f.visual || !(coverStyles as readonly string[]).includes(f.visual.coverStyle)) out.push({ field: 'coverStyle', message: `Pick a cover style: ${coverStyles.join(', ')}.` });
  if (f.visual && (!Array.isArray(f.visual.notes) || f.visual.notes.length > 6 || f.visual.notes.some((n) => typeof n !== 'string' || n.length > 200 || /[<>]/.test(n)))) {
    out.push({ field: 'visualNotes', message: 'Visual notes: up to 6 notes, each 200 characters or fewer, without < or >.' });
  }
  return out;
}

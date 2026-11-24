// Brand kit (screen 11, AMP-082; C01, C06). Pure helpers for the page: no React, no Next, no storage, so node:test loads them.
// Nothing here is a brand rule. Contrast, name similarity and the store settings all come from lib/aimp/branding; this file only
// arranges what those functions return for the screen.
import { toStorefrontBrand } from '../../../../lib/aimp/branding/adapters.ts';
import type { StorefrontBrand } from '../../../../lib/aimp/branding/adapters.ts';
import { normaliseHex } from '../../../../lib/aimp/branding/contrast.ts';
import { checkNameClash } from '../../../../lib/aimp/branding/name-clash.ts';
import type { NameClash } from '../../../../lib/aimp/branding/name-clash.ts';
import type { BrandEdits, BrandPalette, BrandProfile, BrandTone, ContrastCheck } from '../../../../lib/aimp/branding/types.ts';
import { contrastChecks } from '../../../../lib/aimp/branding/validate.ts';

export const colourKeys = ['primary', 'accent', 'background', 'text', 'onPrimary'] as const;
export type ColourKey = (typeof colourKeys)[number];
export const colourNames: Record<ColourKey, string> = {
  primary: 'Main colour', accent: 'Accent colour', background: 'Page background', text: 'Text colour', onPrimary: 'Text on the main colour',
};
export const toneNames: Record<BrandTone, string> = { warm: 'Warm', playful: 'Playful', calm: 'Calm', professional: 'Professional', bold: 'Bold' };
export const statusNames: Record<BrandProfile['status'], string> = { draft: 'Draft', approved: 'Approved', superseded: 'Replaced' };

export interface BrandForm {
  name: string; tagline: string; shortDescription: string; longDescription: string; tone: BrandTone;
  primary: string; accent: string; background: string; text: string; onPrimary: string;
}

export const toForm = (b: BrandProfile): BrandForm => ({
  name: b.name, tagline: b.tagline, shortDescription: b.shortDescription, longDescription: b.longDescription, tone: b.tone,
  primary: b.palette.primary, accent: b.palette.accent, background: b.palette.background, text: b.palette.text, onPrimary: b.palette.onPrimary,
});

/** The edits the brand service receives. The service validates every field; nothing is checked here. */
export const editsFromForm = (f: BrandForm): BrandEdits => ({
  name: f.name, tagline: f.tagline, shortDescription: f.shortDescription, longDescription: f.longDescription, tone: f.tone,
  palette: { primary: f.primary, accent: f.accent, background: f.background, text: f.text, onPrimary: f.onPrimary },
});

export const isDirty = (f: BrandForm, base: BrandProfile): boolean => JSON.stringify(f) !== JSON.stringify(toForm(base));

/** The five colours as hex, or null while any of them is not a hex colour yet. */
export function paletteFromForm(f: BrandForm): BrandPalette | null {
  const hex = colourKeys.map((k) => normaliseHex(f[k]));
  if (!hex.every(Boolean)) return null;
  return { primary: hex[0]!, accent: hex[1]!, background: hex[2]!, text: hex[3]!, onPrimary: hex[4]! };
}

export type BrandKitState = 'no_brand' | 'draft_only' | 'approved' | 'pending_approval';

export interface BrandKit {
  state: BrandKitState;
  versions: BrandProfile[];
  /** The version the owner edits: the open draft, otherwise the approved brand. Null when no brand exists. */
  latest: BrandProfile | null;
  approved: BrandProfile | null;
  draft: BrandProfile | null;
  /** What the store and listings take from the APPROVED brand. Null until a brand is approved; a draft never appears here. */
  live: StorefrontBrand | null;
  /** WCAG AA checks on the version being edited. */
  checks: ContrastCheck[];
  /** Name similarity for the version being edited (AMP-026). Not legal clearance. */
  clash: NameClash | null;
}

/** Everything the page shows, from the saved versions alone (oldest first, as the brand store lists them). */
export function describeBrandKit(versions: readonly BrandProfile[]): BrandKit {
  const list = [...versions];
  const approved = list.find((v) => v.status === 'approved') ?? null;
  const draft = list.find((v) => v.status === 'draft') ?? null;
  const latest = draft ?? approved ?? null;
  const state: BrandKitState = !latest ? 'no_brand' : draft && approved ? 'pending_approval' : draft ? 'draft_only' : 'approved';
  return {
    state, versions: list, latest, approved, draft,
    live: approved ? toStorefrontBrand(approved) : null,
    checks: latest ? contrastChecks(latest.palette) : [],
    clash: latest ? checkNameClash(latest.name) : null,
  };
}

export interface ImpactRow { id: string; label: string; from: string | null; to: string; changed: boolean }

const paletteText = (p: BrandPalette): string => colourKeys.map((k) => p[k]).join(' ');

/** Which store and listing values would change. `live` is what the store uses now (null when nothing is approved yet). */
export function impactRows(live: StorefrontBrand | null, next: StorefrontBrand): ImpactRow[] {
  const row = (id: string, label: string, pick: (s: StorefrontBrand) => string): ImpactRow => {
    const from = live ? pick(live) : null;
    const to = pick(next);
    return { id, label, from, to, changed: from !== to };
  };
  return [
    row('name', 'Business name', (s) => s.brand.name),
    row('slug', 'Store address', (s) => s.slug),
    row('tagline', 'Tagline and store headline', (s) => s.hero.heading),
    row('subheading', 'Store introduction', (s) => s.hero.subheading),
    row('theme', 'Store theme', (s) => s.brand.theme),
    row('font', 'Type style', (s) => s.brand.font),
    row('palette', 'Colours', (s) => paletteText(s.palette)),
    row('seo', 'Search result title', (s) => s.seo.title),
  ];
}

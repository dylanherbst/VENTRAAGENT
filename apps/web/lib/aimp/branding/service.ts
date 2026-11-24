// Brand approval and versioning (AMP-020). Status flow: draft -> approved -> superseded.
//  - One draft at a time per business, and exactly one approved brand per business.
//  - Editing an approved brand makes a NEW draft version; the approved one stays in use until the draft is approved.
//  - Every call is scoped to one workspace; another workspace's business looks the same as one that does not exist.
import { normaliseHex, bestTextOn } from './contrast.ts';
import { TONE_FONT, brandInputIssues, generateBrandOptions, scrubInput } from './generate.ts';
import { toProductPreviewBrand, toStorefrontBrand, type ProductPreviewBrand, type StorefrontBrand } from './adapters.ts';
import { SlugTakenError, type BrandStore } from './store.ts';
import { brandIssues, nameIssues, sanitiseName, slugify, type BrandFields } from './validate.ts';
import { brandTones, type BrandEdits, type BrandInput, type BrandIssue, type BrandPalette, type BrandProfile } from './types.ts';

const slugTakenIssue = (slug: string): BrandIssue => ({ field: 'slug', message: `The store address "${slug}" is already used by another business. Change the business name or the store address, then approve again.` });

export interface BrandDeps {
  store: BrandStore;
  /** Injected clock. */
  now: () => Date;
  /** Injected id source; defaults to crypto.randomUUID(). */
  newId?: () => string;
}
export interface BrandCtx { workspaceId: string }

export type BrandResult = { ok: true; brand: BrandProfile } | { ok: false; errors: BrandIssue[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
class Rejected extends Error {
  readonly issues: BrandIssue[];
  constructor(issues: BrandIssue[]) { super(issues.map((i) => i.message).join(' ')); this.issues = issues; }
}
const fail = (field: string, message: string): { ok: false; errors: BrandIssue[] } => ({ ok: false, errors: [{ field, message }] });
const NO_BRAND = 'No brand has been started for this business yet. Generate brand options first.';

function scopeIssue(ctx: BrandCtx, businessId: string): BrandIssue | null {
  if (typeof ctx?.workspaceId !== 'string' || !ID.test(ctx.workspaceId)) return { field: 'workspaceId', message: 'A workspace is needed to save a brand.' };
  if (typeof businessId !== 'string' || !ID.test(businessId)) return { field: 'businessId', message: 'A business is needed to save a brand.' };
  return null;
}
function iso(now: () => Date): string {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('now must return a valid Date');
  return d.toISOString();
}
async function run(fn: () => Promise<BrandResult>): Promise<BrandResult> {
  try { return await fn(); } catch (e) {
    if (e instanceof Rejected) return { ok: false, errors: e.issues };
    if (e instanceof SlugTakenError) return { ok: false, errors: [slugTakenIssue(e.slug)] };
    throw e;
  }
}
const t = (v: unknown): string => (typeof v === 'string' ? sanitiseName(v) : '');
const cleanInput = (i: BrandInput): BrandInput => ({
  niche: t(i.niche), audience: t(i.audience),
  ...(t(i.productType) ? { productType: t(i.productType) } : {}),
  ...(t(i.productTitle) ? { productTitle: t(i.productTitle) } : {}),
  ...(t(i.productSummary) ? { productSummary: t(i.productSummary) } : {}),
  ...(Array.isArray(i.formats) ? { formats: i.formats.map(t).filter(Boolean) } : {}),
  ...(typeof i.totalPages === 'number' && Number.isFinite(i.totalPages) ? { totalPages: i.totalPages } : {}),
});

/**
 * Start a brand for a business: generates the options and saves option `nameIndex` (default the first) as draft version 1
 * (or the next version number). Refuses when an unapproved draft already exists; edit that one instead.
 */
export async function createBrandDraft(deps: BrandDeps, ctx: BrandCtx, businessId: string, input: BrandInput, opts: { nameIndex?: number } = {}): Promise<BrandResult> {
  const s = scopeIssue(ctx, businessId);
  if (s) return { ok: false, errors: [s] };
  const pre = brandInputIssues(input);
  if (pre.length) return { ok: false, errors: pre };
  const clean = scrubInput(cleanInput(input));
  const gen = generateBrandOptions(clean);
  if (!gen.ok) return gen;
  const o = gen.options;
  const chosen = o.names[opts.nameIndex ?? 0];
  if (!chosen) return fail('nameIndex', `Pick a name from 1 to ${o.names.length}.`);
  const at = iso(deps.now);
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  return run(async () => deps.store.mutate(ctx.workspaceId, businessId, (versions) => {
    if (versions.some((v) => v.status === 'draft')) throw new Rejected([{ field: 'brand', message: 'This business already has a draft brand. Edit it or approve it instead of starting another.' }]);
    const brand: BrandProfile = {
      id: newId(), workspaceId: ctx.workspaceId, businessId, version: Math.max(0, ...versions.map((v) => v.version)) + 1, status: 'draft',
      name: chosen.name, slug: chosen.slug, tone: o.tone, font: o.font, palette: o.palette,
      tagline: o.listing.tagline, shortDescription: o.listing.shortDescription, longDescription: o.listing.longDescription,
      visual: o.visual, input: clean, createdAt: at, updatedAt: at, approvedAt: null, approvedBy: null,
    };
    const issues = brandIssues(brand);
    if (issues.length) throw new Rejected(issues);
    return { versions: [...versions, brand], result: { ok: true as const, brand } };
  }));
}

const EDITABLE = ['name', 'slug', 'tone', 'palette', 'tagline', 'shortDescription', 'longDescription', 'coverStyle', 'visualNotes'] as const;

/** `keepSlug`: the business has had an approved brand, so its store address stays put unless the owner changes it on purpose. */
function applyEdits(base: BrandProfile, edits: BrandEdits, keepSlug: boolean): BrandFields {
  const e = edits as Record<string, unknown>;
  const issues: BrandIssue[] = [];
  for (const k of Object.keys(e)) if (!(EDITABLE as readonly string[]).includes(k)) issues.push({ field: k, message: `"${k}" cannot be changed here.` });
  if (issues.length) throw new Rejected(issues);

  const name = e.name !== undefined ? (typeof e.name === 'string' ? sanitiseName(e.name) : '') : base.name;
  if (e.name !== undefined) { const ni = nameIssues(e.name); if (ni.length) throw new Rejected(ni); }
  const slug = e.slug !== undefined ? (e.slug as string) : e.name !== undefined && !keepSlug ? slugify(name) : base.slug;

  const palette: BrandPalette = { ...base.palette };
  if (e.palette !== undefined) {
    if (typeof e.palette !== 'object' || e.palette === null) throw new Rejected([{ field: 'palette', message: 'The colour palette must list colours like primary and text.' }]);
    const p = e.palette as Record<string, unknown>;
    for (const k of Object.keys(p)) {
      if (!Object.hasOwn(palette, k)) throw new Rejected([{ field: `palette.${k}`, message: `"${k}" is not a palette colour.` }]);
      const hex = normaliseHex(p[k]);
      // Keep what was typed when it is not valid hex, so validation can name the field; it never reaches storage.
      (palette as unknown as Record<string, unknown>)[k] = hex ?? p[k];
    }
    // Changing the primary colour without choosing a button text colour re-picks the readable one.
    if (p.primary !== undefined && p.onPrimary === undefined && normaliseHex(p.primary)) palette.onPrimary = bestTextOn(palette.primary);
  }
  if (e.tone !== undefined && !(brandTones as readonly string[]).includes(e.tone as string)) throw new Rejected([{ field: 'tone', message: `Pick a tone: ${brandTones.join(', ')}.` }]);
  const tone = (e.tone as BrandProfile['tone'] | undefined) ?? base.tone;
  return {
    name, slug, tone, font: e.tone !== undefined ? TONE_FONT[tone] : base.font, palette,
    tagline: e.tagline !== undefined ? (e.tagline as string) : base.tagline,
    shortDescription: e.shortDescription !== undefined ? (e.shortDescription as string) : base.shortDescription,
    longDescription: e.longDescription !== undefined ? (e.longDescription as string) : base.longDescription,
    visual: {
      ...base.visual,
      coverStyle: (e.coverStyle as BrandProfile['visual']['coverStyle'] | undefined) ?? base.visual.coverStyle,
      notes: e.visualNotes !== undefined ? (e.visualNotes as string[]) : [...base.visual.notes],
    },
  };
}

/**
 * Edit the brand. A draft is updated in place. If the latest version is approved, the edit creates a new draft version and
 * the approved one stays live until the new draft is approved. Nothing is saved if any field is invalid.
 * Pass `expectedVersion` (the version the owner was looking at) to refuse an edit when the brand has moved on.
 */
export async function editBrand(deps: BrandDeps, ctx: BrandCtx, businessId: string, edits: BrandEdits, opts: { expectedVersion?: number } = {}): Promise<BrandResult> {
  const s = scopeIssue(ctx, businessId);
  if (s) return { ok: false, errors: [s] };
  if (typeof edits !== 'object' || edits === null) return fail('edits', 'Nothing to change.');
  const at = iso(deps.now);
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  return run(async () => deps.store.mutate(ctx.workspaceId, businessId, (versions) => {
    if (!versions.length) throw new Rejected([{ field: 'brand', message: NO_BRAND }]);
    const latest = versions[versions.length - 1]!;
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== latest.version) {
      throw new Rejected([{ field: 'version', message: `The brand changed since you opened it (now version ${latest.version}, you had ${opts.expectedVersion}). Reload and try again.` }]);
    }
    const fields = applyEdits(latest, edits, versions.some((v) => v.approvedAt !== null));
    const issues = brandIssues(fields);
    if (issues.length) throw new Rejected(issues);
    const clean: BrandFields = { ...fields, palette: { primary: normaliseHex(fields.palette.primary)!, accent: normaliseHex(fields.palette.accent)!, background: normaliseHex(fields.palette.background)!, text: normaliseHex(fields.palette.text)!, onPrimary: normaliseHex(fields.palette.onPrimary)! }, name: fields.name.trim(), tagline: fields.tagline.trim(), shortDescription: fields.shortDescription.trim(), longDescription: fields.longDescription.trim() };
    // Saving with nothing changed writes nothing: no new version, no new draft, no updated time.
    const sig = (f: BrandFields) => JSON.stringify([f.name, f.slug, f.tone, f.font, f.palette, f.tagline, f.shortDescription, f.longDescription, f.visual]);
    if (sig(clean) === sig(latest)) return { versions, result: { ok: true as const, brand: latest } };
    if (latest.status === 'draft') {
      const brand: BrandProfile = { ...latest, ...clean, updatedAt: at };
      return { versions: [...versions.slice(0, -1), brand], result: { ok: true as const, brand } };
    }
    const brand: BrandProfile = {
      ...latest, ...clean, id: newId(), version: latest.version + 1, status: 'draft', createdAt: at, updatedAt: at, approvedAt: null, approvedBy: null,
    };
    return { versions: [...versions, brand], result: { ok: true as const, brand } };
  }));
}

/** Approve the open draft (owner action, so `approvedBy` is required). The previously approved version becomes superseded in the same step. */
export async function approveBrand(deps: BrandDeps, ctx: BrandCtx, businessId: string, approvedBy: string): Promise<BrandResult> {
  const s = scopeIssue(ctx, businessId);
  if (s) return { ok: false, errors: [s] };
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) return fail('approvedBy', 'Say who is approving this brand.');
  const at = iso(deps.now);
  // Early, friendly check; the store repeats it atomically inside mutate (SlugTakenError) so a race cannot slip through.
  const open = (await deps.store.list(ctx.workspaceId, businessId)).find((v) => v.status === 'draft');
  if (open && await deps.store.isSlugTaken(open.slug, { workspaceId: ctx.workspaceId, businessId })) return { ok: false, errors: [slugTakenIssue(open.slug)] };
  return run(async () => deps.store.mutate(ctx.workspaceId, businessId, (versions) => {
    if (!versions.length) throw new Rejected([{ field: 'brand', message: NO_BRAND }]);
    const draft = versions.find((v) => v.status === 'draft');
    if (!draft) throw new Rejected([{ field: 'brand', message: 'There is no draft to approve. This brand is already approved; edit it to start a new version.' }]);
    const issues = brandIssues(draft);
    if (issues.length) throw new Rejected(issues);
    const approved: BrandProfile = { ...draft, status: 'approved', approvedAt: at, approvedBy: approvedBy.trim(), updatedAt: at };
    const next = versions.map((v) => (v.id === draft.id ? approved : v.status === 'approved' ? { ...v, status: 'superseded' as const, updatedAt: at } : v));
    return { versions: next, result: { ok: true as const, brand: approved } };
  }));
}

/** The one approved brand for this business, or undefined. Other workspaces always get undefined. */
export async function getApprovedBrand(deps: Pick<BrandDeps, 'store'>, ctx: BrandCtx, businessId: string): Promise<BrandProfile | undefined> {
  if (scopeIssue(ctx, businessId)) return undefined;
  return (await deps.store.list(ctx.workspaceId, businessId)).find((v) => v.status === 'approved');
}

/** The open draft, if any. */
export async function getDraftBrand(deps: Pick<BrandDeps, 'store'>, ctx: BrandCtx, businessId: string): Promise<BrandProfile | undefined> {
  if (scopeIssue(ctx, businessId)) return undefined;
  return (await deps.store.list(ctx.workspaceId, businessId)).find((v) => v.status === 'draft');
}

/** Every saved version, oldest first. */
export async function listBrandVersions(deps: Pick<BrandDeps, 'store'>, ctx: BrandCtx, businessId: string): Promise<BrandProfile[]> {
  if (scopeIssue(ctx, businessId)) return [];
  return deps.store.list(ctx.workspaceId, businessId);
}

export interface ApprovedBrandOutputs { brand: BrandProfile; storefront: StorefrontBrand; productPreview: ProductPreviewBrand }

/** Store, product-preview and marketing settings for the APPROVED brand only. Drafts never leak into them. */
export async function getApprovedBrandOutputs(deps: Pick<BrandDeps, 'store'>, ctx: BrandCtx, businessId: string): Promise<ApprovedBrandOutputs | undefined> {
  const brand = await getApprovedBrand(deps, ctx, businessId);
  return brand ? { brand, storefront: toStorefrontBrand(brand), productPreview: toProductPreviewBrand(brand) } : undefined;
}

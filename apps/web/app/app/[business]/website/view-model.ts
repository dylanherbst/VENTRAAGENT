// Website Studio (screen 16, AMP-087). Pure view-model: turns what the AMP-031 site-version store returns (draft, history, public
// view) into the rows and labels the page shows. No store call and no rule about what may be published lives here; the store decides
// that. Kept free of React and Next so the node test runner can load it.
import type { DraftPreview, DraftView, HistoryView, PublicResolution, VersionSummary } from '../../../../lib/aimp/site-versions/store.ts';

export type SiteStatus = 'live' | 'paused' | 'draft';

/** Same limits as the storefront validator (lib/aimp/storefront/schema.ts). The store checks again when the draft is saved. */
export const FIELD_LIMITS = { heading: 90, subheading: 220, tagline: 120 } as const;
export type DraftField = keyof typeof FIELD_LIMITS;
export const FIELD_LABELS: Record<DraftField, string> = { heading: 'Headline', subheading: 'Text under the headline', tagline: 'Tagline' };
export type DraftForm = Record<DraftField, string>;
export const NOTE_MAX = 200;

export interface VersionRow {
  version: number;
  isLive: boolean;
  /** "Published" or "Brought back from version 2". */
  how: string;
  publishedAt: string;
  publishedLabel: string;
  by: string;
  note: string;
  canRollBack: boolean;
}

import { sampleFrom } from '../../../../lib/aimp/storefront/preview-sample.ts';
import type { LookSample } from '../../../../lib/aimp/storefront/preview-sample.ts';

export interface WebsiteModel {
  slug: string;
  status: SiteStatus;
  statusLabel: string;
  statusText: string;
  liveVersion: number | null;
  draft: DraftForm & { revision: number; productCount: number; hasUnpublishedChanges: boolean; updatedLabel: string; stateLabel: string };
  publish: { allowed: boolean; reason: string };
  /** The look now on the draft: template id, custom accent (or null), whether a logo is set. */
  look: { template: string | null; accent: string | null; hasLogo: boolean; sample: LookSample };
  versions: VersionRow[];
  /** Why there is nothing to go back to, or '' when at least one earlier version can be restored. */
  rollbackNote: string;
}

export const NOTHING_NEW = 'Your draft is the same as the live version, so there is nothing new to publish.';
export const NOTHING_PUBLISHED = 'Nothing has been published yet, so there is nothing to go back to.';
export const NOTHING_EARLIER = 'Only one version has been published, so there is no earlier version to go back to.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** A fixed, timezone-free label ("15 Nov 2026, 09:30 UTC") so the server and the browser print the same text. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Notes written by the automatic publish check carry a marker for the machine; owners do not need to see it. */
export const cleanNote = (note: string): string => note.replace('[publish-check]', '').trim();

export function whoLabel(userId: string, currentUserId: string): string {
  return userId === currentUserId ? 'You' : userId;
}

export function buildVersionRow(v: VersionSummary, liveVersion: number | null, currentUserId: string): VersionRow {
  const isLive = v.version === liveVersion;
  return {
    version: v.version, isLive,
    how: v.source.kind === 'rollback' ? `Brought back from version ${v.source.fromVersion}` : 'Published',
    publishedAt: v.publishedAt, publishedLabel: whenLabel(v.publishedAt), by: whoLabel(v.publishedBy, currentUserId), note: cleanNote(v.note),
    canRollBack: !isLive,
  };
}

export function siteStatus(history: Pick<HistoryView, 'liveVersion' | 'paused'>, publicView: PublicResolution): SiteStatus {
  if (history.liveVersion === null) return 'draft';
  if (history.paused || publicView.status === 'paused') return 'paused';
  return 'live';
}

const STATUS_COPY: Record<SiteStatus, { label: string; text: (live: number | null) => string }> = {
  live: { label: 'Live', text: (v) => `Version ${v} is the live version in this demo. Changes to your draft stay private until you publish.` },
  paused: { label: 'Paused', text: (v) => `Your store is paused, so visitors would see a "temporarily unavailable" page. Version ${v} comes back when you resume it in guided set-up.` },
  draft: { label: 'Not published', text: () => 'Your store is a private draft. Nobody can see it until you publish.' },
};

export function buildWebsiteModel(input: { slug: string; draft: DraftView; history: HistoryView; publicView: PublicResolution; currentUserId: string }): WebsiteModel {
  const { slug, draft, history, publicView, currentUserId } = input;
  const status = siteStatus(history, publicView);
  const versions = history.versions.map((v) => buildVersionRow(v, history.liveVersion, currentUserId));
  const canPublish = draft.hasUnpublishedChanges;
  return {
    slug, status, statusLabel: STATUS_COPY[status].label, statusText: STATUS_COPY[status].text(history.liveVersion), liveVersion: history.liveVersion,
    draft: {
      heading: draft.config.hero.heading, subheading: draft.config.hero.subheading, tagline: draft.config.brand.tagline,
      revision: draft.revision, productCount: draft.config.products.length, hasUnpublishedChanges: draft.hasUnpublishedChanges,
      updatedLabel: whenLabel(draft.updatedAt),
      stateLabel: history.liveVersion === null ? 'Not published yet' : draft.hasUnpublishedChanges ? 'Has changes that are not published' : 'Same as the live version',
    },
    look: { template: draft.config.brand.template ?? null, accent: draft.config.brand.accent ?? null, hasLogo: Boolean(draft.config.brand.logo),
      sample: sampleFrom(draft.config) },
    publish: { allowed: canPublish, reason: canPublish ? '' : NOTHING_NEW },
    versions,
    rollbackNote: versions.length === 0 ? NOTHING_PUBLISHED : versions.length === 1 ? NOTHING_EARLIER : '',
  };
}

/** Plain-English problems with what was typed, by field. Empty object = fine to send. */
export function checkDraftForm(form: DraftForm): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  for (const f of Object.keys(FIELD_LIMITS) as DraftField[]) {
    const v = form[f].trim();
    if (!v) out[f] = `${FIELD_LABELS[f]} cannot be empty.`;
    else if (v.length > FIELD_LIMITS[f]) out[f] = `${FIELD_LABELS[f]} can be at most ${FIELD_LIMITS[f]} characters. It is ${v.length}.`;
    else if (/[<>]/.test(v)) out[f] = `${FIELD_LABELS[f]} cannot contain the < or > characters.`;
  }
  return out;
}

export const isDirty = (form: DraftForm, saved: DraftForm): boolean => form.heading !== saved.heading || form.subheading !== saved.subheading || form.tagline !== saved.tagline;

export function publishConfirm(m: Pick<WebsiteModel, 'liveVersion' | 'status'>): { title: string; text: string } {
  if (m.liveVersion === null) return { title: 'Publish your store?', text: 'Your draft becomes version 1, the live version of your store in this demo.' };
  return {
    title: 'Publish these changes?',
    text: `Your draft replaces version ${m.liveVersion} as the live version. Version ${m.liveVersion} stays in your history, so you can go back to it.${m.status === 'paused' ? ' Your store is paused, so visitors will not see it until you resume the store.' : ''}`,
  };
}

export function rollbackConfirm(target: number, liveVersion: number | null): { title: string; text: string } {
  return {
    title: `Go back to version ${target}?`,
    text: `Version ${target} is published again as a new version and replaces version ${liveVersion ?? 'none'} as the live one. Nothing is deleted, and your draft is not changed.`,
  };
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

export interface PreviewModel {
  revision: number;
  brandName: string;
  tagline: string;
  eyebrow: string;
  heading: string;
  subheading: string;
  ctaLabel: string;
  products: { key: string; title: string; summary: string; price: string }[];
}

/** The small, plain-data part of a draft preview that the page draws. */
export function buildPreview(p: DraftPreview): PreviewModel {
  const c = p.config;
  return {
    revision: p.revision, brandName: c.brand.name, tagline: c.brand.tagline, eyebrow: c.hero.eyebrow, heading: c.hero.heading, subheading: c.hero.subheading, ctaLabel: c.hero.ctaLabel,
    products: c.products.map((x, i) => ({ key: `${i}-${x.title}`, title: x.title, summary: x.summary, price: aud.format(x.priceMinor / 100) })),
  };
}

export const websiteHref = (businessId: string): string => `/app/${businessId}/website`;

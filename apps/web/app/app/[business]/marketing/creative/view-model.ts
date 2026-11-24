// Display model for the Creative Studio review queue (screen 26, AMP-130; F02 F05 F06 F12 C06). Pure: it only re-words the asset
// records the campaign-assets service (lib/aimp/campaign-assets, AMP-051) returns. Which fields may be edited comes from the service's
// own `editableFields`; nothing about limits or claim rules is decided here. No number is invented: counts are counted from the set.
// This release writes text drafts only. Nothing here says, or may say, that anything was posted, scheduled or published.
import { editableFields } from '../../../../../lib/aimp/campaign-assets/service.ts';
import { MAX_REGENERATIONS } from '../../../../../lib/aimp/campaign-assets/types.ts';
import type { AssetKind, AssetRecord, AssetSet, AssetState } from '../../../../../lib/aimp/campaign-assets/types.ts';
import type { CampaignRecord } from '../../../../../lib/aimp/campaigns/types.ts';
import { CHANNEL_LABELS, dayLabel } from '../view-model.ts';

export const NOTHING_POSTED = 'Nothing is posted, scheduled or sent from here. These are text drafts for you to read; you post by hand.';
export const NOT_IN_DEMO = 'Creative Studio is not available in the demo yet.';

export const KIND_LABELS: Readonly<Record<AssetKind, string>> = { pin: 'Pinterest Pin', caption: 'Caption', video_script: 'Short video script', seo: 'Search listing text' };
export const STATE_LABELS: Readonly<Record<AssetState, string>> = { draft: 'Needs your review', approved: 'Approved', rejected: 'Rejected' };

type FieldType = 'text' | 'list' | 'number';
const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title', description: 'Description', altText: 'Image description for screen readers', board: 'Board', imageBrief: 'Image idea', keywords: 'Keywords',
  variants: 'Caption options', hook: 'Opening line', beats: 'Scenes', callToAction: 'Closing line', onScreenText: 'Text on screen',
  targetLengthSeconds: 'Length in seconds', pageTitle: 'Page title', metaDescription: 'Search description',
};

export interface AssetField {
  name: string;
  label: string;
  type: FieldType;
  /** What the edit form starts from: the text itself, a list as one item per line, or a number as text. */
  value: string;
  /** The same content for reading: one entry for text and numbers, one per item for a list. */
  lines: string[];
}
export interface AssetView {
  id: string;
  kind: AssetKind;
  kindLabel: string;
  productTitle: string;
  channelLabel: string;
  state: AssetState;
  stateLabel: string;
  /** Sent back with every action, so a decision on text that has since changed is refused. */
  revision: number;
  /** Limit and claim problems found by the service. An asset with any can not be approved. */
  problems: string[];
  canApprove: boolean;
  rejectionReason: string | null;
  regenerationsLeft: number;
  fields: AssetField[];
  /** Read-only details copied from the plan: the link, the suggested date, the image size. */
  facts: { label: string; value: string }[];
  updatedLabel: string;
}

export type CreativeModel =
  /** No approved campaign. `plan` says whether a draft is waiting for approval or there is no plan at all. */
  | { state: 'no_campaign'; plan: 'none' | 'draft' }
  | { state: 'no_assets'; campaignId: string; campaignVersion: number }
  | {
    state: 'assets'; campaignId: string; campaignVersion: number;
    /** False when the plan has a newer approved version than these assets were made from. They can be read but not changed. */
    current: boolean;
    madeFromVersion: number;
    counts: Record<AssetState, number>;
    assets: AssetView[];
  };

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function fieldsOf(a: AssetRecord): AssetField[] {
  const content = a.content as unknown as Record<string, unknown>;
  return Object.entries(editableFields[a.kind]).map(([name, type]) => {
    const raw = own(content, name) ? content[name] : undefined;
    const lines = type === 'list' ? (Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []) : [type === 'number' ? (typeof raw === 'number' ? String(raw) : '') : typeof raw === 'string' ? raw : ''];
    return { name, label: FIELD_LABELS[name] ?? name, type, value: lines.join('\n'), lines };
  });
}

function factsOf(a: AssetRecord): { label: string; value: string }[] {
  const c = a.content as unknown as Record<string, unknown>;
  const facts: { label: string; value: string }[] = [];
  const link = typeof c.destinationUrl === 'string' ? c.destinationUrl : typeof c.url === 'string' ? c.url : '';
  if (link) facts.push({ label: 'Link it points to', value: link });
  if (typeof c.publishDate === 'string') facts.push({ label: 'Suggested day to post', value: dayLabel(c.publishDate) });
  if (a.kind === 'pin') {
    const spec = (a as AssetRecord<'pin'>).content.imageSpec;
    facts.push({ label: 'Image size to make', value: `${spec.width} x ${spec.height} pixels (${spec.aspect})` });
  }
  return facts;
}

export function buildAssetView(a: AssetRecord, campaign: CampaignRecord): AssetView {
  const item = campaign.plan.items.find((i) => i.id === a.itemId);
  const problems = [...a.limitIssues.map((i) => i.message), ...a.claimFlags.map((f) => f.message)];
  return {
    id: a.id, kind: a.kind, kindLabel: KIND_LABELS[a.kind],
    productTitle: item?.productTitle ?? 'Unknown product',
    channelLabel: a.kind === 'seo' ? 'Your store page' : item ? CHANNEL_LABELS[item.channel] : '',
    state: a.state, stateLabel: STATE_LABELS[a.state], revision: a.revision,
    problems, canApprove: a.state === 'draft' && problems.length === 0,
    rejectionReason: a.rejectionReason,
    regenerationsLeft: Math.max(0, MAX_REGENERATIONS - a.attempt),
    fields: fieldsOf(a), facts: factsOf(a), updatedLabel: dayLabel(a.updatedAt),
  };
}

const ORDER: Readonly<Record<AssetState, number>> = { draft: 0, rejected: 1, approved: 2 };

/** The queue: what still needs a decision first, then rejected, then approved. Order inside each group is the plan's own. */
export function buildAssetsModel(set: AssetSet, campaign: CampaignRecord, current: boolean): Extract<CreativeModel, { state: 'assets' }> {
  const counts: Record<AssetState, number> = { draft: 0, approved: 0, rejected: 0 };
  for (const a of set.assets) counts[a.state] += 1;
  const assets = set.assets.map((a, i) => ({ a, i })).sort((x, y) => ORDER[x.a.state] - ORDER[y.a.state] || x.i - y.i).map(({ a }) => buildAssetView(a, campaign));
  return { state: 'assets', campaignId: campaign.id, campaignVersion: campaign.version, current, madeFromVersion: set.campaignVersion, counts, assets };
}

/**
 * The edit to send: only the fields whose text really changed. A list is one item per line; blank lines are dropped.
 * A number that is not a whole number is reported instead of being guessed. An empty result means nothing changed.
 */
export function buildPatch(fields: readonly AssetField[], values: Readonly<Record<string, string>>): { ok: true; patch: Record<string, string | number | string[]> } | { ok: false; field: string; message: string } {
  const out: [string, string | number | string[]][] = [];
  for (const f of fields) {
    const typed = own(values, f.name) ? values[f.name] : undefined;
    if (typeof typed !== 'string') continue;
    if (f.type === 'list') {
      const items = typed.split('\n').map((s) => s.trim()).filter(Boolean);
      if (items.join('\n') !== f.lines.join('\n')) out.push([f.name, items]);
    } else if (f.type === 'number') {
      if (typed.trim() === f.value) continue;
      const n = Number(typed.trim());
      if (typed.trim() === '' || !Number.isInteger(n)) return { ok: false, field: f.name, message: `${f.label} needs a whole number.` };
      out.push([f.name, n]);
    } else if (typed !== f.value) out.push([f.name, typed]);
  }
  return { ok: true, patch: Object.fromEntries(out) };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const draftsLabel = (n: number): string => plural(n, 'draft', 'drafts');
export function countsLine(c: Record<AssetState, number>): string {
  return `${c.draft} to review, ${c.approved} approved, ${c.rejected} rejected.`;
}
export function regenerateConfirm(a: Pick<AssetView, 'state' | 'kindLabel'>): { title: string; text: string } {
  return {
    title: 'Write this again?',
    text: a.state === 'approved'
      ? `This replaces the approved ${a.kindLabel} text with a new draft. The new draft needs your approval again. The old text is kept in its history.`
      : `This replaces the ${a.kindLabel} text with a new draft. The old text is kept in its history.`,
  };
}

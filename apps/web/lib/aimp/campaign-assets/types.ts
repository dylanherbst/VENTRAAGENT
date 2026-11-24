// Campaign assets (AMP-051, F02 F07 S05). An APPROVED campaign plan (AMP-050) is turned into asset drafts, one set per content-plan
// item: a Pinterest Pin, caption variants, a short-video script and SEO copy. Each asset goes through a review queue
// (draft -> approved | rejected). Only approved assets can be exported. Nothing here publishes anything or calls an outside service.
import type { CampaignContentItem, CampaignSeoTheme, CampaignRecord, CampaignStore, LaunchCampaignPlan } from '../campaigns/types.ts';

export const assetKinds = ['pin', 'caption', 'video_script', 'seo'] as const;
export type AssetKind = (typeof assetKinds)[number];

/** Hard limits. Pinterest: title 100, description 500, alt text 500. Search snippets: title 60, description 160. */
export const LIMITS = {
  pinTitle: 100, pinDescription: 500, pinAltText: 500, pinBoard: 100, imageBrief: 600, keywordsMax: 10, keywordMax: 40,
  captionVariantsMin: 1, captionVariantsMax: 5, captionMax: 2200,
  videoHook: 150, videoBeatsMin: 3, videoBeatsMax: 8, videoBeat: 240, videoCta: 150, onScreenMax: 6, onScreenLine: 60, videoSecondsMin: 5, videoSecondsMax: 90,
  seoTitle: 60, seoDescription: 160,
} as const;

/**
 * Hard caps on what an edit may store. These are far above the display limits in LIMITS (which only raise a too_long flag), so an
 * ordinary over-long edit is still saved and flagged, but a runaway paste is refused and nothing is stored or written to history.
 */
export const EDIT_CAPS = {
  /** Longest text value (or list item) accepted in one field. */
  fieldChars: 5000,
  /** Most items accepted in one list field. */
  listItems: 50,
  /** Most characters accepted across all fields of one edit. */
  totalChars: 20000,
} as const;

/** How many times one asset may be regenerated (attempt 0 is the first draft). After this, edit it by hand. */
export const MAX_REGENERATIONS = 5;

export const PIN_IMAGE ={ width: 1000, height: 1500, aspect: '2:3' } as const;

export interface PinContent {
  title: string;
  description: string;
  altText: string;
  destinationUrl: string;
  board: string;
  imageBrief: string;
  imageSpec: { width: 1000; height: 1500; aspect: '2:3'; fileName: string; textOverlay: string };
  /** YYYY-MM-DD, from the plan's schedule. */
  publishDate: string;
  keywords: string[];
}
export interface CaptionContent { variants: string[]; destinationUrl: string; publishDate: string }
export interface VideoScriptContent {
  hook: string;
  beats: string[];
  callToAction: string;
  onScreenText: string[];
  targetLengthSeconds: number;
  destinationUrl: string;
  publishDate: string;
}
export interface SeoContent { pageTitle: string; metaDescription: string; keywords: string[]; url: string }

export interface ContentByKind { pin: PinContent; caption: CaptionContent; video_script: VideoScriptContent; seo: SeoContent }
export type AssetContent = ContentByKind[AssetKind];

export type AssetState = 'draft' | 'approved' | 'rejected';

export interface LimitIssue { field: string; code: 'missing' | 'too_long' | 'too_short' | 'bad_value'; message: string }
export interface ClaimFlag { field: string; ruleId: string; message: string }

export type HistoryAction = 'generated' | 'edited' | 'regenerated' | 'approved' | 'rejected';
export interface AssetHistoryEntry {
  at: string;
  actor: string;
  action: HistoryAction;
  reason?: string;
  /** The content before an edit or regeneration replaced it. */
  before?: AssetContent;
  /** Content revision after this entry. */
  revision: number;
}

export interface AssetRecord<K extends AssetKind = AssetKind> {
  /** `<content item id>:<kind>`, unique within a campaign. */
  id: string;
  itemId: string;
  kind: K;
  state: AssetState;
  content: ContentByKind[K];
  /** Raised on every content change; used to refuse a decision made on text that has since changed. */
  revision: number;
  /** How many times the generator has been asked for this asset (0 = first draft). */
  attempt: number;
  /** Which generator wrote the current content, e.g. `template-v1`. */
  generator: string;
  limitIssues: LimitIssue[];
  claimFlags: ClaimFlag[];
  rejectionReason: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  history: AssetHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetSet {
  workspaceId: string;
  businessId: string;
  campaignId: string;
  /** The campaign version these assets were made from. */
  campaignVersion: number;
  assets: AssetRecord[];
}

/** A set kept after a new campaign version replaced it. Read-only: it is never the current set and is never exported. */
export interface ArchivedAssetSet extends AssetSet {
  archivedAt: string;
  /** The campaign version whose new asset set replaced this one. */
  supersededByVersion: number;
}

/** Storage seam: this memory store now, a database table later. Each method is atomic per (workspace, business, campaign). */
export interface AssetStore {
  readonly kind: 'memory' | 'database';
  get(workspaceId: string, businessId: string, campaignId: string): Promise<AssetSet | null>;
  /** Archived sets for the campaign, oldest first. Copies: changing them changes nothing. */
  archived(workspaceId: string, businessId: string, campaignId: string): Promise<ArchivedAssetSet[]>;
  /**
   * Run `change` on the current set and save what it returns. If it returns `archive`, that set is added to the archive in the same
   * atomic step. A throw saves nothing and propagates.
   */
  mutate<T>(workspaceId: string, businessId: string, campaignId: string, change: (current: AssetSet | null) => { set: AssetSet | null; result: T; archive?: ArchivedAssetSet }): Promise<T>;
}

export interface GenerateInput<K extends AssetKind = AssetKind> {
  kind: K;
  item: CampaignContentItem;
  plan: LaunchCampaignPlan;
  theme: CampaignSeoTheme | null;
  /** 0 for the first draft, raised by one each regeneration so a generator can vary its wording. */
  attempt: number;
}
/** The seam where a real model plugs in later. Its output is validated exactly like the template's: it is never trusted. */
export interface AssetGenerator {
  id: string;
  generate<K extends AssetKind>(input: GenerateInput<K>): Promise<ContentByKind[K]>;
}

export type AssetIssueCode =
  | 'invalid' | 'scope' | 'not_found' | 'campaign_not_approved' | 'stale' | 'wrong_state' | 'approved_asset'
  | 'needs_fixes' | 'nothing_approved' | 'links_not_absolute' | 'generator_failed' | 'too_large' | 'attempt_limit' | 'in_progress';
export interface AssetIssue { code: AssetIssueCode; message: string; field?: string }
export type AssetResult<T> = ({ ok: true } & T) | { ok: false; errors: AssetIssue[] };

export interface AssetScope { workspaceId: string; businessId: string }

export interface AssetDeps {
  /** Read-only view of the campaign store. */
  campaigns: Pick<CampaignStore, 'get'>;
  assets: AssetStore;
  generator: AssetGenerator;
  now: () => Date;
  /** Publishing account state. Only `not_connected` exists today: nothing in this module publishes. */
  publishing?: 'not_connected';
}

export type ApprovedCampaign = CampaignRecord;

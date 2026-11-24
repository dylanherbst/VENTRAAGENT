// Launch campaign types (AMP-050). A campaign is a PLAN only: who it is for, which channel, the content pillars, and a dated
// list of content items. Each item names exactly one real, approved catalogue listing and carries the link, price and copy
// brief that AMP-051 turns into a Pin, image, caption or script, and AMP-052 schedules. Nothing here posts anything.
import type { BrandProfile, BrandTone } from '../branding/types.ts';
import type { CatalogueListing, Currency } from '../catalogue/types.ts';
import type { SeoEnv } from '../hosts/seo.ts';

/** Pinterest is the launch channel. The others are export-only: the plan writes the brief, the merchant posts by hand. */
export const campaignChannels = ['pinterest', 'instagram', 'tiktok'] as const;
export type CampaignChannel = (typeof campaignChannels)[number];
export const PRIMARY_CHANNEL: CampaignChannel = 'pinterest';

export const contentFormats = ['pin_image', 'caption', 'video_script'] as const;
export type ContentFormat = (typeof contentFormats)[number];

/** Which format each channel may carry. */
export const channelFormats: Readonly<Record<CampaignChannel, readonly ContentFormat[]>> = {
  pinterest: ['pin_image'],
  instagram: ['caption'],
  tiktok: ['video_script'],
};

export const pillarIds = ['problem', 'inside', 'how_to', 'launch'] as const;
export type PillarId = (typeof pillarIds)[number];

export interface CampaignPillar { id: PillarId; title: string; summary: string }

export interface CampaignAudience {
  /** Who the campaign talks to, from the approved brand. */
  who: string;
  /** The everyday problem the products help with. A hypothesis, never a promised outcome. */
  problem: string;
  /** Where these people already look for this kind of product. */
  whereTheyAre: string[];
}

/** The store the campaign sends people to. `env` holds only the two public domain settings the storefront itself reads. */
export interface CampaignStoreRef {
  slug: string;
  /** Same three answers as the store registry: only a live store can be linked to. */
  status: 'live' | 'paused' | 'none';
  env?: SeoEnv;
}

/** The listing fields a campaign reads. A full CatalogueListing row satisfies this. */
export type CampaignListing = Pick<
  CatalogueListing,
  'listingId' | 'workspaceId' | 'businessId' | 'productId' | 'version' | 'status' | 'title' | 'shortDescription' | 'longDescription' | 'cover' | 'priceMinor' | 'currency'
>;

/** One piece of content to make. This is the unit AMP-051 consumes. */
export interface CampaignContentItem {
  /** Stable within a plan: `d<day>-<channel>`. */
  id: string;
  /** The one catalogue listing this item sells. */
  listingId: string;
  /** The listing version the copy and price were read from. */
  listingVersion: number;
  /** The listing title, exactly as approved. */
  productTitle: string;
  channel: CampaignChannel;
  format: ContentFormat;
  /** True when the merchant posts this by hand (every channel except the primary one). */
  exportOnly: boolean;
  pillarId: PillarId;
  /** The creative direction for whoever (or whatever) makes the asset. */
  angle: string;
  /** The headline. */
  hook: string;
  /** Supporting copy. Only says what the listing says. */
  description: string;
  callToAction: string;
  /** The listing's storefront product URL for this store. */
  targetUrl: string;
  /** Attribution labels for later UTM tagging. Kept apart from targetUrl so the link stays the canonical product URL. */
  attribution: { source: CampaignChannel; medium: 'organic'; campaign: string };
  priceMinor: number;
  currency: Currency;
  /** The price as shown to people, e.g. "A$14". */
  priceLabel: string;
  /** 1-based day in the launch window. */
  day: number;
  /** Calendar date (UTC), YYYY-MM-DD. */
  scheduledDate: string;
}

/** A search theme for Pinterest and SEO: what people type, the keywords to use, and the board the pins belong on. */
export interface CampaignSeoTheme {
  theme: string;
  keywords: string[];
  pinterestBoard: string;
}

export interface CampaignScheduleDay { day: number; date: string; itemIds: string[] }
export interface CampaignSchedule {
  /** YYYY-MM-DD (UTC). */
  startDate: string;
  endDate: string;
  windowDays: number;
  /** One entry per day of the window, in order; a quiet day has no item ids. */
  days: CampaignScheduleDay[];
}

export interface LaunchCampaignPlan {
  workspaceId: string;
  businessId: string;
  store: { slug: string };
  /** Copied from the APPROVED brand. */
  brand: { id: string; version: number; name: string; tone: BrandTone };
  audience: CampaignAudience;
  primaryChannel: CampaignChannel;
  secondaryChannels: { channel: CampaignChannel; mode: 'export_only' }[];
  pillars: CampaignPillar[];
  /** Pinterest and SEO themes built from the niche, the audience and the real listing titles. */
  seoThemes: CampaignSeoTheme[];
  items: CampaignContentItem[];
  schedule: CampaignSchedule;
  /** `llm` only when model copy was applied AND passed the same validation as the built-in plan. */
  source: 'deterministic' | 'llm';
  generatedAt: string;
}

export type CampaignIssueCode =
  | 'invalid' | 'scope' | 'brand_not_approved' | 'store_not_live' | 'no_listings'
  | 'listing_unknown' | 'listing_not_sellable' | 'listing_other_tenant' | 'listing_mismatch'
  | 'link_mismatch' | 'price_mismatch' | 'brand_mismatch' | 'claim' | 'schedule'
  | 'not_found' | 'stale' | 'not_draft' | 'store_mismatch';

export interface CampaignIssue { field: string; code: CampaignIssueCode; message: string }

export interface LaunchCampaignInput {
  workspaceId: string;
  businessId: string;
  /** The approved brand for this business. Missing or not approved means no campaign. */
  brand: BrandProfile | null | undefined;
  /** Catalogue listings. Only approved listings with a cover, in this workspace and business, are used. */
  listings: readonly CampaignListing[];
  store: CampaignStoreRef;
  /** Injected clock; used for `generatedAt` and, when no startDate is given, the first day of the window. */
  now: () => Date;
  /** First day of the launch window, YYYY-MM-DD (UTC). */
  startDate?: string;
  /** Length of the launch window. Default 30. */
  windowDays?: number;
}

/** What validation checks a plan against: the real brand, listings and store, never the plan's own claims about them. */
export interface CampaignContext {
  workspaceId: string;
  businessId: string;
  brand: BrandProfile | null | undefined;
  listings: readonly CampaignListing[];
  store: CampaignStoreRef;
}

export type EnrichmentStatus =
  | { status: 'not_requested' }
  | { status: 'applied'; model: string; fixture: boolean }
  | { status: 'fallback'; reason: string; issues: CampaignIssue[] };

export type LaunchCampaignResult =
  | { ok: true; plan: LaunchCampaignPlan; enrichment: EnrichmentStatus }
  | { ok: false; errors: CampaignIssue[] };

export type CampaignStatus = 'draft' | 'approved';

/** The one saved campaign of a business. Regenerating replaces the plan and raises the version. */
export interface CampaignRecord {
  id: string;
  workspaceId: string;
  businessId: string;
  /** 1, 2, 3 ... per business. */
  version: number;
  status: CampaignStatus;
  plan: LaunchCampaignPlan;
  enrichment: EnrichmentStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** Storage seam: this memory store now, a database table later. Each method is atomic per (workspace, business). */
export interface CampaignStore {
  readonly kind: 'memory' | 'database';
  /** The business's campaign, or null for an unknown business or another workspace. */
  get(workspaceId: string, businessId: string): Promise<CampaignRecord | null>;
  /** Run `change` on the current record and save what it returns. A throw saves nothing and propagates. */
  mutate<T>(workspaceId: string, businessId: string, change: (current: CampaignRecord | null) => { record: CampaignRecord | null; result: T }): Promise<T>;
}

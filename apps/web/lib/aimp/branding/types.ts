// Brand types (AMP-020). A BrandProfile is the one record the storefront, product previews and marketing read from.
import type { CoverStyle, StoreFont } from '../storefront/schema.ts';
import type { NameClash } from './name-clash.ts';

export const brandTones = ['warm', 'playful', 'calm', 'professional', 'bold'] as const;
export type BrandTone = (typeof brandTones)[number];

/** What the generator needs from the selected opportunity and its sample product. */
export interface BrandInput {
  niche: string;
  /** Who the product is for, e.g. "busy parents". */
  audience: string;
  /** Product type in plain words, e.g. "printable planner". Defaults to "digital product". */
  productType?: string;
  productTitle?: string;
  productSummary?: string;
  /** File formats such as PDF. */
  formats?: string[];
  totalPages?: number;
}

export interface BrandPalette {
  primary: string;
  accent: string;
  background: string;
  text: string;
  /** Text colour used on top of primary (buttons, banners). */
  onPrimary: string;
}

export interface BrandNameOption {
  name: string;
  slug: string;
  /** Simple name-similarity result (AMP-026). Not legal clearance. Show `clash.message` and `clash.notice`. */
  clash?: NameClash;
}

export interface BrandListing {
  tagline: string;
  /** One or two sentences, at most 160 characters. */
  shortDescription: string;
  /** A short paragraph, at most 600 characters. */
  longDescription: string;
}

export interface VisualDirection {
  coverStyle: CoverStyle;
  notes: string[];
  /** Always not_requested: no image is generated unless the owner asks, and that never happens inside this module. */
  imageGeneration: 'not_requested';
}

export interface BrandOptions {
  names: BrandNameOption[];
  palette: BrandPalette;
  tone: BrandTone;
  font: StoreFont;
  listing: BrandListing;
  visual: VisualDirection;
}

export type BrandStatus = 'draft' | 'approved' | 'superseded';

export interface BrandProfile {
  id: string;
  workspaceId: string;
  businessId: string;
  /** 1, 2, 3 ... per business. */
  version: number;
  status: BrandStatus;
  name: string;
  slug: string;
  tone: BrandTone;
  font: StoreFont;
  palette: BrandPalette;
  tagline: string;
  shortDescription: string;
  longDescription: string;
  visual: VisualDirection;
  /** The product this brand was written for (kept so edits can be re-checked against it). */
  input: BrandInput;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** The fields an owner may change. Anything else is ignored with a message. */
export interface BrandEdits {
  name?: string;
  slug?: string;
  tone?: BrandTone;
  palette?: Partial<BrandPalette>;
  tagline?: string;
  shortDescription?: string;
  longDescription?: string;
  coverStyle?: CoverStyle;
  visualNotes?: string[];
}

export interface BrandIssue { field: string; message: string }

export interface ContrastCheck { id: 'textOnBackground' | 'textOnPrimary' | 'accentOnBackground'; label: string; ratio: number; required: number; passed: boolean; blocking: boolean }

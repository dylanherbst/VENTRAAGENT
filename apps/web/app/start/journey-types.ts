// Plain, serialisable shapes passed between the server actions (app/start/actions.ts) and the client views.
import type { BrandIssue, BrandProfile } from '../../lib/aimp/branding/types';
import type { StorefrontBrand } from '../../lib/aimp/branding/adapters';
import type { CatalogueListing, CheckoutPrice } from '../../lib/aimp/catalogue/types';
import type { FeeEstimate, PriceSuggestion } from '../../lib/aimp/catalogue/pricing';
import type { FinderResult } from '../../lib/aimp/opportunities/types';
import type { QaResult, VersionStatus } from '../../lib/aimp/products/types';
import type { ProviderStatus } from '../../lib/aimp/providers/types';
import type { CheckoutGate } from '../../lib/aimp/sellers/gate';
import type { SellerReadiness, SellerState } from '../../lib/aimp/sellers/types';
import type { DraftPreview, DraftView, HistoryView, PublicResolution } from '../../lib/aimp/site-versions/store';
import type { PurchaseState } from '../../lib/aimp/storefront/load';

export type Connection = Pick<ProviderStatus, 'status' | 'label' | 'reason' | 'demo'>;

export type IdeasResponse =
  | { ok: true; mode: 'fixture' | 'live'; connection: Connection; result: FinderResult }
  | { ok: false; mode: 'fixture' | 'live'; connection: Connection; problems: string[] };

/** Every stateful action answers with this: what happened, and the fresh state to show. */
export interface ActionReply<S> { ok: boolean; message: string; errors: string[]; state: S }

/** Server memory is a demo store. `available` is false where the demo tools are switched off (production without the flag). */
export interface Availability { available: boolean; reason: string }

export interface BrandState extends Availability {
  versions: BrandProfile[];
  storefront: StorefrontBrand | null;
}
export type BrandOp =
  | { kind: 'load' }
  | { kind: 'start'; input: unknown; nameIndex: number }
  | { kind: 'save'; edits: unknown }
  | { kind: 'approve' };
export type BrandReply = ActionReply<BrandState> & { issues: BrandIssue[] };

export interface VersionView {
  id: string; version: number; status: VersionStatus; title: string; mode: 'demo' | 'live'; note: string;
  pageCount: number | null; fileHash: string | null; fileBytes: number | null;
  qa: QaResult[]; qaPassed: boolean; claims: string[]; sections: { title: string; pages: number }[]; createdAt: string; approvedAt: string | null;
}
export interface ProductView { id: string; blueprintId: string; title: string; versions: VersionView[]; approvedVersion: number | null; regenerationsLeft: number }
export interface ProductsState extends Availability {
  connection: Connection;
  products: ProductView[];
  maxProducts: number;
}
export type ProductsOp =
  | { kind: 'load' }
  | { kind: 'create'; blueprintId: string; inputs: unknown }
  | { kind: 'regenerate'; productId: string }
  | { kind: 'approve'; versionId: string };

export interface ListingRow {
  productId: string; productTitle: string; productApprovedVersion: number | null; listingId: string;
  latest: CatalogueListing | null; approved: CatalogueListing | null;
  versions: { version: number; status: string; priceMinor: number; title: string }[];
  suggestion: PriceSuggestion | null; fees: FeeEstimate | null;
  checkout: CheckoutPrice | null; checkoutReason: string;
  /** True when the product was re-approved after this listing was written, so the listing sells an older file. */
  productVersionBehind: boolean;
}
export interface CatalogueState extends Availability {
  brandApproved: boolean;
  payments: Connection;
  rows: ListingRow[];
}
export type CatalogueOp =
  | { kind: 'load' }
  | { kind: 'start'; productId: string }
  | { kind: 'save'; listingId: string; version: number; title: string; shortDescription: string; longDescription: string; priceMinor: number }
  | { kind: 'approve'; listingId: string; version: number }
  | { kind: 'repin'; listingId: string };

export interface StoreState extends Availability {
  brandApproved: boolean;
  approvedListings: number;
  site: null | { slug: string; draft: DraftView; history: HistoryView; publicView: PublicResolution; purchase: PurchaseState; preview: DraftPreview | null };
}
export type StoreOp =
  | { kind: 'load' }
  | { kind: 'create' }
  | { kind: 'save'; heading: string; subheading: string; tagline: string; expectedRevision: number }
  | { kind: 'sync'; expectedRevision: number }
  | { kind: 'preview' }
  /** Put a store template, an optional accent colour and an optional logo on the draft. `logo`: unset keeps it, '' removes it. */
  | { kind: 'look'; template: string; accent: string; logo?: string; expectedRevision: number }
  | { kind: 'publish'; note: string; expectedRevision: number }
  | { kind: 'pause' }
  | { kind: 'unpause' }
  | { kind: 'rollback'; version: number };

export interface PaymentsState {
  mode: 'LIVE' | 'DEMO';
  provider: Connection;
  adapterNote: string;
  /** The real state for this business: no Stripe account can be connected yet, so this is always "not connected" today. */
  readiness: SellerReadiness;
  gate: CheckoutGate;
  /** DEMO sample accounts, one per readiness state, run through the same rules. */
  samples: { key: SellerState; label: string; readiness: SellerReadiness; gate: CheckoutGate }[];
}

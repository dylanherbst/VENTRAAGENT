// F08 opt-in capture (AMP-053 slice 1): subscribers, append-only consent records, forms. Server level, fixtures only.

export type SubscriberStatus = 'pending' | 'subscribed' | 'unsubscribed' | 'suppressed';
export type ConsentPurpose = 'marketing' | 'sample';
export type ConsentChannel = 'store_form' | 'import' | 'manual';

/** Tenant context. It always comes from the server session, never from user input. */
export interface AudienceContext {
  workspaceId: string;
  businessId: string;
}

export interface Subscriber {
  id: string;
  workspaceId: string;
  businessId: string;
  storeSlug: string;
  emailNorm: string;
  emailDisplay: string;
  status: SubscriberStatus;
  tags: string[];
  source: string;
  suppressReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConsentSource {
  channel: ConsentChannel;
  formId: string;
  pageSlug: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  referrer: string;
}

/** Append-only. Never edited or deleted; wording is copied in, so later form edits do not change it. */
export interface ConsentRecord {
  id: string;
  workspaceId: string;
  businessId: string;
  subscriberId: string;
  purpose: ConsentPurpose;
  decision: 'granted' | 'withdrawn';
  wordingVersion: number;
  wordingText: string;
  at: number;
  source: ConsentSource;
}

export interface Form {
  id: string;
  workspaceId: string;
  businessId: string;
  storeSlug: string;
  wordingVersion: number;
  wordingText: string;
  sampleProductId?: string;
  tags: string[];
}

export interface FormInput {
  id: string;
  storeSlug: string;
  wordingText: string;
  sampleProductId?: string;
  tags?: string[];
}

export type SourceInput = Partial<ConsentSource> & { channel?: ConsentChannel };

export interface CaptureInput {
  formId: string;
  email: string;
  consentTicked: boolean;
  source?: SourceInput;
  sample?: boolean;
  /** Shown in the sample email instead of the internal product id. Optional. */
  sampleProductTitle?: string;
  /** Most subscribers this business may hold. A NEW address over it is refused (`full`), checked atomically in the store.
   *  An EXISTING address is let through on a full list, so a public route that sets this WITHOUT first refusing every submit on a
   *  full list (count before capture) would reveal list membership. See the F08 contract. */
  maxSubscribers?: number;
}

/** The ONLY shape a public route may return. Never the subscriber, its status or an id. */
export type PublicReply = { ok: true; message: string } | { ok: false; message: string };

export type CaptureRefusal = 'no_consent' | 'bad_email' | 'unknown_form' | 'full';
export type SampleOutcome = 'sent' | 'not_requested' | 'no_sample_product' | 'not_sent' | 'failed';

export type CaptureResult =
  | { ok: true; subscriber: Subscriber; created: boolean; resubscribed: boolean; sample: SampleOutcome }
  | { ok: false; code: CaptureRefusal; message: string };

export type ChangeResult =
  | { ok: true; subscriber: Subscriber; changed: boolean }
  | { ok: false; code: 'bad_email' | 'not_found'; message: string };

export interface ListFilter {
  status?: SubscriberStatus;
  tag?: string;
}

/** What one atomic store step decided. */
export interface Step<T> {
  next?: Subscriber;
  consent?: ConsentRecord;
  value: T;
}

export interface AudienceStore {
  kind: 'memory';
  /** `create: true` refuses (throws AudienceExistsError) when the id is already taken in that business, in the same step as the write. */
  saveForm(form: Form, opts?: { create?: boolean }): Promise<Form>;
  getForm(ctx: AudienceContext, formId: string): Promise<Form | null>;
  get(ctx: AudienceContext, emailNorm: string): Promise<Subscriber | null>;
  list(ctx: AudienceContext): Promise<Subscriber[]>;
  consents(ctx: AudienceContext, emailNorm: string): Promise<ConsentRecord[]>;
  /** Runs `fn` on the current subscriber (or null) and stores its result in one synchronous step. */
  transact<T>(ctx: AudienceContext, emailNorm: string, fn: (current: Subscriber | null) => Step<T>, opts?: { maxSubscribers?: number }): Promise<T>;
}

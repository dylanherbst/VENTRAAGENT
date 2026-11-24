import type { ProviderId } from '../flags.ts';

export type { ProviderId };

export type ProviderStatusKind = 'live' | 'test' | 'fixture' | 'disconnected' | 'disabled';

export interface ProviderStatus {
  provider: ProviderId;
  status: ProviderStatusKind;
  /** Short plain-English label for the UI badge. Never contains secret values. */
  label: string;
  /** Plain-English reason. Never contains secret values. */
  reason: string;
  /** True when the UI must show DEMO. */
  demo: boolean;
  /** Whether the credential variables are present (names only, never values). */
  credentialsPresent: boolean;
}

/** Every fixture result carries this marker. */
export interface FixtureMark {
  fixture: true;
  source: 'fixture';
}

/**
 * IDEMPOTENCY: every side-effecting call takes an optional idempotencyKey. A second call with the same key must return the
 * first result and must not repeat the effect. The job handlers always pass the job step's stable key.
 */
export interface IdempotencyOptions {
  idempotencyKey?: string;
}

export interface LlmAdapter {
  generate(input: { prompt: string; system?: string } & IdempotencyOptions): Promise<FixtureMark & { text: string; model: string }>;
}

export interface CheckoutSession extends FixtureMark {
  id: string;
  url: string;
  amountCents: number;
  currency: string;
  productName: string;
  status: 'open';
}
export interface PaymentEvent extends FixtureMark {
  id: string;
  type: 'checkout.session.completed';
  sessionId: string;
  amountCents: number;
}
export interface PaymentsAdapter {
  createCheckoutSession(input: {
    amountCents: number;
    currency: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
  } & IdempotencyOptions): Promise<CheckoutSession>;
  /** Fixture helper: marks a session paid and records an event. */
  completeSession(sessionId: string, opts?: IdempotencyOptions): Promise<PaymentEvent>;
  listEvents(): readonly PaymentEvent[];
}

export interface OutboxMessage extends FixtureMark {
  id: string;
  to: string;
  subject: string;
  text: string;
  delivered: false;
}
export interface EmailAdapter {
  send(input: { to: string; subject: string; text: string } & IdempotencyOptions): Promise<OutboxMessage>;
  outbox(): readonly OutboxMessage[];
}

export interface StoredFile extends FixtureMark {
  path: string;
  size: number;
  private: true;
}
export interface SignedUrl extends FixtureMark {
  url: string;
  path: string;
  expiresAt: number;
}
export interface StorageAdapter {
  put(path: string, bytes: Uint8Array, opts?: IdempotencyOptions): Promise<StoredFile>;
  signedUrl(path: string, ttlSeconds: number): Promise<SignedUrl>;
}

export interface SocialPost extends FixtureMark {
  id: string;
  network: 'pinterest';
  title: string;
  link: string;
  imageUrl: string;
  status: 'queued';
  published: false;
}
export interface SocialAdapter {
  queuePost(input: { title: string; link: string; imageUrl: string } & IdempotencyOptions): Promise<SocialPost>;
  queue(): readonly SocialPost[];
}

export interface DomainRecord extends FixtureMark {
  hostname: string;
  kind: 'local-test';
  verified: boolean;
}
export interface DomainsAdapter {
  provision(slug: string, opts?: IdempotencyOptions): Promise<DomainRecord>;
}

export interface AdapterMap {
  llm: LlmAdapter;
  payments: PaymentsAdapter;
  email: EmailAdapter;
  storage: StorageAdapter;
  social: SocialAdapter;
  domains: DomainsAdapter;
}

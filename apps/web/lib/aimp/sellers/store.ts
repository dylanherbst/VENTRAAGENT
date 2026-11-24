import type { AccountUpdatedEvent, EventOutcome, SellerAccount, StripeAccountSnapshot } from './types.ts';

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const CAPABILITY_VALUES: ReadonlySet<unknown> = new Set(['active', 'inactive', 'pending']);

function validSnapshot(s: unknown): s is StripeAccountSnapshot {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Partial<StripeAccountSnapshot>;
  const r = o.requirements;
  const c = o.capabilities;
  return (
    isNonEmpty(o.id) &&
    typeof o.charges_enabled === 'boolean' &&
    typeof o.payouts_enabled === 'boolean' &&
    typeof o.details_submitted === 'boolean' &&
    typeof r === 'object' && r !== null &&
    stringArray(r.currently_due) && stringArray(r.past_due) &&
    (r.disabled_reason === null || typeof r.disabled_reason === 'string') &&
    typeof c === 'object' && c !== null &&
    (c.card_payments === undefined || CAPABILITY_VALUES.has(c.card_payments)) &&
    (c.transfers === undefined || CAPABILITY_VALUES.has(c.transfers))
  );
}

/**
 * Tenant-scoped seller account store (in-memory stand-in for public.merchant_accounts).
 * Reads need a workspace id and return null for another workspace's account, exactly like RLS: the caller
 * cannot tell "not yours" from "does not exist". Only the webhook path may look up by Stripe account id.
 */
export interface SellerAccountStore {
  /** Throws on an invalid account (bad snapshot, snapshot.id != stripeAccountId, cross-workspace or duplicate link). */
  register(account: SellerAccount): void;
  /** Workspace-scoped read. Null when absent OR owned by another workspace. */
  get(workspaceId: string, businessId: string): SellerAccount | null;
  /**
   * Idempotent, order-safe application of an account.updated event. Server/webhook use only.
   * SECURITY (AMP-043-D): once real Stripe keys exist, the webhook route MUST verify the Stripe-Signature header
   * against the raw request body (webhook signing secret) BEFORE calling this. This function trusts its input.
   */
  applyAccountUpdated(event: AccountUpdatedEvent): EventOutcome;
}

export function createInMemorySellerStore(): SellerAccountStore {
  const byBusiness = new Map<string, SellerAccount>();
  const byStripeId = new Map<string, string>();
  const processed = new Set<string>();

  return {
    register(account) {
      if (!isNonEmpty(account.workspaceId) || !isNonEmpty(account.businessId) || !isNonEmpty(account.stripeAccountId)) {
        throw new Error('seller account needs workspaceId, businessId and stripeAccountId');
      }
      if (!validSnapshot(account.snapshot)) throw new Error('seller account snapshot is not a valid Stripe account');
      if (account.snapshot.id !== account.stripeAccountId) throw new Error('snapshot id must equal stripeAccountId');
      if (!Number.isInteger(account.lastEventCreated) || account.lastEventCreated < 0) throw new Error('lastEventCreated must be a non-negative integer');
      const existing = byBusiness.get(account.businessId);
      // business_id is the primary key and the composite FK pins it to one workspace.
      if (existing && existing.workspaceId !== account.workspaceId) throw new Error('business belongs to another workspace');
      const owner = byStripeId.get(account.stripeAccountId);
      if (owner !== undefined && owner !== account.businessId) throw new Error('stripe account already linked to another business');
      // Re-linking a business to a new Stripe account retires the old mapping so old-account events no longer apply.
      if (existing && existing.stripeAccountId !== account.stripeAccountId) byStripeId.delete(existing.stripeAccountId);
      byBusiness.set(account.businessId, structuredClone(account));
      byStripeId.set(account.stripeAccountId, account.businessId);
    },
    get(workspaceId, businessId) {
      const a = byBusiness.get(businessId);
      return a && a.workspaceId === workspaceId ? { ...a } : null;
    },
    applyAccountUpdated(event) {
      if (!event || event.type !== 'account.updated') return { handled: false, outcome: 'unsupported_type' };
      if (
        !isNonEmpty(event.id) || !isNonEmpty(event.account) || !validSnapshot(event.data?.object) || event.data.object.id !== event.account ||
        // A missing or malformed timestamp would defeat the stale-event check, so it is invalid, not "apply anyway".
        !Number.isInteger(event.created) || event.created < 0
      ) {
        return { handled: false, outcome: 'invalid' };
      }
      if (processed.has(event.id)) return { handled: false, outcome: 'duplicate' };
      const businessId = byStripeId.get(event.account);
      const current = businessId === undefined ? undefined : byBusiness.get(businessId);
      // Unknown account: never create one from a webhook, and do not record the id.
      if (businessId === undefined || !current) return { handled: false, outcome: 'unknown_account' };
      processed.add(event.id);
      if (event.created < current.lastEventCreated) return { handled: false, outcome: 'stale' };
      byBusiness.set(businessId, { ...current, snapshot: structuredClone(event.data.object), lastEventCreated: event.created });
      return { handled: true, outcome: 'applied', businessId };
    },
  };
}

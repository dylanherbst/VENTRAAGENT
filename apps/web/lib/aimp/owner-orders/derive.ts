// Pure derivation for H19/H20: states, attention reasons, allowed actions, timeline. No I/O, no clock reads (`now` is passed in).
import type { DeliveryErrorCode, Fulfilment, FulfilmentAuditEntry, MoneyEvent, OrderHistoryRow } from '../fulfilment/index.ts';
import type { Grant } from '../files/types.ts';
import type {
  ActionAllowance, AllowedActions, Attention, DeliveryState, GrantState, MoneyFlag, OwnerGrantView, OwnerOrderSummary, PaymentState, TimelineEvent,
} from './types.ts';
import { STUCK_DELIVERY_MS } from './types.ts';

/**
 * Never says access is withdrawn while it may still work. A refund marks the order refunded FIRST and revokes grants after, and
 * fulfilment records `revoked` only once every grant is revoked. So `refunded` alone is not proof: the list (which cannot see grants)
 * trusts the fulfilment record; the detail also passes the count of active grants it can see.
 */
export const deliveryStateOf = (orderStatus: PaymentState, fulfilmentStatus: Fulfilment['status'] | 'none', activeGrants = 0): DeliveryState => {
  if (activeGrants > 0 && (orderStatus === 'refunded' || fulfilmentStatus === 'revoked')) return 'revoking';
  if (fulfilmentStatus === 'revoked') return 'access_revoked';
  // Refunded with no fulfilment record: no grant was ever issued (grants come from fulfilment), so there is nothing left to remove.
  if (orderStatus === 'refunded') return fulfilmentStatus === 'none' ? 'access_revoked' : 'revoking';
  switch (fulfilmentStatus) {
    case 'queued': case 'delivering': return 'in_progress';
    case 'delivered': return 'delivered';
    case 'failed': return 'failed';
    case 'needs_review': return 'needs_review';
    default: return 'not_started';
  }
};

const FLAG_ORDER: Exclude<MoneyFlag, null>[] = ['dispute', 'partial_refund', 'refund_exception'];
/** The most serious open money question for an order, from the events that still need the owner. */
export const moneyFlagOf = (events: Pick<MoneyEvent, 'kind' | 'needsOwner'>[]): MoneyFlag => {
  const open = new Set(events.filter((e) => e.needsOwner).map((e) => e.kind));
  return FLAG_ORDER.find((k) => open.has(k)) ?? null;
};

/** `b***@example.test`. */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
};

export const ERROR_TEXT: Record<DeliveryErrorCode, string> = {
  email_failed: 'The email provider could not send the message.',
  email_unavailable: 'Email is not switched on.',
  order_not_paid: 'The order was not paid when delivery ran.',
  order_not_found: 'The order could not be found when delivery ran.',
  wrong_tenant: 'The product does not belong to this store.',
  version_not_approved: 'The bought product version is not approved.',
  file_missing: 'The product file is missing.',
  file_changed: 'The product file changed after approval.',
  unexpected: 'Something unexpected stopped the delivery.',
};

export function attentionOf(input: { paymentState: PaymentState; deliveryState: DeliveryState; moneyFlag: MoneyFlag; paidAt: string | null }, now: Date): Attention | null {
  switch (input.moneyFlag) {
    case 'dispute': return { code: 'dispute', reason: 'A dispute was opened on this order. Respond with your payment provider; access has not been changed.' };
    case 'partial_refund': return { code: 'partial_refund', reason: 'A partial refund was reported. Check the amount and decide whether the buyer keeps access.' };
    case 'refund_exception': return { code: 'refund_exception', reason: 'A refund was reported for an order that is not recorded as paid. Check it with your payment provider.' };
    default: break;
  }
  if (input.deliveryState === 'revoking') return { code: 'access_revoking', reason: 'Refunded, but access is still being removed. The buyer\'s download link may still work. Check again shortly or contact support if this stays.' };
  if (input.paymentState !== 'paid') return null;
  if (input.deliveryState === 'needs_review') return { code: 'delivery_needs_review', reason: 'Paid, but delivery stopped and needs you. Check the product file, then send a new link.' };
  if (input.deliveryState === 'failed') return { code: 'delivery_failed', reason: 'Paid, but the delivery email failed. Resend it.' };
  if (input.deliveryState === 'not_started' || input.deliveryState === 'in_progress') {
    const paid = input.paidAt ? Date.parse(input.paidAt) : NaN;
    if (!Number.isNaN(paid) && now.getTime() - paid > STUCK_DELIVERY_MS) {
      return { code: 'delivery_stuck', reason: `Paid ${Math.floor((now.getTime() - paid) / 60_000)} minutes ago and the delivery email has not gone out yet.` };
    }
  }
  return null;
}

export function summaryOf(row: OrderHistoryRow, moneyFlag: MoneyFlag, now: Date, activeGrants = 0): OwnerOrderSummary {
  const deliveryState = deliveryStateOf(row.orderStatus, row.fulfilmentStatus, activeGrants);
  const attention = attentionOf({ paymentState: row.orderStatus, deliveryState, moneyFlag, paidAt: row.paidAt }, now);
  return {
    id: row.orderId, createdAt: row.createdAt, paidAt: row.paidAt, title: row.title, productVersion: row.productVersion,
    amountMinor: row.amountMinor, currency: row.currency, buyerMasked: maskEmail(row.buyerEmail), paymentState: row.orderStatus, moneyFlag,
    deliveryState, deliveredAt: row.deliveredAt, attempts: row.attempts, lastError: row.lastError, needsAttention: attention !== null, attention,
  };
}

export const grantState = (g: Grant, now: Date): GrantState =>
  g.revokedAt !== null ? 'revoked' : Date.parse(g.expiresAt) <= now.getTime() ? 'expired' : g.downloads >= g.maxDownloads ? 'used_up' : 'active';

/** Only state, expiry and counts. The grant record never carries a token; this view also drops everything it does not need. */
export const grantView = (g: Grant, now: Date): OwnerGrantView => ({
  id: g.id, state: grantState(g, now), issuedAt: g.issuedAt, expiresAt: g.expiresAt, downloads: g.downloads, maxDownloads: g.maxDownloads,
  revokedAt: g.revokedAt, replacesGrantId: g.replacesGrantId,
});

const no = (reason: string): ActionAllowance => ({ allowed: false, reason });
const yes = (reason: string | null = null): ActionAllowance => ({ allowed: true, reason });

export function allowedActionsOf(input: { paymentState: PaymentState; deliveryState: DeliveryState; fulfilment: Fulfilment | null; paidEventId: string | null }, now: Date): AllowedActions {
  const { paymentState, deliveryState, fulfilment: f } = input;
  const refundStatus = yes('You can look at the refund state. Refunds are not issued from here.');
  const notPaid = paymentState === 'pending' ? 'The payment has not completed yet, so there is nothing to send.'
    : paymentState === 'failed' ? 'The payment failed, so there is nothing to send.'
    : paymentState === 'refunded' ? 'This order was refunded, so access is withdrawn and cannot be sent again.' : null;
  if (notPaid) return { resendDelivery: no(notPaid), reissueAccess: no(notPaid), refundStatus };
  if (deliveryState === 'access_revoked' || deliveryState === 'revoking') {
    const r = deliveryState === 'revoking' ? 'Access is still being removed for this order, so nothing can be sent.' : 'Access was withdrawn for this order, so nothing can be sent.';
    return { resendDelivery: no(r), reissueAccess: no(r), refundStatus };
  }
  // Fulfilment refuses every send for a paid order that carries no payment event id (it cannot prove the payment), so say so up front.
  if (!input.paidEventId) {
    const r = 'The payment is recorded without a payment confirmation, so nothing can be sent until it is confirmed.';
    return { resendDelivery: no(r), reissueAccess: no(r), refundStatus };
  }

  let resendDelivery: ActionAllowance;
  switch (deliveryState) {
    case 'delivered': resendDelivery = no('The delivery email was already sent. If the buyer lost it, send a new link instead.'); break;
    case 'needs_review': resendDelivery = no(`All ${f?.maxAttempts ?? 'the'} delivery attempts were used or the problem cannot fix itself. Send a new link instead, once the product file is fine.`); break;
    case 'failed': resendDelivery = yes(`Attempt ${f?.attempts ?? 0} of ${f?.maxAttempts ?? 5} failed. This tries again.`); break;
    case 'in_progress':
      resendDelivery = f?.status === 'delivering' && f.leaseUntil !== null && Date.parse(f.leaseUntil) > now.getTime()
        ? no('The email is being sent right now. Check again in a minute.') : yes('Delivery has been queued. This tries it now.');
      break;
    default: resendDelivery = yes('Delivery has not started yet. This starts it.');
  }
  const reissueAccess = deliveryState === 'delivered'
    ? yes('Sends the buyer a new link by email and switches off the old one.')
    : yes('Sends the buyer a new link by email and switches off any earlier one.');
  return { resendDelivery, reissueAccess, refundStatus };
}

const LABEL: Partial<Record<FulfilmentAuditEntry['event'], { kind: TimelineEvent['kind']; label: string }>> = {
  delivery_started: { kind: 'delivery_started', label: 'Delivery started' },
  delivered: { kind: 'delivery_email_sent', label: 'Delivery email sent' },
  delivery_failed: { kind: 'delivery_failed', label: 'Delivery email failed' },
  delivery_needs_review: { kind: 'delivery_needs_review', label: 'Delivery stopped and needs you' },
  retry_requested: { kind: 'retry_requested', label: 'Delivery retried' },
  access_reissued: { kind: 'link_reissued', label: 'New download link emailed, earlier link switched off' },
  order_refunded: { kind: 'refunded', label: 'Order refunded' },
  access_revoked: { kind: 'access_revoked', label: 'Download access withdrawn' },
  needs_owner: { kind: 'needs_owner', label: 'Waiting for you: refund or dispute to decide' },
};

const isSystem = (actor: string) => actor.startsWith('system:');

/**
 * What the services actually record: order created and paid (orders), then the fulfilment audit entries for this order.
 * Audit notes and free-text reasons are NOT copied: a note can name a grant or an email message id.
 */
export function timelineOf(order: { createdAt: string; paidAt: string | null }, audit: FulfilmentAuditEntry[]): TimelineEvent[] {
  const out: TimelineEvent[] = [{ at: order.createdAt, kind: 'order_created', label: 'Order started', actor: 'system' }];
  if (order.paidAt) out.push({ at: order.paidAt, kind: 'paid', label: 'Payment confirmed', actor: 'system' });
  for (const e of [...audit].sort((a, b) => a.seq - b.seq)) {
    const l = LABEL[e.event];
    if (l) out.push({ at: e.at, kind: l.kind, label: l.label, actor: isSystem(e.actor) ? 'system' : e.actor });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

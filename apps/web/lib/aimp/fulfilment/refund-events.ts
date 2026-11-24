// Fake provider refund / dispute events for fixtures and tests (AMP-042), in the JSON shape Stripe sends, signed with the given
// secret (same scheme as checkout/signature.ts). No network. The order is named in `metadata` (set on the payment when the real
// adapter creates the session, AMP-043-D) and `account` is the seller's connected account the charge belongs to.
import { signPayload } from '../checkout/signature.ts';
import type { Order } from '../orders/types.ts';

export interface SignedMoneyEvent { rawBody: string; signature: string; eventId: string }

export interface MoneyEventInput {
  eventId: string;
  type: 'charge.refunded' | 'charge.dispute.created' | 'charge.dispute.closed';
  order: Pick<Order, 'id' | 'workspaceId' | 'amountMinor' | 'currency' | 'sellerAccountId'>;
  /** Defaults to the whole order amount (a full refund). */
  amountRefundedMinor?: number;
  /** Override the connected account on the event (to show a mismatch is ignored). */
  account?: string | null;
  createdSeconds: number;
}

export function buildMoneyEventBody(i: MoneyEventInput): string {
  const refunded = i.amountRefundedMinor ?? i.order.amountMinor;
  const metadata = { aimp_order_id: i.order.id, aimp_workspace_id: i.order.workspaceId };
  const object = i.type === 'charge.refunded'
    ? { id: `ch_fixture_${i.order.id}`, object: 'charge', amount: i.order.amountMinor, amount_refunded: refunded, currency: i.order.currency.toLowerCase(), refunded: refunded >= i.order.amountMinor, metadata }
    : { id: `dp_fixture_${i.order.id}`, object: 'dispute', amount: i.order.amountMinor, currency: i.order.currency.toLowerCase(), status: i.type === 'charge.dispute.closed' ? 'lost' : 'needs_response', metadata };
  const account = i.account === undefined ? i.order.sellerAccountId : i.account;
  return JSON.stringify({ id: i.eventId, type: i.type, created: i.createdSeconds, ...(account === null ? {} : { account }), data: { object } });
}

export function signMoneyEvent(secret: string, i: Omit<MoneyEventInput, 'createdSeconds'>, now: Date): SignedMoneyEvent {
  const seconds = Math.floor(now.getTime() / 1000);
  const rawBody = buildMoneyEventBody({ ...i, createdSeconds: seconds });
  return { rawBody, signature: signPayload(secret, rawBody, seconds), eventId: i.eventId };
}

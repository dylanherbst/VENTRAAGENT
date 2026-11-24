// Fixture helpers for the owner-orders tests (DEMO only). The world is the fulfilment fixture: two stores in two workspaces on the
// real services with in-memory stores. Nothing here is live.
import type { FulfilmentWorld } from '../fulfilment/demo.ts';
import type { Order, OrderStore } from '../orders/index.ts';
import type { OwnerOrdersDeps } from './types.ts';

export const ownerOrdersDeps = (w: Pick<FulfilmentWorld, 'orders' | 'fulfilment' | 'now'>): OwnerOrdersDeps => ({ orders: w.orders, fulfilment: w.fulfilment, now: w.now });

/**
 * Writes an order straight into the order store for a business that has no store in the fixture (a SECOND business in the same
 * workspace). `paid` marks it paid through the same atomic store step the webhook uses. No fulfilment record is created.
 */
export async function seedOrder(
  orders: OrderStore,
  o: { id: string; workspaceId: string; businessId: string; buyerEmail?: string; amountMinor?: number; createdAt: string; paid?: boolean },
): Promise<Order> {
  const { order } = await orders.createPending({
    id: o.id, workspaceId: o.workspaceId, businessId: o.businessId, storeSlug: `slug-${o.businessId}`, listingId: `lst-${o.id}`, listingVersion: 1,
    productId: `prod-${o.id}`, productVersion: 1, title: `Seeded ${o.id}`, amountMinor: o.amountMinor ?? 1400, currency: 'AUD', sellerAccountId: `acct-${o.businessId}`,
    buyerEmail: o.buyerEmail ?? 'seed-buyer@example.test', idempotencyKey: `key-${o.id}`, createdAt: o.createdAt,
  });
  if (!o.paid) return order;
  await orders.attachSession(order.id, { id: `cs_${o.id}`, url: 'https://pay.example.test/session' });
  const r = await orders.applyPaid({ eventId: `evt_${o.id}`, sessionId: `cs_${o.id}`, amountMinor: order.amountMinor, currency: 'AUD', at: o.createdAt });
  if (r.outcome !== 'paid') throw new Error(`Could not mark the seeded order paid (${r.outcome}).`);
  return r.order;
}

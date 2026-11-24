// The hook AMP-042 (delivery) uses (AMP-041). Delivery is NOT implemented here.
//  - `createOrderBook(store)` is an `OrderBook` for the files service (AMP-024): its `orderStatus` is the real order status, so an
//    unpaid (pending, failed) order is refused by the files service with `order_not_paid`. No paid event, no download.
//  - `orderItemId(orderId)` is the one order line per order; `isDeliverable(order)` is the single "may we deliver" test.
//  - `OrderPaidHook` (see checkout service `onOrderPaid`) fires exactly once per order after the verified paid transition.
import type { OrderBook, OrderItemRef } from '../files/types.ts';
import type { Order, OrderStore } from './types.ts';

export const orderItemId = (orderId: string): string => `${orderId}:item-1`;
const ITEM = /^(.+):item-1$/;

/** Only a paid order may be delivered. */
export const isDeliverable = (o: Pick<Order, 'status'>): boolean => o.status === 'paid';

export function toOrderItemRef(o: Order): OrderItemRef {
  return {
    id: orderItemId(o.id), orderId: o.id, workspaceId: o.workspaceId, businessId: o.businessId,
    productId: o.productId, productVersion: o.productVersion, orderStatus: o.status,
  };
}

/** Looks an order up by its line id. `workspaceIds` lists the workspaces to search (the demo has one; a database looks up by id). */
export function createOrderBook(store: OrderStore, workspaceIds: readonly string[]): OrderBook {
  return {
    async getItem(itemId) {
      const m = typeof itemId === 'string' ? ITEM.exec(itemId) : null;
      if (!m?.[1]) return null;
      for (const ws of workspaceIds) {
        const o = await store.get(ws, m[1]);
        if (o) return toOrderItemRef(o);
      }
      return null;
    },
  };
}

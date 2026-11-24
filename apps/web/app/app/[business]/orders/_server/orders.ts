// Server reads for the Orders queue and the order detail (screens 19 and 20, AMP-086; H19 H20). Plain functions that take the runtime and
// the orders source as arguments, so they run in the node tests without Next. No order, delivery or refund rule lives here: every
// state comes from the owner-orders service (lib/aimp/owner-orders, AMP-085), which checks the business before it reads anything.
//
// WHAT THE /START DEMO HAS (AMP-103). The /start runtime (`JourneyRuntime`, app/start/_server/runtime.ts) now also holds an order store
// and a fulfilment service (app/start/_server/orders-runtime.ts) in the same workspace as its businesses, on fixture payments and
// fixture email. `ordersSource` builds the source from them. Orders appear only when something really bought through checkout
// (`createSampleOrders` in that file does so with a labelled sample seller). Nothing is seeded or faked here.
import { OwnerOrdersError, getOwnerOrder, listOwnerOrders } from '../../../../../lib/aimp/owner-orders/index.ts';
import type { OrderFilter, OwnerOrderDetail, OwnerOrdersDeps, OwnerOrdersPage, OwnerOrdersScope } from '../../../../../lib/aimp/owner-orders/index.ts';
import { orderIsTest } from '../../../../start/_server/checkout-runtime.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';

/** The parts of the /start runtime these pages read. `JourneyRuntime` satisfies this. */
export type OrdersRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
  /** The /start runtime's order store and fulfilment service (optional so a runtime without them still reads as "no source"). */
  orderDemo?: { orders: OwnerOrdersDeps['orders']; fulfilment: OwnerOrdersDeps['fulfilment']; now: () => Date; workspaceId: string; actorId: string };
};

/**
 * Where orders come from: the owner-orders dependencies plus the workspace and the person acting. Never from the request.
 * `isTest` (optional override) answers for an order id. Without it the flag stored on the order (set when it was created, AMP-162) is
 * read from the source's order store (`orderIsTest`). If a read throws or the order is not found, it counts as a test order.
 */
export interface OrdersSource { deps: OwnerOrdersDeps; workspaceId: string; actorId: string; isTest?: (orderId: string) => boolean | Promise<boolean> }

/** What a real source needs that the /start demo does not have (reported to the owner, shown nowhere as a promise). */
export const MISSING_WIRING = [
  'an order store (lib/aimp/orders createMemoryOrderStore or the database store) in the /start runtime, in the same workspace as the /start business',
  'a fulfilment service on that store (lib/aimp/fulfilment createFulfilmentService, with files and email), so delivery state and the two recovery actions work',
  'a path that creates orders for a /start business (checkout and the payment webhook), because a /start business has no seller account yet',
] as const;

/**
 * The orders source for this runtime: the order store and fulfilment service of the /start runtime (`rt.orderDemo`, AMP-103), in the
 * workspace and as the owner the runtime itself uses. Null only for a runtime that has none (an old hot-reloaded one, or a test double).
 * Nothing here comes from the request.
 */
export function ordersSource(rt: OrdersRuntime): OrdersSource | null {
  const o = rt.orderDemo;
  if (!o) return null;
  return { deps: { orders: o.orders, fulfilment: o.fulfilment, now: o.now }, workspaceId: o.workspaceId, actorId: o.actorId };
}

/**
 * The reader of the test flag: the source's own `isTest` when it has one, else the stored order read from the source's own order store.
 * FAIL CLOSED: an order that cannot be read reads as a test order (never as real money).
 * DECIDED (AMP-163): when the flag cannot be read the order is SHOWN AS TEST, not as "unknown". The page has no third label, and a
 * wrong "test" label is safe where a wrong "real" label is not. The default reader makes exactly one store read per order id (the
 * `get` below) and nothing else; it never re-reads the order for the label.
 */
function flagReader(source: OrdersSource): (orderId: string) => boolean | Promise<boolean> {
  if (source.isTest) return source.isTest;
  return async (orderId) => {
    const order = await source.deps.orders.get(source.workspaceId, orderId);
    return order ? orderIsTest(order) : true;
  };
}

const scopeOf = (s: OrdersSource, businessId: string): OwnerOrdersScope => ({ workspaceId: s.workspaceId, businessId, actorId: s.actorId });

export type OrdersLookup =
  | { found: false }
  | { found: true; available: false }
  /** `cursor` is the cursor the page was really read with: null on page 1, and null when a bad cursor fell back to page 1. */
  /** `testIds`: ids on this page that were paid through the sample seller account, decided here from the stored order. */
  | { found: true; available: true; page: OwnerOrdersPage; cursor: string | null; testIds: string[] };

/**
 * True when the order carries the stored test flag. One flag read per id, no second read of the order. FAILS CLOSED: if the flag read
 * throws, the order counts as a test order, so a test or sample order is never shown as real money. Never from the request.
 */
async function testFlag(source: OrdersSource, orderId: string): Promise<boolean> {
  try {
    return (await flagReader(source)(orderId)) === true;
  } catch { return true; }
}
async function testIdsOf(source: OrdersSource, page: OwnerOrdersPage): Promise<string[]> {
  const flags = await Promise.all(page.orders.map(async (o) => ((await testFlag(source, o.id)) ? o.id : null)));
  return flags.filter((id): id is string => id !== null);
}

export interface OrdersQuery { filter: OrderFilter; cursor: string | null }

/** Unknown business => `found: false`. No source => `available: false` (no orders can exist). Only this business's orders are read. */
export async function loadOrders(rt: OrdersRuntime, source: OrdersSource | null, businessId: string, query: OrdersQuery): Promise<OrdersLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  if (!source) return { found: true, available: false };
  const scope = scopeOf(source, businessId);
  try {
    const page = await listOwnerOrders(source.deps, scope, { filter: query.filter, cursor: query.cursor });
    return { found: true, available: true, cursor: query.cursor || null, page, testIds: await testIdsOf(source, page) };
  } catch (e) {
    // A cursor from an old link or one edited by hand: show the first page instead of an error (and report that no cursor was used).
    if (query.cursor && e instanceof OwnerOrdersError && e.code === 'invalid_input') {
      const page = await listOwnerOrders(source.deps, scope, { filter: query.filter });
      return { found: true, available: true, cursor: null, page, testIds: await testIdsOf(source, page) };
    }
    throw e;
  }
}

export type OrderLookup = { found: false } | { found: true; order: OwnerOrderDetail; test: boolean };

/**
 * The order, only when it belongs to this business. An unknown business, no source, an unknown id and an order of another business
 * all answer `found: false`, so they cannot be told apart.
 */
export async function loadOrder(rt: OrdersRuntime, source: OrdersSource | null, businessId: string, orderId: string): Promise<OrderLookup> {
  if (!isKnownBusiness(rt, businessId) || !source) return { found: false };
  const order = await getOwnerOrder(source.deps, scopeOf(source, businessId), orderId);
  return order ? { found: true, order, test: await testFlag(source, order.id) } : { found: false };
}

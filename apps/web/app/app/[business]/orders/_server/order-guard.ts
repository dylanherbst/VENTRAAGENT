// The checks `orderAction` runs before it hands a request to the owner-orders service, as a pure function so the node tests can run
// them (actions.ts imports Next-only modules). It decides WHETHER and with what scope the service runs; it never delivers, sends or
// refunds anything itself. Order: demo storage on, valid ids, known business, an orders source exists, the order belongs to this
// business (read through the service), the action is allowed for the order's current state, a valid request key.
// The business and order ids come from the page address; the workspace and actor come from the server, never from the request.
import { getOwnerOrder } from '../../../../../lib/aimp/owner-orders/index.ts';
import type { OwnerOrdersScope } from '../../../../../lib/aimp/owner-orders/index.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OrdersRuntime, OrdersSource } from './orders.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_ORDER = 'We could not find that order in this business.';
export const NO_ORDERS_YET = 'No orders can exist in this demo yet, so there is nothing to change.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';

export const orderActionKinds = ['resend', 'reissue'] as const;
export type OrderActionKind = (typeof orderActionKinds)[number];

const ORDER_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{1,80}$/;
export const isOrderId = (v: unknown): v is string => typeof v === 'string' && ORDER_ID.test(v) && v !== '.' && v !== '..';
export const isRequestKey = (v: unknown): v is string => typeof v === 'string' && REQUEST_KEY.test(v);
export const isOrderActionKind = (v: unknown): v is OrderActionKind => typeof v === 'string' && (orderActionKinds as readonly string[]).includes(v);

export interface OrderGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => OrdersRuntime;
  source: (rt: OrdersRuntime) => OrdersSource | null;
}

export type OrderGuard =
  | { ok: false; message: string }
  | { ok: true; source: OrdersSource; scope: OwnerOrdersScope; kind: OrderActionKind; orderId: string; requestKey: string };

export async function guardOrderAction(g: OrderGuardInput, businessId: unknown, orderId: unknown, kind: unknown, requestKey: unknown): Promise<OrderGuard> {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  if (!isOrderId(orderId)) return { ok: false, message: NO_ORDER };
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return { ok: false, message: NO_BUSINESS };
  const source = g.source(rt);
  if (!source) return { ok: false, message: NO_ORDERS_YET };
  if (!isOrderActionKind(kind) || !isRequestKey(requestKey)) return { ok: false, message: BAD_REQUEST };
  const scope: OwnerOrdersScope = { workspaceId: source.workspaceId, businessId, actorId: source.actorId };
  // Ownership first, through the service: an order of another business is answered exactly like an unknown id.
  const order = await getOwnerOrder(source.deps, scope, orderId);
  if (!order) return { ok: false, message: NO_ORDER };
  const allowance = kind === 'resend' ? order.allowedActions.resendDelivery : order.allowedActions.reissueAccess;
  if (!allowance.allowed) return { ok: false, message: allowance.reason ?? 'That is not possible for this order right now.' };
  return { ok: true, source, scope, kind, orderId: order.id, requestKey };
}

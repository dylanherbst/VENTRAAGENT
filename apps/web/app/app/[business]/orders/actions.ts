'use server';
// The one server action this page adds. It delivers, emails and refunds nothing itself: it checks the request (see
// _server/order-guard.ts), then runs the owner-orders service (lib/aimp/owner-orders), which delegates to the fulfilment service.
//   resend  -> `resendDelivery`   (retry the delivery email)
//   reissue -> `reissueAccess`    (a new download link; earlier links stop working)
// No refund is issued anywhere in this app: refunds are shown as a status only.
import { resendDelivery, reissueAccess } from '../../../../lib/aimp/owner-orders/index';
import { availability, runtime } from '../../../start/_server/runtime';
import { guardOrderAction } from './_server/order-guard';
import { ordersSource } from './_server/orders';

export interface OrderActionReply { ok: boolean; message: string }

export async function orderAction(businessId: string, orderId: string, kind: string, requestKey: string): Promise<OrderActionReply> {
  const g = await guardOrderAction({ availability: availability(), rt: runtime, source: ordersSource }, businessId, orderId, kind, requestKey);
  if (!g.ok) return { ok: false, message: g.message };
  const r = g.kind === 'resend'
    ? await resendDelivery(g.source.deps, g.scope, g.orderId, g.requestKey)
    : await reissueAccess(g.source.deps, g.scope, g.orderId, g.requestKey);
  return { ok: r.ok, message: r.message };
}

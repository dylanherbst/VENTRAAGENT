// The Inbox for the /start demo runtime: one in-memory inbox per server process (lost on restart, like the rest of the demo), reading the
// same orders and catalogue as the other workspace pages. Replies go to the FIXTURE outbox, never to a real address. No model is connected
// until an API key is added, so enquiries use the standard hand-off reply. It never imports runtime.ts, so node tests can load it.
import { listOwnerOrders } from '../../../lib/aimp/owner-orders/index.ts';
import type { OwnerOrdersDeps } from '../../../lib/aimp/owner-orders/index.ts';
import { createInbox } from '../../../lib/aimp/storeops/inbox.ts';
import type { Inbox } from '../../../lib/aimp/storeops/inbox.ts';
import type { OrderFacts } from '../../../lib/aimp/storeops/order-status.ts';
import type { AgentModel } from '../../../lib/aimp/storeops/agent.ts';
import type { ReceptionistInput } from '../../../lib/aimp/storeops/receptionist.ts';

type Listings = { title: string; shortDescription: string; priceMinor: number }[];

/** The parts of the /start runtime the Inbox reads. `JourneyRuntime` satisfies this. */
export interface InboxRuntime {
  slugs: Map<string, string>;
  catalogue: { listApprovedForBusiness(ctx: { workspaceId: string; businessId?: string; actorUserId: string; idempotencyKey?: string }, businessId: string): Promise<Listings> };
  orderDemo: {
    workspaceId: string;
    actorId: string;
    now: () => Date;
    orders: OwnerOrdersDeps['orders'] & { list(workspaceId: string): Promise<{ id: string; businessId: string; buyerEmail: string; title: string; status: OrderFacts['payment'] }[]> };
    fulfilment: OwnerOrdersDeps['fulfilment'];
    email: { send(input: { to: string; subject: string; text: string; idempotencyKey?: string }): Promise<{ id: string }> };
  };
}

type G = typeof globalThis & { __aimpInbox?: Inbox };

const money = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** The one inbox of this process. `model` stays null until a key is connected. */
export function inboxFor(rt: InboxRuntime, model: AgentModel | null = null): Inbox {
  const g = globalThis as G;
  if (g.__aimpInbox) return g.__aimpInbox;
  let n = 0;
  const inbox = createInbox({
    now: () => Date.now(),
    newId: () => `msg-${Date.now().toString(36)}-${++n}`,
    model,
    send: (m) => rt.orderDemo.email.send({ to: m.to, subject: m.subject, text: m.text, idempotencyKey: m.idempotencyKey }),
    orders: (businessId) => orderFacts(rt, businessId),
    shop: (businessId) => shopFacts(rt, businessId),
  });
  g.__aimpInbox = inbox;
  return inbox;
}

export async function orderFacts(rt: InboxRuntime, businessId: string): Promise<OrderFacts[]> {
  const o = rt.orderDemo;
  const all = (await o.orders.list(o.workspaceId)).filter((x) => x.businessId === businessId);
  if (!all.length) return [];
  const page = await listOwnerOrders({ orders: o.orders, fulfilment: o.fulfilment, now: o.now }, { workspaceId: o.workspaceId, businessId, actorId: o.actorId }, { limit: 100 });
  const state = new Map(page.orders.map((p) => [p.id, p]));
  return all.map((x) => {
    const p = state.get(x.id);
    return { orderId: x.id, buyerEmail: x.buyerEmail, title: x.title, payment: x.status, delivery: p?.deliveryState ?? 'not_started', deliveredAt: p?.deliveredAt ?? null };
  });
}

export async function shopFacts(rt: InboxRuntime, businessId: string): Promise<ReceptionistInput['shop']> {
  const o = rt.orderDemo;
  const listings = await rt.catalogue.listApprovedForBusiness({ workspaceId: o.workspaceId, businessId, actorUserId: o.actorId, idempotencyKey: `inbox:${businessId}` }, businessId);
  const slug = rt.slugs.get(businessId);
  return {
    name: 'the shop',
    products: listings.map((l) => ({ title: l.title, priceLabel: money(l.priceMinor), summary: l.shortDescription })),
    policies: ['Digital downloads are emailed after payment.'],
    allowedLinks: slug ? [`/s/${slug}`] : [],
  };
}

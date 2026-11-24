import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../../start/_server/runtime';
import { UnknownBusiness } from '../../overview-view';
import { loadOrder, ordersSource } from '../_server/orders';
import { OrderDetailView } from './order-detail-view';
import { buildDetail, ordersHref } from '../view-model';
import '../orders.css';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';

// Screen 20: one order of an existing business. Same in-memory DEMO runtime as /start and the other /app pages (lost on restart), and off
// in production unless the demo tools are enabled. An unknown order, or one that belongs to another business, is a 404 (the two cannot be
// told apart). An order paid through the sample seller account is marked as a test order (decided on the server).
export default async function OrderDetailPage({ params }: { params: Promise<{ business: string; orderId: string }> }) {
  const { business, orderId } = await params;
  const a = availability();
  if (!a.available) {
    return (
      <AppLayout width="regular">
        <AppIntro title="This page is not switched on here" />
        <GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  if (!checkBusiness(business)) return <UnknownBusiness />;

  let id: string;
  try { id = decodeURIComponent(orderId); } catch { notFound(); }

  let found;
  let viewerId: string | null;
  try {
    const rt = runtime();
    const source = ordersSource(rt);
    viewerId = source?.actorId ?? null; // from the server, never from the request: only used to say "You" on the timeline
    found = await loadOrder(rt, source, business, id);
  } catch (e) {
    console.error('[app order] could not load the order:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Order">{null}</AppIntro>
        <GlassState kind="error" title="We could not load this order" action={<GlassButton href={ordersHref(business)}>Back to your orders</GlassButton>}>
          <p>Something went wrong while reading the order. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) notFound();
  return <OrderDetailView businessId={business} orderId={found.order.id} vm={buildDetail(business, found.order, viewerId, found.test)} />;
}

import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadOrders, ordersSource } from './_server/orders';
import { OrdersUnavailable, OrdersView } from './orders-view';
import { buildList, ordersHref, parseCursor, parseFilter } from './view-model';
import './orders.css';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

type Query = { [key: string]: string | string[] | undefined };

// Screen 19: the orders of an existing business. Same in-memory DEMO runtime as /start and the other /app pages (lost on restart), and off
// in production unless the demo tools are enabled. `?filter=all|needs_attention|delivered|refunded` picks the filter, `?cursor=` the page.
// The /start runtime has an order store (AMP-103); orders paid through the sample seller account are marked as test orders.
export default async function OrdersPage({ params, searchParams }: { params: Promise<{ business: string }>; searchParams: Promise<Query> }) {
  const { business } = await params;
  const q = await searchParams;
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

  const filter = parseFilter(q.filter);
  const cursor = parseCursor(q.cursor);
  let found;
  try {
    const rt = runtime();
    found = await loadOrders(rt, ordersSource(rt), business, { filter, cursor });
  } catch (e) {
    console.error('[app orders] could not load the orders:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Orders">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your orders" action={<GlassButton href={ordersHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your orders. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (!found.available) return <OrdersUnavailable businessId={business} />;
  return <OrdersView businessId={business} vm={buildList(business, found.page, found.cursor, found.testIds)} />;
}

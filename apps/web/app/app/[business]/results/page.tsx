import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { loadOrders, ordersSource } from '../orders/_server/orders';
import type { OrdersRuntime } from '../orders/_server/orders';
import { funnelStore, funnelView } from '../../../../lib/aimp/funnel/funnel';
import { UnknownBusiness } from '../overview-view';

export const metadata: Metadata = { title: 'Shop results' };
export const dynamic = 'force-dynamic';

// Where buyers drop off: visits -> pressed Buy -> paid. Visits and clicks are anonymous session counts; paid orders come from real
// order records only (test orders excluded).
export default async function ResultsPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="Shop results" /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const c = funnelStore().counts(business, 30, new Date());
  let paid: number | null = null;
  try {
    const rt = runtime() as unknown as OrdersRuntime;
    const found = await loadOrders(rt, ordersSource(rt), business, { filter: 'all', cursor: null });
    if (found.found && found.available) paid = found.page.orders.filter((o) => o.paidAt && !found.testIds.includes(o.id)).length;
  } catch { paid = null; }
  const v = funnelView({ visits: c.visit, checkoutClicks: c.checkout_click, paidOrders: paid ?? 0 });
  const steps = [
    { label: 'Visited your shop', n: v.visits, rate: null as number | null },
    { label: 'Pressed Buy', n: v.checkoutClicks, rate: v.clickRate },
    { label: 'Paid', n: paid === null ? null : v.paidOrders, rate: paid === null ? null : v.payRate },
  ];
  const max = Math.max(1, v.visits);
  return (
    <AppLayout width="regular">
      <AppIntro title="Shop results"><p>The last 30 days. Visits and Buy presses are counted once per browser visit, without cookies. Paid orders come from your real orders, not test ones.</p></AppIntro>
      <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {steps.map((s) => (
          <li key={s.label} style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong>{s.label}</strong>
              <span>{s.n === null ? 'not available' : s.n}{s.rate !== null ? ` (${s.rate}% of the step before)` : ''}</span>
            </div>
            <div aria-hidden="true" style={{ height: 10, borderRadius: 6, background: 'color-mix(in srgb, currentColor 10%, transparent)' }}>
              <div style={{ height: '100%', width: `${s.n === null ? 0 : Math.round((Math.min(s.n, max) / max) * 100)}%`, borderRadius: 6, background: 'var(--amg-accent, #573496)' }} />
            </div>
          </li>
        ))}
      </ol>
      <GlassNotice tone="info" title="Where people drop off"><p>{v.biggestDrop}</p></GlassNotice>
    </AppLayout>
  );
}

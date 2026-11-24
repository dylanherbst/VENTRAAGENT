// Orders queue (screen 19) on the Peach & Lavender glass library. A server component: it only draws what the view model says.
import Link from 'next/link';
import { AppIntro, AppLayout, GlassBadge, GlassCard, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { DEMO_NOTE, NO_STORE_TEXT, NO_STORE_TITLE, TEST_ORDER_LABEL } from './view-model';
import type { ListVM } from './view-model';

function Intro({ businessId }: { businessId: string }) {
  return (
    <AppIntro title="Orders" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
      <p>Who bought from your store, whether it was paid, and whether the file reached them.</p>
      <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
      <Link href={`/app/${businessId}`} className="plg-link apo-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
    </AppIntro>
  );
}

/** No order store connected to this server session: say exactly that, and do not show a zero. */
export function OrdersUnavailable({ businessId }: { businessId: string }) {
  return (
    <AppLayout width="wide">
      <Intro businessId={businessId} />
      <GlassState kind="empty" title={NO_STORE_TITLE} data-testid="orders-unavailable"><p>{NO_STORE_TEXT}</p></GlassState>
    </AppLayout>
  );
}

export function OrdersView({ businessId, vm }: { businessId: string; vm: ListVM }) {
  return (
    <AppLayout width="wide">
      <Intro businessId={businessId} />
      <GlassCard heading="h2" title="Your orders" data-testid="orders">
        <nav aria-label="Filter orders">
          <ul className="apo-filters">
            {vm.tabs.map((t) => (
              <li key={t.filter}>
                <Link href={t.href} className="apo-filter" aria-current={t.current ? 'page' : undefined} data-testid={`filter-${t.filter}`}>
                  {t.name} <span aria-hidden="true">({t.count})</span><span className="plg-sr">, {t.count} orders</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="plg-note" role="status" data-testid="list-summary">{vm.summary}</p>
        {vm.testNote ? <p className="plg-note" data-testid="test-count-note">{vm.testNote}</p> : null}

        {vm.empty ? (
          <GlassState kind="empty" title={vm.empty.title} data-testid="empty-state"><p>{vm.empty.text}</p></GlassState>
        ) : (
          <ul className="apo-list" data-testid="order-list">
            {vm.rows.map((r) => (
              <li key={r.id} className="apo-item" data-testid="order-row" data-payment={r.payment.label} data-delivery={r.delivery.label}>
                <h3>{r.title}</h3>
                {r.test ? <p><GlassBadge tone="demo" data-testid="test-order-label">{TEST_ORDER_LABEL}</GlassBadge></p> : null}
                <div className="apo-meta">
                  <span>Amount: <strong>{r.amount}</strong></span>
                  <span>Buyer: {r.buyer}</span>
                  <span>Placed: {r.created}</span>
                </div>
                <div className="apo-meta">
                  <span>Payment: <GlassBadge tone={r.payment.tone}>{r.payment.label}</GlassBadge></span>
                  <span>Delivery: <GlassBadge tone={r.delivery.tone}>{r.delivery.label}</GlassBadge></span>
                </div>
                {r.attention ? <GlassNotice tone="warn" title="Needs your attention" live="none" data-testid="row-attention"><p>{r.attention}</p></GlassNotice> : null}
                <Link href={r.href} className="plg-link apo-link" data-target="large" data-testid="open-order">
                  Open order<span className="plg-sr"> for {r.title}, placed {r.created}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {vm.nextHref || vm.firstPageHref ? (
          <nav aria-label="Pages of orders" className="apo-pager">
            {vm.firstPageHref ? <Link href={vm.firstPageHref} className="plg-link apo-link" data-target="large" data-testid="first-page">Back to the newest orders</Link> : null}
            {vm.nextHref ? <Link href={vm.nextHref} className="plg-link apo-link" data-target="large" data-testid="next-page">Show older orders</Link> : null}
          </nav>
        ) : null}
      </GlassCard>
    </AppLayout>
  );
}

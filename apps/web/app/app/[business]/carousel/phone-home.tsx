// Phone Home (Mobile UX Bible 1.2, pages 2-4, 9-11): one display number, one pearl feature card with a single action,
// two-column glass tiles with one status glow each (a label and icon carry the same meaning as the colour). Shown only at 690px and below.
import Link from 'next/link';
import type { CarouselData } from './carousel-data';

type Glow = 'attention' | 'loading' | 'finished' | 'working' | 'idle';
const GLOW_LABEL: Record<Glow, string> = { attention: 'Needs attention', loading: 'Loading', finished: 'Finished', working: 'Work in progress', idle: '' };
const GLOW_MARK: Record<Glow, string> = { attention: '!', loading: '…', finished: '✓', working: '✦', idle: '' };

function Tile({ title, note, value, glow, href }: { title: string; note: string; value?: string; glow: Glow; href: string | null }) {
  const body = (
    <>
      <span className="ph-tile-top">
        {glow !== 'idle' ? <span className="ph-chip" data-glow={glow}><span aria-hidden="true">{GLOW_MARK[glow]}</span> {GLOW_LABEL[glow]}</span> : <span />}
        {value ? <span className="ph-num">{value}</span> : null}
      </span>
      <span className="ph-tile-title">{title}</span>
      <span className="ph-tile-note">{note}</span>
    </>
  );
  return href ? <Link className="ph-tile" data-glow={glow} href={href}>{body}</Link> : <div className="ph-tile" data-glow={glow}>{body}</div>;
}

export function PhoneHome({ data }: { data: CarouselData }) {
  const live = data.tasks.find((t) => t.id === 'store')?.done ?? false;
  const tile = (id: string) => data.tiles.find((t) => t.id === id);
  const gross = tile('gross');
  const orders = tile('orders');
  const left = data.total - data.done;
  const paymentsDone = data.tasks.find((t) => t.id === 'payments')?.done ?? false;
  const productDone = data.tasks.find((t) => t.id === 'product')?.done ?? false;
  const next = data.next;
  const [done2, total2] = [String(data.done).padStart(2, '0'), String(data.total).padStart(2, '0')];
  return (
    <div className="ph" aria-label="Home">
      <div className="ph-wash" aria-hidden="true" />
      <header className="ph-head">
        <span className="ph-name">{data.businessName}</span>
        <span className="ph-state" data-live={live ? 'true' : 'false'}>{live ? 'Live' : 'Setup'}</span>
      </header>
      {live ? (
        <p className="ph-display"><span className="ph-sr">Sales, last 30 days: </span>{gross?.value ?? '—'}<small>{gross?.unknown ? 'Not measured yet' : 'Sales'}</small></p>
      ) : (
        <p className="ph-display"><span className="ph-sr">Launch checklist: </span><span>{done2}</span><span className="ph-dim"> / {total2}</span><small>Launch checklist</small></p>
      )}
      <section className="ph-feature" aria-label={live ? 'Website published' : 'Next step'}>
        <div className="ph-feature-top">
          <div><p className="ph-label">{live ? 'Website published' : 'Next step'}</p><h2>{live ? data.businessName : (next?.label ?? 'Launch complete')}</h2><p className="ph-note">{live ? data.storeText : `${left} ${left === 1 ? 'step' : 'steps'} left`}</p></div>
          {!live ? <p className="ph-big">{left}</p> : <p className="ph-big">{orders?.value ?? '0'}<small>orders</small></p>}
        </div>
        {next?.href && !live ? (
          <Link className="ph-track" href={next.href}><span className="ph-go" aria-hidden="true">→</span><span>{next.action === 'Continue building' ? next.label : next.action}</span><span className="ph-dot" aria-hidden="true" /></Link>
        ) : null}
      </section>
      <div className="ph-grid">
        <Tile title="Products" note={productDone ? 'Your product is ready' : 'Not ready yet'} glow={productDone ? 'finished' : 'idle'} href={`/app/${data.businessId}/products`} />
        <Tile title="Orders" note={orders?.note ?? ''} value={orders?.value} glow="idle" href={data.ordersHref} />
        <Tile title="Payments" note={paymentsDone ? 'Buyers can check out' : 'Checkout is unavailable'} glow={paymentsDone ? 'finished' : 'attention'} href={`/app/${data.businessId}/payments`} />
        <Tile title="Growth" note="Plan your first campaign" glow="idle" href={data.marketingHref} />
        {data.aiTeam ? <Tile title="AI Team" note={data.aiTeam.pending ? `${data.aiTeam.pending} ${data.aiTeam.pending === 1 ? 'post' : 'posts'} waiting for you` : 'Nothing to approve'} glow={data.aiTeam.pending ? 'attention' : 'idle'} href={data.aiTeam.href} /> : null}
      </div>
      {data.attention ? <p className="ph-note ph-attn" role="status"><b>Needs attention:</b> {data.attention.title}</p> : null}
    </div>
  );
}

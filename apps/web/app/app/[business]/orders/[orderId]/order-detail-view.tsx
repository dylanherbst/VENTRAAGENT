'use client';
// Order detail (screen 20) on the Peach & Lavender glass library. The two recovery actions go through `orderAction`, which checks the
// request and then runs the owner-orders service (resend the delivery email, send a new link). No refund is issued from here: the refund
// card only shows the state. After an action the page reloads what the service now says.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassKeyValue, GlassNotice } from '../../../../design-system/aimp-glass';
import { orderAction } from '../actions';
import { DEMO_NOTE, TEST_ORDER_LABEL, newRequestKey } from '../view-model';
import type { ActionVM, DetailVM } from '../view-model';

const UNREACHABLE = 'We could not reach the server, so nothing was sent. Try again.';

export function OrderDetailView({ businessId, orderId, vm }: { businessId: string; orderId: string; vm: DetailVM }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);

  async function run(a: ActionVM) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(a.kind); setNotice(null);
    try {
      const r = await orderAction(businessId, orderId, a.kind, newRequestKey(() => crypto.randomUUID()));
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done.' : 'Nothing was changed.') });
      if (r.ok) router.refresh();
    } catch { setNotice({ ok: false, text: UNREACHABLE }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  return (
    <AppLayout width="wide">
      <AppIntro eyebrow="Order" title={vm.title}
        badges={<><GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge><GlassBadge tone={vm.payment.tone} data-testid="payment-state">{vm.payment.label}</GlassBadge><GlassBadge tone={vm.delivery.tone} data-testid="delivery-state">{vm.delivery.label}</GlassBadge></>}>
        <p>What was bought, whether it was paid, and whether the file reached the buyer. {vm.updated}.</p>
        <p className="plg-note" data-testid="demo-note">{DEMO_NOTE}</p>
        <Link href={vm.backHref} className="plg-link apo-link" data-target="large" data-testid="back-to-orders">Back to your orders</Link>
      </AppIntro>

      {vm.test ? <GlassNotice tone="warn" title={TEST_ORDER_LABEL} live="none" data-testid="test-order-label"><p>This order was made with the sample seller account. It is not a real sale and no real money moved.</p></GlassNotice> : null}
      {notice ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'done' : 'failed'} /> : null}
      {vm.attention ? <GlassNotice tone="warn" title="This order needs your attention" data-testid="attention"><p>{vm.attention}</p></GlassNotice> : null}

      <GlassCard heading="h2" title="Order" data-testid="order-facts">
        <GlassKeyValue items={vm.facts} />
        <h3 className="plg-text"><strong>What was bought</strong></h3>
        <ul className="plg-list" data-testid="line-items">
          {vm.lineItems.map((l) => <li key={l.title + l.version}>{l.title}, {l.version}: {l.amount}</li>)}
        </ul>
      </GlassCard>

      <GlassCard heading="h2" title="Delivery" badges={<GlassBadge tone={vm.delivery.tone}>{vm.delivery.label}</GlassBadge>} data-testid="delivery">
        <GlassKeyValue items={vm.deliveryFacts} />
        {vm.deliveryError ? <p className="plg-text" data-testid="delivery-error">Last problem: {vm.deliveryError}</p> : null}
        <h3 className="plg-text"><strong>Download links</strong></h3>
        <p className="plg-text" data-testid="access-state">{vm.access.stateLabel}. {vm.access.summary}</p>
        {vm.access.grants.length ? (
          <ul className="plg-list" data-testid="grants">
            {vm.access.grants.map((g) => <li key={g.id}><GlassBadge tone={g.tone}>{g.state}</GlassBadge> {g.line}</li>)}
          </ul>
        ) : null}
      </GlassCard>

      <GlassCard heading="h2" title="What you can do" data-testid="actions">
        <ul className="apo-actions">
          {vm.actions.map((a) => (
            <li key={a.kind} className="apo-action" data-testid={`action-${a.kind}`}>
              <GlassButton variant="secondary" onClick={() => { void run(a); }} loading={busy === a.kind} loadingLabel={a.pending} disabled={!a.allowed || busy !== ''}
                aria-describedby={`apo-why-${a.kind}`}>{a.label}</GlassButton>
              <p className="plg-note" id={`apo-why-${a.kind}`}>{a.allowed ? a.confirm : a.reason}</p>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard heading="h2" title="Refund" badges={<GlassBadge tone={vm.refund.needsOwner ? 'warn' : 'neutral'}>{vm.refund.stateLabel}</GlassBadge>} data-testid="refund">
        <p className="plg-text">{vm.refund.note}</p>
        {vm.refund.events.length ? <GlassKeyValue layout="stack" items={vm.refund.events} /> : <p className="plg-text">No refund or dispute has been recorded for this order.</p>}
      </GlassCard>

      <GlassCard heading="h2" title="What happened" data-testid="timeline">
        {vm.timeline.length ? (
          <ol className="apo-timeline">
            {vm.timeline.map((t) => <li key={t.key}><strong>{t.label}</strong><span className="plg-note">{t.when} · {t.actor}</span></li>)}
          </ol>
        ) : <p className="plg-text">Nothing has happened to this order yet.</p>}
      </GlassCard>
    </AppLayout>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AppIntro, GlassBadge, GlassButton, GlassCard, GlassField, GlassIcon, GlassKeyValue, GlassNotice, GlassState } from '../../design-system/aimp-glass';
import { formatPrice } from '../../../lib/aimp/storefront/load';
import { paymentsState, testPurchaseAction } from '../actions';
import { journeyRoute } from '../journey';
import { JourneyShell, LoadingState, NeedBusiness, useJourney } from '../journey-client';
import type { PaymentsState } from '../journey-types';
import type { TestPurchaseSummary } from '../_server/orders-runtime';

export function PaymentsView() {
  const { ready, journey } = useJourney();
  const [payments, setPayments] = useState<PaymentsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TestPurchaseSummary | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let live = true;
    paymentsState().then((p) => { if (live) setPayments(p); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current || !journey) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const r = await testPurchaseAction(journey.businessId, email);
      if (r.ok) setResult(r.summary); else { setResult(null); setError(r.message); }
    } catch { setError('We could not reach the server, so nothing was bought. Try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const shell = { step: 'payments' as const, backHref: journeyRoute('store'), backLabel: 'Back to your store' };
  if (!ready) return <JourneyShell {...shell}><LoadingState title="Loading payments…" /></JourneyShell>;
  if (!journey) return <JourneyShell {...shell}><NeedBusiness /></JourneyShell>;
  if (failed) return <JourneyShell {...shell}><GlassState kind="error" title="We could not load payments" action={<GlassButton block={false} onClick={() => window.location.reload()}>Try again</GlassButton>}><p>Nothing was changed.</p></GlassState></JourneyShell>;
  if (!payments) return <JourneyShell {...shell}><LoadingState title="Loading payments…" /></JourneyShell>;

  const r = payments.readiness;
  return (
    <JourneyShell {...shell} footer={<>
      <GlassButton variant="primary" href={`/app/${encodeURIComponent(journey.businessId)}/marketing`} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Get customers: make my launch kit</GlassButton>
      <GlassButton variant="secondary" href={journeyRoute('store')}>Back to your store</GlassButton>
    </>}>
      <AppIntro eyebrow={journey.idea.niche} title="Payments and a test purchase">
        <p>Check what is needed to take real payments, and try one test purchase to see exactly what a buyer would get.</p>
      </AppIntro>
      <p className="plg-badges" data-testid="connection-state">
        <GlassBadge dot>Test payments only · no card, no Stripe, no money</GlassBadge>
        <GlassBadge dot>No email is sent</GlassBadge>
      </p>

      <GlassCard heading="h2" eyebrow="Real payments" title={r.canAcceptPayments ? 'Ready to take payments' : 'Not connected yet'} data-testid="payments-status"
        badges={<GlassBadge tone={r.canAcceptPayments ? 'success' : 'warn'} dot>{r.canAcceptPayments ? 'Ready' : 'Waiting'}</GlassBadge>}>
        <p className="plg-card-title">{r.nextAction.label}</p>
        <p className="plg-text">{r.nextAction.why}</p>
        {r.outstanding.length > 0 ? <p className="plg-text">Still needed: {r.outstanding.join(', ')}.</p> : null}
        <p className="plg-note">{payments.adapterNote} Until then your shop can be published, but nobody can be charged.</p>
      </GlassCard>

      <GlassCard heading="h2" eyebrow="Try it yourself" title="Run a test purchase" data-testid="test-purchase"
        footer={<GlassButton variant="primary" icon={<GlassIcon name="spark" size={22} tone="deep" />} loading={busy} loadingLabel="Buying…" disabled={busy}
          onClick={() => (document.getElementById('test-purchase-form') as HTMLFormElement | null)?.requestSubmit()}>Run a test purchase</GlassButton>}>
        <p className="plg-text">This buys your approved product as a pretend customer, using a test payment. Then it sends the same payment again, the way a payment provider can, to show that nobody gets a second delivery.</p>
        <form id="test-purchase-form" className="plg-stack" data-gap="3" onSubmit={submit} noValidate>
          <GlassField label="Buyer email" name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} error={error || undefined}
            hint="Use your own address. It is only written on the test order; nothing is emailed." />
        </form>
        {result ? (
          <div className="plg-stack" data-gap="3" data-testid="test-result" aria-live="polite">
            <GlassNotice tone="success" title="Test payment accepted">
              <p>{result.productTitle} · {formatPrice(result.priceMinor)} · order {result.orderStatus}.</p>
            </GlassNotice>
            <GlassKeyValue items={[
              { label: 'Download links created', value: <span data-testid="grants">{result.deliveries.grants}</span> },
              { label: 'Delivery emails (not really sent)', value: <span data-testid="emails">{result.deliveries.emails}</span> },
              { label: 'File', value: result.fileName },
            ]} />
            {result.downloadToken ? <p><a className="plg-link" data-target="large" data-testid="download" href={`/start/payments/download/${encodeURIComponent(result.downloadToken)}`}>Open the download a buyer would get</a></p> : null}
            <GlassNotice tone={result.replay.secondDelivery ? 'error' : 'success'} title={result.replay.secondDelivery ? 'A second delivery was made' : 'Payment sent again: no second delivery'} data-testid="replay">
              <p>The same payment was sent a second time. Result: {result.replay.outcome.replace(/_/g, ' ')}. Download links: {result.replay.grants}. Delivery emails: {result.replay.emails}.</p>
            </GlassNotice>
          </div>
        ) : null}
      </GlassCard>
    </JourneyShell>
  );
}

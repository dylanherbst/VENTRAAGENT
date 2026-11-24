import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { resolveStatus } from '../../../../lib/aimp/providers/status';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadPayments, paymentsSource } from './_server/payments';
import { PaymentsUnavailable, PaymentsView } from './payments-view';
import { buildPayments, buildUnavailable, paymentsHref } from './view-model';
import './payments.css';

export const metadata: Metadata = { title: 'Payments' };
export const dynamic = 'force-dynamic';

// Screen 18: whether an existing business can take payments and receive payouts. Same in-memory DEMO runtime as /start and the other
// /app pages (lost on restart), and off in production unless the demo tools are enabled. Read-only: no call to Stripe is made and there
// is no connect button. The /start runtime carries one seller account store (AMP-107), so this page reads the business's account from it;
// only a runtime without that store shows the "not available" state. The site's real payment provider status (the same
// `resolveStatus('payments', ...)` /start uses) is shown beside it, and a sample account is always labelled as sample.
export default async function PaymentsPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
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

  let found;
  let provider;
  try {
    const status = resolveStatus('payments', process.env);
    provider = { status: status.status, label: status.label };
    const rt = runtime();
    found = loadPayments(rt, paymentsSource(rt), provider, business);
  } catch (e) {
    console.error('[app payments] could not load the payment state:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Payments">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your payment setup" action={<GlassButton href={paymentsHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your payment setup. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (!found.available) return <PaymentsUnavailable businessId={business} vm={buildUnavailable(provider)} />;
  return <PaymentsView businessId={business} vm={buildPayments(found.input)} />;
}

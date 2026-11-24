import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { resolveAllStatuses } from '../../../../lib/aimp/providers/status';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { paymentsSource } from '../payments/_server/payments';
import { loadIntegrations } from './_server/integrations';
import { IntegrationsView } from './integrations-view';
import { buildIntegrations, integrationsHref } from './view-model';
import './integrations.css';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

// Screen 39: which outside services this business is connected to. Same in-memory DEMO runtime as /start and the other /app pages
// (lost on restart), and off in production unless the demo tools are enabled. Read-only: no provider is called and there is no
// connect button. Stripe is the only service with a per-business state (the seller account store the Payments page reads); every
// other service is shown as not connected, with the site's real provider status (`resolveAllStatuses`) beside it. Only status
// kinds leave the server: no key, token, account id or environment variable name is passed to the view.
export default async function IntegrationsPage({ params }: { params: Promise<{ business: string }> }) {
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
  try {
    const statuses = resolveAllStatuses(process.env);
    const rt = runtime();
    found = loadIntegrations(rt, paymentsSource(rt), statuses, business);
  } catch (e) {
    console.error('[app integrations] could not load the integration state:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Integrations">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your integrations" action={<GlassButton href={integrationsHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your connections. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  return <IntegrationsView businessId={business} vm={buildIntegrations(found.input)} />;
}

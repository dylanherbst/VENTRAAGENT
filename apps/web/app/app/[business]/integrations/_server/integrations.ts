// Server reads for Integrations (screen 39, AMP-132). Plain functions that take the runtime, the seller source and the provider
// statuses as arguments, so they run in the node tests without Next. No second loader is invented here: the Stripe state of a
// business is read through the Payments page's own `loadPayments` (same ownership check, same workspace-scoped seller store, same
// `deriveReadiness` and `checkoutGate`), and the site's provider statuses come from `resolveAllStatuses` (lib/aimp/providers/status.ts).
// Nothing here talks to Stripe or any network.
//
// WHAT CROSSES TO THE VIEW MODEL. Only: the readiness words, whether checkout is open, the status KIND of each provider
// (live / test / fixture / disconnected / disabled) and one boolean that says the seller account is a sample. Never an account id,
// a key, a token, an environment variable name or `credentialsPresent`.
import { PROVIDER_IDS } from '../../../../../lib/aimp/flags.ts';
import type { ProviderId } from '../../../../../lib/aimp/flags.ts';
import type { ProviderStatus } from '../../../../../lib/aimp/providers/types.ts';
import { isSampleSellerAccountId } from '../../../../../lib/aimp/sellers/sample.ts';
import { loadPayments } from '../../payments/_server/payments.ts';
import type { PaymentsRuntime, PaymentsSource } from '../../payments/_server/payments.ts';
import type { IntegrationsInput, SiteStatusInput, StripeInput } from '../view-model.ts';

export type IntegrationsRuntime = PaymentsRuntime;
export type IntegrationsSource = PaymentsSource;
export type ProviderStatuses = Readonly<Record<ProviderId, Pick<ProviderStatus, 'status' | 'label'>>>;

export type IntegrationsLookup = { found: false } | { found: true; input: IntegrationsInput };

/** Only the status kind of each provider, in the order the lib lists them. Labels, reasons and credential flags stay on the server. */
export function siteStatuses(statuses: ProviderStatuses): SiteStatusInput[] {
  return PROVIDER_IDS.map((id) => ({ id, status: statuses[id].status }));
}

/**
 * Unknown business => `found: false` (decided by `loadPayments`, before any account is read). No seller store in this runtime =>
 * `stripe.available: false`. A seller account counts as a sample unless the site's payment provider is live AND the account is
 * not one of the fixture/sample accounts: when in doubt it is labelled sample, never implied to be live.
 */
export function loadIntegrations(rt: IntegrationsRuntime, source: IntegrationsSource | null, statuses: ProviderStatuses, businessId: string): IntegrationsLookup {
  const provider = { status: statuses.payments.status, label: statuses.payments.label };
  const pay = loadPayments(rt, source, provider, businessId);
  if (!pay.found) return { found: false };
  const site = siteStatuses(statuses);
  if (!pay.available || !source) return { found: true, input: { stripe: { available: false, site: provider.status }, site } };
  const account = source.accounts.get(source.workspaceId, businessId);
  const sample = account ? provider.status !== 'live' || isSampleSellerAccountId(account.stripeAccountId) : false;
  const stripe: StripeInput = {
    available: true,
    site: provider.status,
    state: pay.input.readiness.state,
    canAcceptPayments: pay.input.readiness.canAcceptPayments,
    checkoutOpen: pay.input.gate.enabled,
    outstanding: [...pay.input.readiness.outstanding],
    hasAccount: Boolean(account),
    sample,
  };
  return { found: true, input: { stripe, site } };
}

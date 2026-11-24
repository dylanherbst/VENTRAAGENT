// View model for Integrations (screen 39, AMP-132). Pure: no Next, no runtime, no environment. It turns the seller readiness of this
// business and the site's provider status kinds into the words the page shows. It decides nothing itself: "can take payments" is the
// readiness rule AND the checkout gate, both worked out on the server. Only Stripe has a per-business state today; every other
// service is "Not connected" for the business, with "Coming later" beside it, because nothing in this app can connect one yet.
// No id, key, token or environment variable name ever enters this file.
import type { ProviderId } from '../../../../lib/aimp/flags.ts';
import type { ProviderStatusKind } from '../../../../lib/aimp/providers/types.ts';
import type { SellerState } from '../../../../lib/aimp/sellers/types.ts';

export type Tone = 'neutral' | 'success' | 'warn' | 'danger';
export interface Fact { label: string; tone: Tone; text: string }

export interface SiteStatusInput { id: ProviderId; status: ProviderStatusKind }

export type StripeInput =
  | { available: false; site: ProviderStatusKind }
  | {
    available: true;
    site: ProviderStatusKind;
    state: SellerState;
    canAcceptPayments: boolean;
    checkoutOpen: boolean;
    /** Plain-English list from the readiness rules (lib/aimp/sellers/readiness.ts). */
    outstanding: string[];
    hasAccount: boolean;
    /** The seller account is a fixture or sample account, or the site's payments run on sample data. */
    sample: boolean;
  };

export interface IntegrationsInput { stripe: StripeInput; site: SiteStatusInput[] }

export interface StripeVM {
  name: string;
  what: string;
  /** This business's payment account. */
  account: Fact;
  /** The payment provider of this whole site. */
  site: Fact;
  canTakePayments: boolean;
  outstanding: string[];
  /** Set when the account or the site's payments are sample data. */
  sampleNote: string | null;
  /** "Coming later" while this business has no payment account to show; null once it has one. */
  timing: string | null;
  /** Why there is no connect button. */
  connectNote: string;
}

export interface ServiceVM {
  id: ProviderId;
  name: string;
  what: string;
  /** Always "Not connected": no business can connect its own account to this service yet. */
  account: Fact;
  /** "Coming later". */
  timing: string;
  /** What this site itself is doing for this service today. */
  site: Fact;
}

export interface IntegrationsVM { stripe: StripeVM; services: ServiceVM[] }

export const DEMO_NOTE = 'This is the demo. What you see here is kept in memory on this server and is lost when the app restarts.';
export const COMING_LATER = 'Coming later';
export const NO_CONNECT_NOTE = 'You cannot connect or disconnect anything from this page yet. Connecting your own accounts is coming later.';
export const STRIPE_SAMPLE_NOTE = 'Sample data. This is not a real Stripe account. No real card is charged and no real money moves.';
export const STRIPE_UNAVAILABLE = 'A business made in this demo has no payment account, and one cannot be connected from here yet. This is not a problem with your business.';

export const integrationsHref = (businessId: string): string => `/app/${businessId}/integrations`;
export const paymentsHref = (businessId: string): string => `/app/${businessId}/payments`;

const SELLER: Record<SellerState, { label: string; tone: Tone; text: string }> = {
  not_connected: { label: 'Not connected', tone: 'neutral', text: 'No Stripe account is connected to this business, so it cannot take payments yet.' },
  onboarding_incomplete: { label: 'Setup not finished', tone: 'warn', text: 'A Stripe account was started but setup is not finished, so payments are off.' },
  under_review: { label: 'Being checked', tone: 'neutral', text: 'Stripe is checking the account. Payments stay off until it finishes.' },
  restricted: { label: 'Payments paused', tone: 'danger', text: 'Stripe has paused this account, so payments are off.' },
  ready: { label: 'Connected', tone: 'success', text: 'The Stripe account is connected and set up.' },
};

const SITE: Record<ProviderStatusKind, { label: string; tone: Tone; text: string }> = {
  live: { label: 'On for this site', tone: 'success', text: 'This site is set to use the real service. We have not checked that it is working.' },
  test: { label: 'Sample data', tone: 'neutral', text: 'This site uses sample data for this. Nothing real is sent, charged or published.' },
  fixture: { label: 'Sample data', tone: 'neutral', text: 'This site uses sample data for this. Nothing real is sent, charged or published.' },
  disconnected: { label: 'Not connected', tone: 'neutral', text: 'This site is not connected to this service yet.' },
  disabled: { label: 'Switched off', tone: 'warn', text: 'This is switched off on this site.' },
};

/** What this site does for one service. An unknown status reads as not connected. */
export function siteFact(status: ProviderStatusKind): Fact {
  return { ...(SITE[status] ?? SITE.disconnected) };
}

const SERVICES: Record<Exclude<ProviderId, 'payments'>, { name: string; what: string }> = {
  social: { name: 'Pinterest', what: 'Posting your pins for you.' },
  email: { name: 'Email', what: 'Sending order emails and download links to your buyers.' },
  storage: { name: 'File storage', what: 'Keeping your product files private until someone buys.' },
  domains: { name: 'Domains and hosting', what: 'Using your own web address for your store.' },
  llm: { name: 'AI writing help', what: 'Drafting names, descriptions and ideas for you.' },
};
const ORDER: readonly Exclude<ProviderId, 'payments'>[] = ['social', 'email', 'storage', 'domains', 'llm'];

function stripeAccount(i: StripeInput): Fact {
  if (!i.available) return { label: 'Not connected', tone: 'neutral', text: STRIPE_UNAVAILABLE };
  const s = SELLER[i.state] ?? SELLER.not_connected;
  if (!i.hasAccount) return { ...SELLER.not_connected };
  if (i.sample) {
    // A sample account is never called "Connected" and never shown in the success colour.
    return { label: `Sample account: ${s.label === 'Connected' ? 'ready' : s.label.toLowerCase()}`, tone: s.tone === 'success' ? 'neutral' : s.tone, text: `${s.text} ${STRIPE_SAMPLE_NOTE}` };
  }
  if (i.state === 'ready' && !(i.canAcceptPayments && i.checkoutOpen)) {
    return { label: 'Connected, payments off', tone: 'warn', text: 'The Stripe account is set up, but checkout is closed on this site, so customers cannot pay yet.' };
  }
  return { ...s };
}

export function buildIntegrations(i: IntegrationsInput): IntegrationsVM {
  const st = i.stripe;
  const hasAccount = st.available && st.hasAccount;
  const sampleNote = hasAccount && st.sample ? STRIPE_SAMPLE_NOTE : null;
  const stripe: StripeVM = {
    name: 'Stripe',
    what: 'Taking card payments and sending the money to your bank.',
    account: stripeAccount(st),
    site: siteFact(st.site),
    // Fail closed: the seller rules and the checkout gate must agree, and a sample account never counts as taking real payments.
    canTakePayments: st.available && st.hasAccount && !st.sample && st.canAcceptPayments && st.checkoutOpen,
    outstanding: st.available && st.hasAccount ? [...st.outstanding] : [],
    sampleNote,
    timing: hasAccount ? null : COMING_LATER,
    connectNote: NO_CONNECT_NOTE,
  };
  const byId = new Map(i.site.map((s) => [s.id, s.status]));
  const services: ServiceVM[] = ORDER.map((id) => ({
    id,
    name: SERVICES[id].name,
    what: SERVICES[id].what,
    account: { label: 'Not connected', tone: 'neutral', text: 'You cannot connect your own account for this yet.' },
    timing: COMING_LATER,
    site: siteFact(byId.get(id) ?? 'disconnected'),
  }));
  return { stripe, services };
}

// View model for Seller payments and payouts (screen 18, AMP-088). Pure: no Next, no runtime, no environment. It turns the seller
// readiness (lib/aimp/sellers/readiness.ts), the checkout gate (lib/aimp/sellers/gate.ts) and the payments provider status into the
// words the page shows. It decides nothing itself: "can take payments" is `readiness.canAcceptPayments` and "checkout is open" is
// `gate.enabled`. No amounts are shown, because the seller account model holds no balance or payout amounts (only whether payouts are
// switched on), so there is no money to format here.
import type { ProviderStatusKind } from '../../../../lib/aimp/providers/types.ts';
import type { CheckoutGate } from '../../../../lib/aimp/sellers/gate.ts';
import type { SellerReadiness, SellerState } from '../../../../lib/aimp/sellers/types.ts';

export type Tone = 'neutral' | 'success' | 'warn' | 'danger';

/** The parts of `ProviderStatus` (lib/aimp/providers/types.ts) this page reads. */
export interface ProviderInput { status: ProviderStatusKind; label: string }

export interface PaymentsInput {
  readiness: SellerReadiness;
  gate: CheckoutGate;
  /** `payouts_enabled` of the seller's account, or null when there is no account. */
  payoutsEnabled: boolean | null;
  /** The seller account's id (`stripeAccountId`), or null when there is no account. Used only to tell sample accounts apart. */
  accountId: string | null;
  provider: ProviderInput;
}

export interface Fact { label: string; tone: Tone; text: string }

export interface PaymentsVM {
  canTakePayments: boolean;
  state: Fact;
  checkout: Fact;
  payouts: Fact;
  /** Plain-English list of what is still needed (empty when nothing is). */
  outstanding: string[];
  /** What to do next, or null when nothing is needed. Words only: this page has no button that connects anything. */
  next: { label: string; why: string; note: string } | null;
  provider: Fact;
  /** Set when the provider runs on sample data, so nothing here is read as real money movement. */
  sampleNote: string | null;
  amountsNote: string;
}

export const DEMO_NOTE = 'This is the demo. What you see here is kept in memory on this computer and is lost when the app restarts.';
export const NOT_AVAILABLE_TITLE = 'Payments are not available in the demo yet';
export const NOT_AVAILABLE_TEXT =
  'We cannot read a payment account for this business here, and one cannot be connected from here yet. So this business cannot take payments or receive payouts today. This is not a problem with your business.';
export const AMOUNTS_NOTE = 'Payout amounts and dates are not shown here yet. This page only tells you whether payments and payouts are switched on.';
export const SAMPLE_NOTE = 'The payment details here are sample data. No real card is charged and no real money moves.';
export const NO_CONNECT_NOTE = 'You cannot do this from this page yet. Connecting a payment account is not switched on.';

export const paymentsHref = (businessId: string): string => `/app/${businessId}/payments`;

const STATE: Record<SellerState, { label: string; tone: Tone; text: string }> = {
  not_connected: { label: 'Not connected', tone: 'neutral', text: 'No payment account is connected to this business, so it cannot take payments yet.' },
  onboarding_incomplete: { label: 'Setup not finished', tone: 'warn', text: 'A payment account was started but setup is not finished, so payments are off.' },
  under_review: { label: 'Being checked', tone: 'neutral', text: 'Stripe is checking the account. Payments stay off until it finishes.' },
  restricted: { label: 'Payments paused', tone: 'danger', text: 'Stripe has paused this account, so payments are off.' },
  ready: { label: 'Ready', tone: 'success', text: 'The payment account is connected and customers can pay by card.' },
};

const ACCOUNT_READY_GATE_CLOSED = {
  label: 'Account ready', tone: 'neutral' as Tone,
  text: 'The payment account is set up, but checkout is closed right now, so customers cannot pay by card yet.',
};

const PROVIDER: Record<string, { label: string; tone: Tone }> = {
  live: { label: 'Connected', tone: 'success' }, test: { label: 'Test mode', tone: 'neutral' }, fixture: { label: 'Sample data', tone: 'neutral' },
  disconnected: { label: 'Not connected', tone: 'neutral' }, disabled: { label: 'Switched off', tone: 'warn' },
};

/** The payment provider of this site (not of one business). An unknown status reads as not connected. */
export function providerFact(p: ProviderInput): Fact {
  const known = PROVIDER[p.status] ?? PROVIDER.disconnected;
  const text = p.status === 'live' ? 'This site is connected to the payment provider.'
    : p.status === 'test' || p.status === 'fixture' ? SAMPLE_NOTE
    : p.status === 'disabled' ? 'Payments are switched off on this site.'
    : 'This site is not connected to a payment provider yet, so no business here can take real payments.';
  return { ...known, text };
}

/**
 * The id prefix of the sample seller account the /start runtime registers (SAMPLE_SELLER_PREFIX in app/start/_server/orders-runtime.ts,
 * which is server code, so the value is repeated here and a test checks the two stay equal).
 */
export const SAMPLE_ACCOUNT_PREFIX = 'acct_sample_demo_';

/** True when this account is the sample one. It reads the account itself, never the site's provider status. */
export const isSampleAccount = (accountId: string | null | undefined): boolean => typeof accountId === 'string' && accountId.startsWith(SAMPLE_ACCOUNT_PREFIX);

// The sample notice shows when the account is a sample account OR the provider runs on sample/test data. Either alone is enough, so a
// sample account is never shown as real money whatever the provider status reads.
const isSample = (i: PaymentsInput): boolean => isSampleAccount(i.accountId) || i.provider.status === 'test' || i.provider.status === 'fixture';

function payoutsFact(i: PaymentsInput): Fact {
  if (i.payoutsEnabled === null) return { label: 'No payouts yet', tone: 'neutral', text: 'Payouts start after a payment account is connected and checked.' };
  if (i.payoutsEnabled && i.readiness.canAcceptPayments) return { label: 'Payouts are on', tone: 'success', text: 'Stripe can send the money you earn to your bank account.' };
  if (i.payoutsEnabled) return { label: 'Payouts are on', tone: 'neutral', text: 'Stripe can send money to your bank account, but payments are still off, so there is nothing new to pay out.' };
  return { label: 'Payouts are off', tone: 'warn', text: 'Stripe cannot send money to your bank account until the account setup is complete.' };
}

export function buildPayments(i: PaymentsInput): PaymentsVM {
  // "Customers can pay" is claimed only when the checkout gate is open too, never from the account state alone.
  const s = i.readiness.state === 'ready' && !i.gate.enabled ? ACCOUNT_READY_GATE_CLOSED : STATE[i.readiness.state];
  const next = i.readiness.nextAction.kind === 'none'
    ? null
    : { label: i.readiness.nextAction.label, why: i.readiness.nextAction.why, note: i.readiness.nextAction.kind === 'wait' ? 'There is nothing you need to do right now.' : NO_CONNECT_NOTE };
  return {
    // Fail closed: both the seller rules and the checkout gate must agree.
    canTakePayments: i.readiness.canAcceptPayments && i.gate.enabled,
    state: { label: s.label, tone: s.tone, text: s.text },
    checkout: i.gate.enabled ? { label: 'Checkout is open', tone: 'success', text: i.gate.reason } : { label: 'Checkout is closed', tone: 'neutral', text: i.gate.reason },
    payouts: payoutsFact(i),
    outstanding: [...i.readiness.outstanding],
    next,
    provider: providerFact(i.provider),
    sampleNote: isSample(i) ? SAMPLE_NOTE : null,
    amountsNote: AMOUNTS_NOTE,
  };
}

export interface UnavailableVM { title: string; text: string; provider: Fact }

/** The page has no seller source to read (a runtime without one): say exactly that, with the site's real provider status beside it. */
export function buildUnavailable(provider: ProviderInput): UnavailableVM {
  return { title: NOT_AVAILABLE_TITLE, text: NOT_AVAILABLE_TEXT, provider: providerFact(provider) };
}

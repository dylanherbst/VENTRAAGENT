import type { SellerReadiness, StripeAccountSnapshot } from './types.ts';

const REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  external_account: 'a bank account for payouts',
  'business_profile.url': 'your website or store address',
  'business_profile.mcc': 'what kind of business you run',
  'business_profile.product_description': 'a short description of what you sell',
  'tos_acceptance.date': 'agreeing to Stripe’s terms',
  'tos_acceptance.ip': 'agreeing to Stripe’s terms',
  'individual.verification.document': 'a photo of your ID',
  'company.verification.document': 'a business document',
  'individual.dob.day': 'your date of birth',
  'individual.first_name': 'your name',
  'individual.address.line1': 'your address',
  'business_type': 'whether you are a person or a company',
};

/** Turns Stripe requirement keys into plain English. Unknown keys become a generic phrase, never raw JSON paths. */
export function describeRequirements(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const label = REQUIREMENT_LABELS[k] ?? 'a few more details about you or your business';
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

const UNDER_REVIEW_REASONS = new Set(['under_review', 'requirements.pending_verification']);

function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Derives the seller state from Stripe Account fields. `null` (no account yet) is `not_connected`.
 * Fails closed: only a fully enabled account with active card_payments and transfers is `ready`.
 */
export function deriveReadiness(account: StripeAccountSnapshot | null): SellerReadiness {
  if (!account) {
    return {
      state: 'not_connected',
      canAcceptPayments: false,
      outstanding: [],
      nextAction: {
        label: 'Connect Stripe',
        why: 'Stripe is how you get paid. Connect it so customers can pay you directly.',
        kind: 'connect',
      },
    };
  }
  const reason = account.requirements.disabled_reason;
  const pastDue = account.requirements.past_due;
  const due = account.requirements.currently_due;
  const outstanding = describeRequirements([...pastDue, ...due]);

  // Stripe is checking the account: nothing for the seller to do except wait.
  if (reason !== null && UNDER_REVIEW_REASONS.has(reason)) {
    return {
      state: 'under_review',
      canAcceptPayments: false,
      outstanding,
      nextAction: {
        label: 'Wait for Stripe to finish checking',
        why: 'Stripe is reviewing your details. This usually takes a short while and you will not need to do anything.',
        kind: 'wait',
      },
    };
  }
  // Stripe has stopped the account (rejected, paused, listed, or any other reason we do not know): fail closed.
  if (reason !== null && reason !== 'requirements.past_due') {
    return {
      state: 'restricted',
      canAcceptPayments: false,
      outstanding,
      nextAction: {
        label: 'Contact support',
        why: 'Stripe has paused this account, so payments are off. Our support team can help you find out why.',
        kind: 'contact_support',
      },
    };
  }
  // Overdue information: Stripe will switch payments off (or already has) until it is supplied.
  if (pastDue.length > 0 || reason === 'requirements.past_due') {
    return {
      state: 'restricted',
      canAcceptPayments: false,
      outstanding,
      nextAction: {
        label: 'Send Stripe the missing details',
        why: `Stripe is waiting for ${listText(outstanding) || 'some details'}, and payments stay off until you send it.`,
        kind: 'fix_requirements',
      },
    };
  }
  if (!account.details_submitted || due.length > 0) {
    return {
      state: 'onboarding_incomplete',
      canAcceptPayments: false,
      outstanding,
      nextAction: {
        label: 'Finish setting up Stripe',
        why: due.length > 0
          ? `Stripe still needs ${listText(outstanding)} before you can take payments.`
          : 'You started connecting Stripe but have not finished. It only takes a few minutes.',
        kind: 'continue_onboarding',
      },
    };
  }
  const fullyEnabled =
    account.charges_enabled &&
    account.payouts_enabled &&
    account.capabilities.card_payments === 'active' &&
    account.capabilities.transfers === 'active';
  if (fullyEnabled) {
    return {
      state: 'ready',
      canAcceptPayments: true,
      outstanding: [],
      nextAction: { label: 'You are ready to take payments', why: 'Stripe is connected and your store can accept card payments.', kind: 'none' },
    };
  }
  // Details are in and nothing is due, but Stripe has not switched everything on yet.
  return {
    state: 'under_review',
    canAcceptPayments: false,
    outstanding: [],
    nextAction: {
      label: 'Wait for Stripe to finish checking',
      why: 'You have sent everything Stripe asked for. It is switching on payments and payouts, and you do not need to do anything.',
      kind: 'wait',
    },
  };
}

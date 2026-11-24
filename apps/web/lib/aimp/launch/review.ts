// "Review my launch" (rework brief 01-02): one plain-English checklist behind a single "Approve and publish" action.
// Pure: it reads state the guided flow already has and decides what is done, what blocks publishing, and what is
// holding up payments. Publishing is allowed while payments are pending (the shop goes live with its buy button off);
// that is stated openly, never hidden. Nothing here publishes anything: the caller runs the existing publish operation.

export type LaunchStep = 'brand' | 'catalogue' | 'store' | 'payments';
export type LaunchItemStatus = 'done' | 'todo' | 'waiting';

export interface LaunchItem { id: 'brand' | 'listing' | 'store' | 'payments'; label: string; status: LaunchItemStatus; detail: string; step: LaunchStep }

export interface LaunchReviewInput {
  brandApproved: boolean;
  approvedListings: number;
  /** A store draft exists. */
  hasStoreDraft: boolean;
  /** The form has edits that are not saved yet. */
  formDirty: boolean;
  /** The draft differs from the live version (or nothing is live yet). */
  hasUnpublishedChanges: boolean;
  /** A version is live (it may be paused). */
  hasLiveVersion: boolean;
  paused: boolean;
  /** Whether the store can take payments, and if not, what Stripe or the checkout rules say is missing. */
  buyEnabled: boolean;
  paymentsNextAction: string;
  paymentsWhy: string;
  paymentsOutstanding: readonly string[];
}

export interface LaunchReview {
  items: LaunchItem[];
  /** True when "Approve and publish" can run now. */
  canApprove: boolean;
  /** Why it cannot, in order. Empty when canApprove. */
  blockers: string[];
  /** Why buying is still off. Empty when buying is on. Does not stop publishing. */
  paymentsHolding: string[];
  headline: string;
  /** What the button does, so the caller never has to guess. */
  actionNote: string;
}

export function reviewLaunch(i: LaunchReviewInput): LaunchReview {
  const items: LaunchItem[] = [
    { id: 'brand', label: 'Brand approved', status: i.brandApproved ? 'done' : 'todo', step: 'brand', detail: i.brandApproved ? 'Your name, look and headline are approved.' : 'Approve your brand first.' },
    { id: 'listing', label: 'Product and listing approved', status: i.approvedListings > 0 ? 'done' : 'todo', step: 'catalogue',
      detail: i.approvedListings > 0 ? `${i.approvedListings} approved ${i.approvedListings === 1 ? 'listing' : 'listings'} will go in your shop.` : 'Approve your product file and its listing so there is something to sell.' },
    { id: 'store', label: 'Shop preview checked', status: !i.hasStoreDraft ? 'todo' : i.formDirty ? 'todo' : i.hasUnpublishedChanges || !i.hasLiveVersion ? 'waiting' : 'done', step: 'store',
      detail: !i.hasStoreDraft ? 'Create your shop draft.' : i.formDirty ? 'Save your edits before you publish.' : i.hasUnpublishedChanges || !i.hasLiveVersion ? 'Your draft is ready to publish.' : 'The live shop matches your draft.' },
    { id: 'payments', label: 'Payments connected', status: i.buyEnabled ? 'done' : 'waiting', step: 'payments',
      detail: i.buyEnabled ? 'Buyers can pay you by card.' : [i.paymentsNextAction, i.paymentsWhy, i.paymentsOutstanding.length ? `Still needed: ${i.paymentsOutstanding.join(', ')}.` : ''].filter(Boolean).join(' ') },
  ];

  const blockers: string[] = [];
  if (!i.brandApproved) blockers.push('Your brand is not approved yet.');
  if (i.approvedListings === 0) blockers.push('You have no approved listing, so there is nothing to sell yet.');
  if (!i.hasStoreDraft) blockers.push('Your shop draft has not been created yet.');
  if (i.formDirty) blockers.push('You have edits that are not saved. Save them first.');
  if (i.hasStoreDraft && i.hasLiveVersion && !i.hasUnpublishedChanges && !i.paused) blockers.push('Your live shop already matches your draft, so there is nothing new to publish.');
  const canApprove = blockers.length === 0;

  const paymentsHolding = i.buyEnabled ? [] : [i.paymentsNextAction, i.paymentsWhy, ...(i.paymentsOutstanding.length ? [`Still needed: ${i.paymentsOutstanding.join(', ')}.`] : [])].filter(Boolean);

  const headline = !canApprove ? (i.hasLiveVersion && !i.hasUnpublishedChanges ? 'Your shop is up to date' : 'Not ready to publish yet')
    : i.buyEnabled ? 'Ready to publish: buyers will be able to pay' : 'Ready to publish: buying stays off until payments are connected';
  const actionNote = i.buyEnabled ? 'Publishing puts your shop live and turns the buy button on.'
    : 'Publishing puts your shop live, but the buy button stays off until payments are connected. Nobody can be charged before then.';
  return { items, canApprove, blockers, paymentsHolding, headline, actionNote };
}

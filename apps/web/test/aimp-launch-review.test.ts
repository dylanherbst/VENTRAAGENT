import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLaunch } from '../lib/aimp/launch/review.ts';
import type { LaunchReviewInput } from '../lib/aimp/launch/review.ts';

const ready: LaunchReviewInput = {
  brandApproved: true, approvedListings: 1, hasStoreDraft: true, formDirty: false, hasUnpublishedChanges: true, hasLiveVersion: false, paused: false,
  buyEnabled: false, paymentsNextAction: 'Connect Stripe', paymentsWhy: 'Stripe is how you get paid.', paymentsOutstanding: [],
};

test('a ready draft can be approved and published even while payments are pending, and says buying stays off', () => {
  const r = reviewLaunch(ready);
  assert.equal(r.canApprove, true);
  assert.deepEqual(r.blockers, []);
  assert.match(r.headline, /buying stays off/);
  assert.match(r.actionNote, /Nobody can be charged/);
  assert.deepEqual(r.items.map((x) => [x.id, x.status]), [['brand', 'done'], ['listing', 'done'], ['store', 'waiting'], ['payments', 'waiting']]);
});

test('what holds up payments is named exactly, in plain English', () => {
  const r = reviewLaunch({ ...ready, paymentsNextAction: 'Finish setting up Stripe', paymentsWhy: 'Stripe still needs a bank account for payouts.', paymentsOutstanding: ['a bank account for payouts', 'a photo of your ID'] });
  assert.equal(r.paymentsHolding.length, 3);
  assert.match(r.paymentsHolding[2], /a bank account for payouts, a photo of your ID/);
  assert.match(r.items[3].detail, /Finish setting up Stripe/);
});

test('with payments connected the buy button is promised and nothing is holding', () => {
  const r = reviewLaunch({ ...ready, buyEnabled: true });
  assert.equal(r.canApprove, true);
  assert.deepEqual(r.paymentsHolding, []);
  assert.match(r.headline, /buyers will be able to pay/);
  assert.equal(r.items[3].status, 'done');
});

test('every missing approval blocks publishing and is listed in order', () => {
  const r = reviewLaunch({ ...ready, brandApproved: false, approvedListings: 0, hasStoreDraft: false });
  assert.equal(r.canApprove, false);
  assert.equal(r.blockers.length, 3);
  assert.match(r.blockers[0], /brand/);
  assert.match(r.blockers[1], /no approved listing/);
  assert.match(r.blockers[2], /draft has not been created/);
  assert.equal(r.headline, 'Not ready to publish yet');
});

test('unsaved edits block publishing; an already-live, unchanged shop has nothing to publish', () => {
  assert.equal(reviewLaunch({ ...ready, formDirty: true }).canApprove, false);
  const live = reviewLaunch({ ...ready, hasLiveVersion: true, hasUnpublishedChanges: false });
  assert.equal(live.canApprove, false);
  assert.equal(live.headline, 'Your shop is up to date');
  assert.equal(live.items[2].status, 'done');
  // a paused shop can be published again
  assert.equal(reviewLaunch({ ...ready, hasLiveVersion: true, hasUnpublishedChanges: false, paused: true }).canApprove, true);
});

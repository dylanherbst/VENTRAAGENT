import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSellerSource } from '../lib/aimp/overview/sources.ts';
import { isTestLikeOrder } from '../lib/aimp/sellers/sample.ts';

// Found in the 23 Nov onboarding run: after a test purchase, Home ticked "Connect payments" and counted the test order as A$7 of sales.
test('a test purchase never reads as payments connected or as a sale', async () => {
  const ready = { id: 'acct_sample_demo_biz1', charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { card_payments: 'active', transfers: 'active' }, requirements: { disabled_reason: null, past_due: [], currently_due: [], eventually_due: [], pending_verification: [] } };
  const src = createSellerSource({ get: () => ({ snapshot: ready }) } as never);
  const r = await src.readiness({ workspaceId: 'w', businessId: 'biz1' });
  assert.equal(r.canAcceptPayments, false);
  assert.equal(r.state, 'not_connected');
  assert.equal(isTestLikeOrder({ test: true, sellerAccountId: 'acct_real' }), true);
  assert.equal(isTestLikeOrder({ sellerAccountId: 'acct_sample_demo_biz1' }), true);
  assert.equal(isTestLikeOrder({ test: false, sellerAccountId: 'acct_sample_demo_biz1' }), false, 'a stored flag wins');
  assert.equal(isTestLikeOrder({ sellerAccountId: 'acct_1Real' }), false);
});

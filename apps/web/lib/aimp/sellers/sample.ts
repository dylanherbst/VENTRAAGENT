// One definition of "this seller account id is a sample". The ids the fixtures use (`acct_demo_<state>`) and the labelled sample
// account the guided-setup runtime registers (`acct_sample_demo_<business>`). Checked on the server, never shown.
const SAMPLE_SELLER_ACCOUNT = /^acct_(sample|demo)_/;

export const isSampleSellerAccountId = (id: string | null | undefined): boolean => typeof id === 'string' && SAMPLE_SELLER_ACCOUNT.test(id);

/**
 * Test order per the stored flag (AMP-162); without a flag, a sample seller account means test (mirrors checkout-runtime's orderIsTest).
 * Owner-facing totals (Home, Overview) use it so a test purchase never counts as a sale.
 */
export const isTestLikeOrder = (o: { test?: unknown; sellerAccountId?: unknown }): boolean =>
  typeof o.test === 'boolean' ? o.test : isSampleSellerAccountId(typeof o.sellerAccountId === 'string' ? o.sellerAccountId : null);

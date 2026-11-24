import { demoStore } from '../../../lib/aimp/storefront/demo-store';
import { checkoutBuilt, purchaseState } from '../../../lib/aimp/storefront/load';
import { validateStoreConfig } from '../../../lib/aimp/storefront/schema';

export const dynamic = 'force-dynamic';

// Isolated test page for the AiMoneyPrinter storefront renderer: real validation and purchase rules over the DEMO store.
export default function StorefrontTest() {
  const checked = validateStoreConfig(demoStore);
  const state = purchaseState(demoStore);
  const root = process.env.AIMP_STORE_ROOT_DOMAIN;
  const base = `/s/${demoStore.slug}`;
  return <main>
    <h1>Storefront renderer test</h1>
    <p><span className="v-status" data-testid="page-mode">DEMO · Real renderer, validation and buy-button rules over sample content</span></p>
    <ul>
      <li>Config validation: <strong data-testid="validation">{checked.ok ? 'pass' : `fail (${checked.errors.length})`}</strong></li>
      <li>Checkout built: <strong>{checkoutBuilt ? 'yes' : 'no'}</strong> · Merchant charges enabled: <strong>{demoStore.merchant.chargesEnabled ? 'yes' : 'no'}</strong></li>
      <li>Buy button: <strong data-testid="buy-state">{state.canBuy ? 'active' : `off: ${state.reason}`}</strong></li>
      <li>Subdomain routing: <strong>{root ? `on (*.${root})` : 'off (AIMP_STORE_ROOT_DOMAIN not set)'}</strong></li>
    </ul>
    <p>Preview pages:</p>
    <ul>
      <li><a href={base}>Home</a></li>
      <li><a href={`${base}/products/${demoStore.products[0].slug}`}>Product page</a></li>
      <li><a href={`${base}/policies/refund`}>Refund policy</a> · <a href={`${base}/contact`}>Contact</a></li>
    </ul>
  </main>;
}

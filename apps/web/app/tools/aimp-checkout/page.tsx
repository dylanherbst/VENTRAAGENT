import { notFound } from 'next/navigation';
import { checkoutRuntime } from '../../../lib/aimp/checkout/demo';
import { isDeliverable } from '../../../lib/aimp/orders/index';
import { payOrder, replayEvent, sendForgedEvent, startCheckout } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

// Isolated test page for AMP-041 (checkout and order records): the real catalogue, sellers gate, checkout and order services
// on in-memory stores with the fixture payments provider. Plain markup, no design system. Stripe is not connected.
export default async function CheckoutTest({ searchParams }: { searchParams: Promise<Params> }) {
  const p = checkoutRuntime();
  if (!p) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const rt = await p;
  const msg = one((await searchParams).msg);
  const pay = rt.registry.payments.status;
  const orders = await rt.orders.list('demo-workspace');

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Checkout and orders test</h1>
    <p>
      <span data-testid="page-mode"><strong>{pay.demo ? 'DEMO' : 'LIVE'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">Stripe {pay.status === 'live' ? 'connected' : 'disconnected'} ({pay.label}; payment events are fixture-signed); database not connected (in-memory, resets on server restart)</span>
    </p>
    {msg && <p role="alert" data-testid="checkout-message">{msg}</p>}

    <h2>Start a checkout</h2>
    <form action={startCheckout}>
      <p><label>Listing <select name="listing" style={box} data-testid="listing-select">
        {rt.listings.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
      </select></label></p>
      <p><label>Buyer email <input name="email" type="email" defaultValue="buyer@example.test" style={box} /></label></p>
      <p><label>Retry key (same key returns the same order) <input name="key" defaultValue="demo-key-1" style={box} /></label></p>
      <p><label>Price the browser claims, in cents (ignored) <input name="clientPriceMinor" type="number" defaultValue={1} style={box} /></label></p>
      <p><label>Seller the browser claims (ignored) <input name="clientSeller" defaultValue="acct_attacker" style={box} /></label></p>
      <p><button type="submit" style={btn} data-testid="start-checkout">Start checkout</button></p>
    </form>

    <form action={replayEvent}><button type="submit" style={btn} data-testid="replay">Replay the last payment event</button></form>

    <h2>Orders</h2>
    {orders.length === 0 && <p data-testid="no-orders">No orders yet.</p>}
    {orders.map((o) => <section key={o.id} data-testid="order" style={{ borderTop: '1px solid #ccc', marginTop: 12 }}>
      <h3>{o.title}</h3>
      <p>Order {o.id} · <strong data-testid="order-status">{o.status}</strong> · {o.amountMinor} cents {o.currency} · seller {o.sellerAccountId} · store {o.storeSlug}</p>
      <p data-testid="delivery-state">{isDeliverable(o) ? 'Paid: delivery is allowed (AMP-042 delivers).' : 'Not paid: no delivery.'}</p>
      {o.status === 'pending' && <>
        <form action={payOrder}><input type="hidden" name="orderId" value={o.id} /><button type="submit" style={btn} data-testid="pay">Fixture provider: pay this order</button></form>
        <form action={sendForgedEvent}><input type="hidden" name="orderId" value={o.id} /><button type="submit" style={btn} data-testid="forge">Send a forged (wrongly signed) paid event</button></form>
      </>}
    </section>)}
    <p data-testid="delivery-queue">Orders told to the delivery hook: {rt.deliveryQueue.length}</p>
  </main>;
}

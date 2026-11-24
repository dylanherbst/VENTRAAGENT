'use client';
import { useActionState } from 'react';
import { testPurchaseAction } from '../actions';

/** Shown only when the server decided a test purchase is allowed for this store (see _server/test-purchase.ts). Fixture payment: nothing is charged. */
export function TestPurchaseForm({ store, label }: { store: string; label: string }) {
  const [reply, action, pending] = useActionState(testPurchaseAction, null);
  return (
    <section className="st-wrap st-section" aria-labelledby="test-purchase-h">
      <div className="st-newsletter">
        <h2 id="test-purchase-h">Test purchase</h2>
        <p className="st-muted" id="test-purchase-label">{label}</p>
        <form className="st-signup" action={action} aria-describedby="test-purchase-label">
          <input type="hidden" name="store" value={store} />
          <label className="st-sr" htmlFor="test-purchase-email">Email address for the test order</label>
          <input id="test-purchase-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
          <button type="submit" className="st-btn st-btn-primary" disabled={pending}>{pending ? 'Placing test order...' : 'Place test order'}</button>
        </form>
        <p className="st-note" role="status">
          {reply === null ? '' : reply.ok ? `${reply.label} Test order ${reply.orderId} was created. It now shows in Orders.` : reply.message}
        </p>
      </div>
    </section>
  );
}

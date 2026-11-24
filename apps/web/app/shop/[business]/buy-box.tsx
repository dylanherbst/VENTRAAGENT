'use client';
import { useActionState } from 'react';
import { buyNowAction } from './actions';
import { sendFunnel } from '../../../lib/aimp/funnel/beacon';

export function BuyBox({ business, label, live, note }: { business: string; label: string; live: boolean; note: string }) {
  const [reply, action, pending] = useActionState(buyNowAction, null);
  return (
    <form id="buy" action={action} className="shop-buy" onSubmit={() => { if (live) sendFunnel({ shop: business }, 'checkout_click'); }}>
      <input type="hidden" name="business" value={business} />
      <label htmlFor="buy-email">Your email (the download link is sent here)</label>
      <input id="buy-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      <button type="submit" className="shop-btn" disabled={pending || !live}>{pending ? 'One moment...' : label}</button>
      <p className="shop-note" role="status">{reply?.message ?? note}</p>
    </form>
  );
}

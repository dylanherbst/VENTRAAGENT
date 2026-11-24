'use client';
import { useEffect, useState } from 'react';
import { GlassCard } from '../../design-system/primitives';
import { offerCurrencies } from '../../../lib/local-offers';
import type { OfferCurrency } from '../../../lib/local-offers';

// Isolated test page for test-mode checkout. It calls the real /api/checkout route; it never takes a payment itself.
export default function CheckoutTest() {
  const [name, setName] = useState('Test offer');
  const [price, setPrice] = useState('49.00');
  const [currency, setCurrency] = useState<OfferCurrency>('AUD');
  const [mode, setMode] = useState<'checking' | 'DEMO' | 'TEST'>('checking');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [returned, setReturned] = useState('');
  useEffect(() => { setReturned(new URLSearchParams(location.search).get('status') ?? ''); }, []);
  async function start() {
    setBusy(true); setMessage(''); setUrl('');
    try {
      const amountMinor = Math.round(Number(price) * 100);
      const res = await fetch('/api/checkout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, amountMinor, currency }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.url === 'string') { setMode('TEST'); setUrl(body.url); setMessage('Test checkout created. Use a Stripe test card; no real money moves.'); }
      else { setMode(body.configured === false ? 'DEMO' : mode); setMessage(typeof body.error === 'string' ? body.error : 'Could not create the test checkout.'); }
    } catch { setMessage('Could not reach the checkout service.'); }
    setBusy(false);
  }
  return <main>
    <h1>Test checkout</h1>
    <p><span className="v-status" data-testid="checkout-mode">{mode === 'checking' ? 'Not yet checked' : mode === 'TEST' ? 'TEST MODE · Stripe test key connected' : 'DEMO · Stripe test key not configured'}</span></p>
    <p>Creates a Stripe Checkout Session in test mode only. Live keys are refused. Nothing is charged.</p>
    {returned && <p role="status" data-testid="returned">Returned from Stripe: {returned}.</p>}
    <GlassCard>
      <form onSubmit={e => { e.preventDefault(); void start(); }}>
        <label>Offer name<input maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Price<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
        <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value as OfferCurrency)}>{offerCurrencies.map(c => <option key={c}>{c}</option>)}</select></label>
        <button className="v-button v-button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create test checkout'}</button>
      </form>
      <p role="status" data-testid="checkout-message">{message}</p>
      {url && <p><a className="v-button" href={url} rel="noopener noreferrer">Open Stripe test checkout</a></p>}
    </GlassCard>
  </main>;
}

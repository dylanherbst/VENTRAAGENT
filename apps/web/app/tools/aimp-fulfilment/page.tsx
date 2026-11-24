import { notFound } from 'next/navigation';
import { DOWNLOAD_PATH, fulfilmentRuntime } from '../../../lib/aimp/fulfilment/demo';
import { formatMoney } from '../../../lib/aimp/fulfilment/email';
import { buy, lookup, moneyEvent, reissue, replayPaid, replayRefund, retry } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px', margin: '4px 8px 4px 0' } as const;
const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center' } as const;

// Isolated test page for AMP-042 (fulfilment and delivery): the real checkout, orders, files and fulfilment services on in-memory
// stores with fixture payments and fixture email, for two stores built from one blueprint. Plain markup, no design system.
// Walk: paid order -> delivered -> replay (no duplicate) -> fail + retry -> reissue -> refund.
export default async function FulfilmentTest({ searchParams }: { searchParams: Promise<Params> }) {
  const p = fulfilmentRuntime();
  if (!p) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const d = await p;
  const w = d.world;
  const msg = one((await searchParams).msg);
  const mail = w.registry.email.status;
  const pay = w.registry.payments.status;
  const demo = mail.demo || pay.demo;
  const stores = [w.stores.a, w.stores.b];
  const data = await Promise.all(stores.map(async (s) => ({
    s, other: s.key === 'a' ? w.stores.b : w.stores.a,
    orders: await w.fulfilment.listStoreOrders(s.scope),
    needsOwner: await w.fulfilment.listNeedsOwner(s.scope),
    audit: (await w.fulfilment.audit(s.scope)).slice(-25).reverse(),
  })));
  const outbox = w.email.outbox().slice(-8).reverse();

  return <main style={{ maxWidth: 820, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Fulfilment and delivery test</h1>
    <p>
      <span data-testid="page-mode"><strong>{demo ? 'DEMO' : 'LIVE'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">payments {pay.status === 'live' ? 'connected' : 'disconnected'} ({pay.label}); email {mail.status === 'live' ? 'connected' : 'disconnected'} ({mail.label}; nothing is really sent); file storage and database not connected (in-memory, resets on server restart)</span>
    </p>
    <p>Two stores built from the same blueprint. Every button runs the real services on test data. No real payment, email or file leaves this page.</p>
    {msg && <p role="alert" data-testid="fulfilment-message">{msg}</p>}

    <h2>1. Buy</h2>
    <div style={row}>
      {stores.map((s) => <form key={s.key} action={buy}><input type="hidden" name="store" value={s.key} />
        <button type="submit" style={btn} data-testid={`buy-${s.key}`}>Paid order in {s.name}</button></form>)}
      <form action={buy}><input type="hidden" name="store" value="a" /><input type="hidden" name="fail" value="1" />
        <button type="submit" style={btn} data-testid="buy-fail">Paid order, but the email provider is down</button></form>
    </div>
    <h2>2. Replay</h2>
    <div style={row}>
      <form action={replayPaid}><button type="submit" style={btn} data-testid="replay-paid">Replay the last payment event</button></form>
      <form action={replayRefund}><button type="submit" style={btn} data-testid="replay-refund">Replay the last refund or dispute event</button></form>
    </div>

    {data.map(({ s, other, orders, needsOwner, audit }) => <section key={s.key} data-testid={`store-${s.key}`} style={{ borderTop: '2px solid #333', marginTop: 20 }}>
      <h2>{s.name} <small>({s.slug})</small></h2>
      <p>Order history for this store only. Orders: <span data-testid="order-count">{orders.length}</span></p>
      {orders.length === 0 && <p data-testid="no-orders">No orders yet.</p>}
      {orders.map((o) => <article key={o.orderId} data-testid="order" style={{ borderTop: '1px solid #ccc', paddingTop: 8, marginTop: 8 }}>
        <h3 style={{ margin: 0 }}>{o.title} (version {o.productVersion})</h3>
        <p style={{ overflowWrap: 'anywhere' }}>
          Order <code>{o.orderId}</code> · {formatMoney(o.amountMinor, o.currency)} · order <strong data-testid="order-status">{o.orderStatus}</strong>
          {' '}· delivery <strong data-testid="fulfilment-status">{o.fulfilmentStatus}</strong> · attempts <span data-testid="attempts">{o.attempts}</span>
          {o.lastError ? <> · last problem: <span data-testid="last-error">{o.lastError}</span></> : null}
          {o.needsOwner ? <> · <strong data-testid="needs-owner">needs the owner</strong></> : null}
        </p>
        <div style={row}>
          <form action={retry}><input type="hidden" name="store" value={s.key} /><input type="hidden" name="orderId" value={o.orderId} />
            <button type="submit" style={btn} data-testid="retry">Retry delivery</button></form>
          <form action={moneyEvent}><input type="hidden" name="store" value={s.key} /><input type="hidden" name="orderId" value={o.orderId} /><input type="hidden" name="kind" value="refund" />
            <button type="submit" style={btn} data-testid="refund">Full refund event</button></form>
          <form action={moneyEvent}><input type="hidden" name="store" value={s.key} /><input type="hidden" name="orderId" value={o.orderId} /><input type="hidden" name="kind" value="partial" />
            <button type="submit" style={btn} data-testid="partial-refund">Partial refund event</button></form>
          <form action={moneyEvent}><input type="hidden" name="store" value={s.key} /><input type="hidden" name="orderId" value={o.orderId} /><input type="hidden" name="kind" value="dispute" />
            <button type="submit" style={btn} data-testid="dispute">Dispute event</button></form>
        </div>
        <form action={reissue}>
          <input type="hidden" name="orderId" value={o.orderId} />
          <label>Reason for sending a new link <input name="reason" defaultValue="Buyer lost the email" maxLength={300} style={box} /></label>
          <div style={row}>
            <button type="submit" name="as" value={s.key} style={btn} data-testid="reissue">Reissue link (support)</button>
            <button type="submit" name="as" value={other.key} style={btn} data-testid="reissue-other-store">Try as {other.name} (must be refused)</button>
          </div>
        </form>
      </article>)}
      <h3>Waiting for the owner</h3>
      {needsOwner.length === 0 ? <p>Nothing.</p> : <ul data-testid="needs-owner-list">
        {needsOwner.map((e) => <li key={e.eventId} style={{ overflowWrap: 'anywhere' }}>{e.kind} · order {e.orderId} · {e.note}</li>)}
      </ul>}
      <h3>Buyer order lookup</h3>
      <form action={lookup}><input type="hidden" name="store" value={s.key} />
        <label>Order reference <input name="reference" style={box} defaultValue={orders[0]?.orderId ?? ''} /></label>
        <label>Email used at checkout <input name="email" type="email" style={box} defaultValue={`buyer-${s.key}@example.test`} /></label>
        <button type="submit" style={btn} data-testid="lookup">Look up</button>
      </form>
      <h3>Audit log (this store)</h3>
      {audit.length === 0 && <p>Nothing yet.</p>}
      <ol reversed data-testid="audit">
        {audit.map((e) => <li key={e.seq} data-testid="audit-entry" data-event={e.event} style={{ overflowWrap: 'anywhere' }}>
          {e.at} · {e.event} · by {e.actor}{e.reason ? ` · ${e.reason}` : ''}{e.note ? ` · ${e.note}` : ''}
        </li>)}
      </ol>
    </section>)}

    <section style={{ borderTop: '2px solid #333', marginTop: 20 }}>
      <h2>Test outbox (emails the buyer would get)</h2>
      <p>Emails sent: <span data-testid="email-count">{w.email.outbox().length}</span>. The links are shown here only because this is the demo.</p>
      {outbox.length === 0 && <p>No emails yet.</p>}
      {outbox.map((m) => { const token = w.tokenIn(m); return <article key={m.id} data-testid="email" style={{ borderTop: '1px solid #ccc', paddingTop: 8 }}>
        <p><strong>{m.subject}</strong><br />To: {m.to}</p>
        {token && <p><a data-testid="download" href={`${DOWNLOAD_PATH}/${token}`}>Open this email&apos;s download link</a> (answers &quot;no longer available&quot; once revoked, refunded or expired)</p>}
      </article>; })}
    </section>
  </main>;
}

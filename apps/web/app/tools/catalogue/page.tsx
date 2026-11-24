import { notFound } from 'next/navigation';
import { blueprintRegistry } from '../../../lib/aimp/blueprints/index';
import { demoCtx } from '../../../lib/aimp/catalogue/demo';
import { estimateFees, formatAud, listingIdFor } from '../../../lib/aimp/catalogue/index';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import { createProviderRegistry } from '../../../lib/aimp/providers/index';
import { approve, saveEdits, simulateCheckout, startListing, tryOtherTenant } from './actions';
import { pageState } from './state';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

// Isolated test page for AMP-023 (catalogue and pricing): the real catalogue service, product service and brand service on
// in-memory stores. Plain markup, no design system. Stripe is not connected: fees are estimates.
export default async function CatalogueTest({ searchParams }: { searchParams: Promise<Params> }) {
  if (!toolsEnabled()) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const msg = one((await searchParams).msg);
  const s = pageState();
  const ai = createProviderRegistry({ env: process.env }).llm.status;
  const rows = await Promise.all(s.seeded.map(async (p) => {
    const listingId = listingIdFor(p.productId);
    const versions = await s.d.catalogue.listVersions(demoCtx, listingId);
    const latest = versions[versions.length - 1];
    const approved = versions.find((v) => v.status === 'approved') ?? null;
    const suggestion = latest ? await s.d.catalogue.suggestPrice(demoCtx, listingId) : null;
    return { p, listingId, versions, latest, approved, suggestion };
  }));

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Catalogue and pricing test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">Stripe disconnected (demo: fees are estimates); database not connected (in-memory, resets on server restart); AI {ai.status}</span>
    </p>
    {msg && <p role="alert" data-testid="catalogue-message">{msg}</p>}
    {s.lastCheckout && <p role="status" data-testid="checkout-result">{s.lastCheckout}</p>}

    <form action={startListing}>
      <p><label>Blueprint <select name="blueprint" defaultValue="printable-planner" style={box}>
        {blueprintRegistry.list().filter((b) => b.id !== 'seller-workbook').map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select></label></p>
      <p><label>Comparable prices in cents, comma separated (optional, 3 or more are used) <input name="comparables" placeholder="900, 1200, 1500, 1800" style={box} /></label></p>
      <p><button type="submit" style={btn} data-testid="start">Create an approved demo product and a listing draft</button></p>
    </form>
    {rows.length === 0 && <p data-testid="empty">No listings yet. Create one to start.</p>}

    {rows.map(({ p, listingId, versions, latest, approved, suggestion }) => latest && suggestion && <section key={listingId} data-testid="listing" style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
      <h2>{latest.title}</h2>
      <p data-testid="listing-state">
        Latest: version {latest.version} <strong data-testid="listing-status">{latest.status}</strong>
        {latest.editedBySeller ? ' (edited by the seller)' : ' (as generated)'} · for product version {latest.productVersion}
      </p>
      <p data-testid="checkout-price">
        {approved ? <>Checkout price (stored, approved version {approved.version}): <strong data-testid="stored-price">{formatAud(approved.priceMinor)}</strong> ({approved.priceMinor} cents)</> : 'Not approved yet: checkout has no price and cannot sell this.'}
      </p>

      <h3>Suggested price (estimate)</h3>
      <p data-testid="suggestion">Suggested <strong>{formatAud(suggestion.suggestedMinor)}</strong> · range {formatAud(suggestion.lowMinor)} to {formatAud(suggestion.highMinor)} · floor {formatAud(suggestion.floorMinor)}</p>
      <ul data-testid="reasons">{suggestion.reasons.map((r) => <li key={r}>{r}</li>)}</ul>

      <h3>Fees and margin per sale at {formatAud(latest.priceMinor)} (estimate)</h3>
      {(() => {
        const f = estimateFees(latest.priceMinor, { costPerSaleMinor: suggestion.costShareMinor });
        return <table data-testid="fees"><tbody>
          <tr><td>Price</td><td data-testid="fee-price">{formatAud(f.priceMinor)}</td></tr>
          <tr><td>Card fee (Stripe)</td><td data-testid="fee-stripe">{formatAud(f.stripeFeeMinor)}</td></tr>
          <tr><td>Platform fee</td><td data-testid="fee-platform">{formatAud(f.platformFeeMinor)}</td></tr>
          <tr><td>You receive</td><td data-testid="fee-net">{formatAud(f.sellerNetMinor)}</td></tr>
          <tr><td>Setup cost share</td><td>{formatAud(f.costPerSaleMinor)}</td></tr>
          <tr><td>Margin per sale</td><td data-testid="fee-margin">{formatAud(f.marginMinor)} ({f.marginBp / 100}%)</td></tr>
        </tbody></table>;
      })()}

      <h3>Edit the listing{latest.status === 'approved' ? ' (starts a new draft; the approved price stays until you approve it)' : ''}</h3>
      <form action={saveEdits}>
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="version" value={latest.version} />
        <p><label>Title <input name="title" defaultValue={latest.title} style={box} data-testid="title-input" /></label></p>
        <p><label>Short description <textarea name="shortDescription" defaultValue={latest.shortDescription} rows={2} style={box} /></label></p>
        <p><label>Long description <textarea name="longDescription" defaultValue={latest.longDescription} rows={4} style={box} /></label></p>
        <p><label>Price in cents <input name="priceMinor" type="number" step={1} defaultValue={latest.priceMinor} style={box} data-testid="price-input" /></label></p>
        <p><label>Cover image <select name="coverAssetId" defaultValue={latest.cover?.assetId ?? 'none'} style={box} data-testid="cover-select">
          <option value="none">No cover</option>
          <option value={p.assets.cover.id}>Cover image</option>
          <option value={p.assets.preview.id}>Preview image</option>
          <option value={p.assets.master.id}>Master file (will be refused)</option>
        </select></label></p>
        <p><button type="submit" style={btn} data-testid="save">Save edits</button></p>
      </form>
      {latest.status === 'draft' && <form action={approve}>
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="version" value={latest.version} />
        <p><button type="submit" style={btn} data-testid="approve">Approve version {latest.version}</button></p>
      </form>}

      <h3>Checkout</h3>
      <form action={simulateCheckout}>
        <input type="hidden" name="listingId" value={listingId} />
        <p><label>Price the browser claims, in cents (ignored) <input name="clientPriceMinor" type="number" defaultValue={1} style={box} /></label></p>
        <p><button type="submit" style={btn} data-testid="checkout">Simulate checkout</button></p>
      </form>
      <form action={tryOtherTenant}>
        <input type="hidden" name="listingId" value={listingId} />
        <p><button type="submit" style={btn} data-testid="other-tenant">Try as another workspace</button></p>
      </form>

      <h3>Versions and history</h3>
      <ul data-testid="versions">{versions.map((v) => <li key={v.id}>Version {v.version}: {v.status} · {formatAud(v.priceMinor)} · {v.title}</li>)}</ul>
      <ol data-testid="history">{latest.history.map((h, i) => <li key={i}>{h.at} · {h.by} · {h.kind} (v{h.version}){h.changes.length ? ': ' + h.changes.map((c) => `${c.field} ${JSON.stringify(c.from)} to ${JSON.stringify(c.to)}`).join('; ') : ''}</li>)}</ol>
    </section>)}
  </main>;
}

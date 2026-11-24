import { notFound } from 'next/navigation';
import { demoCtx, runtime, toolsEnabled } from '../../../lib/aimp/files/demo';
import { createOrder, issueLink, refundOrder, reissueLink, revokeLink, tryOtherTenant } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// Isolated test page for secure files (AMP-024): real files service on in-memory fixtures. Plain markup, no design system.
export default async function SecureFilesTest({ searchParams }: { searchParams: Promise<Params> }) {
  if (!toolsEnabled()) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const msg = one((await searchParams).msg);
  const rt = runtime();
  const live = rt.config.mode === 'live';
  const files = rt.files;
  const items = await Promise.all(rt.state.orderItemIds.map(async (id) => ({ id, ref: await rt.orders.getItem(id), grants: files ? await files.listGrants(demoCtx, id) : [] })));
  const audit = files ? files.auditAll().slice(-40).reverse() : [];
  const last = rt.state.lastToken;

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <h1>Secure files test</h1>
    <p>
      <span data-testid="page-mode"><strong>{live ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">{rt.config.connection}</span>
      {' '}· Signing secret: {rt.config.secretSource === 'env' ? 'from environment' : 'temporary demo secret'}
      {' '}· Store: in-memory (resets on server restart)
    </p>
    {msg && <p role="alert" data-testid="files-message">{msg}</p>}
    {!files && <p data-testid="not-connected">Live storage is not connected, so nothing can be issued or downloaded.</p>}

    {files && <form action={createOrder}><p><button type="submit" data-testid="create-order">Create a demo paid order (approved product)</button></p></form>}
    {items.length === 0 && <p data-testid="empty">No orders yet.</p>}

    {items.map(({ id, ref, grants }) => <section key={id} data-testid="order" style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
      <h2>Order line {id}</h2>
      <p>Order status: <span data-testid="order-status">{ref?.orderStatus ?? 'unknown'}</span> · version bought: v{ref?.productVersion}</p>
      <form action={issueLink}><input type="hidden" name="itemId" value={id} /><button type="submit" data-testid="issue">Issue download link</button></form>
      <form action={reissueLink}><input type="hidden" name="itemId" value={id} /><button type="submit" data-testid="reissue">Reissue (old link stops working)</button></form>
      <form action={tryOtherTenant}><input type="hidden" name="itemId" value={id} /><button type="submit" data-testid="other-tenant">Try as another workspace</button></form>
      {ref && <form action={refundOrder}><input type="hidden" name="orderId" value={ref.orderId} /><button type="submit" data-testid="refund">Mark order refunded</button></form>}
      <ul>
        {grants.map((g) => <li key={g.id} data-testid="grant" data-revoked={g.revokedAt !== null}>
          {g.id.slice(0, 8)} · {g.downloads}/{g.maxDownloads} downloads · expires {g.expiresAt} · {g.revokedAt ? 'REVOKED' : 'active'}
          {!g.revokedAt && <form action={revokeLink} style={{ display: 'inline' }}><input type="hidden" name="grantId" value={g.id} /> <button type="submit" data-testid="revoke">Revoke</button></form>}
        </li>)}
      </ul>
    </section>)}

    {last && <section data-testid="latest-link" style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
      <h2>Latest link (shown once, demo only)</h2>
      <p><a data-testid="download" href={`/api/aimp/files/${last}`}>Download the file</a></p>
      <p><a data-testid="download-tampered" href={`/api/aimp/files/${last.slice(0, -2)}xx`}>Try a tampered link (should be Not found)</a></p>
    </section>}

    <section style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
      <h2>Audit log</h2>
      {audit.length === 0 && <p>Nothing yet.</p>}
      <ol reversed data-testid="audit">
        {audit.map((e) => <li key={e.seq} data-testid="audit-entry" data-event={e.event} data-reason={e.reason ?? ''}>
          {e.at} · {e.event}{e.reason ? ` · ${e.reason}` : ''}{e.grantId ? ` · grant ${e.grantId.slice(0, 8)}` : ''}{e.note ? ` · ${e.note}` : ''}
        </li>)}
      </ol>
    </section>
  </main>;
}

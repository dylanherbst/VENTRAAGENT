import { blueprintRegistry } from '../../../lib/aimp/blueprints/index';
import { ctx, demoProductIds, demoService, llm } from './demo';
import { approveVersion, generateDemo, regenerateProduct } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// Isolated test page for product review: the real product service (QA, approval pinning, regeneration, hash-checked files)
// on an in-memory store. Plain markup, mobile first.
export default async function ProductReviewTest({ searchParams }: { searchParams: Promise<Params> }) {
  const msg = one((await searchParams).msg);
  const status = llm().status;
  const mode = status.status === 'live' ? 'live' : 'demo';
  const svc = demoService();
  const products = await Promise.all(demoProductIds().map(async (id) => ({ id, versions: await svc.listVersions(ctx, id) })));

  return <main style={{ maxWidth: 720, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <h1>Product review test</h1>
    <p>
      <span data-testid="page-mode"><strong>{mode === 'live' ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">{status.status}</span> · Store: in-memory (resets on server restart)
    </p>
    {msg && <p role="alert" data-testid="review-error">{msg}</p>}

    <form action={generateDemo}>
      <p><label>Blueprint <select name="blueprint" defaultValue="printable-planner">
        {blueprintRegistry.list().filter((b) => b.id !== 'seller-workbook').map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select></label></p>
      <p><button type="submit" data-testid="generate">Generate a demo product</button></p>
    </form>

    {products.length === 0 && <p data-testid="empty">No products yet. Generate one to start.</p>}
    {products.map(({ id, versions }) => {
      const approved = versions.find((v) => v.status === 'approved');
      return <section key={id} data-testid="product" style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
        <h2>{versions[0]?.spec.title ?? id}</h2>
        <p data-testid="product-state">{approved ? `Buyers receive v${approved.version} (hash ${approved.approvedHash?.slice(0, 12)}...)` : 'Not approved: buyers cannot receive any file yet.'}</p>
        <form action={regenerateProduct}>
          <input type="hidden" name="productId" value={id} />
          <button type="submit" data-testid="regenerate">Regenerate (new version)</button>
        </form>
        {approved && <p><a data-testid="buyer-download" href={`/tools/product-review/file?product=${encodeURIComponent(id)}`}>Download what buyers receive (v{approved.version})</a></p>}
        {[...versions].reverse().map((v) => <article key={v.id} data-testid="version" data-status={v.status} style={{ border: '1px solid #ddd', padding: 8, marginTop: 8 }}>
          <h3>v{v.version} · <span data-testid="version-status">{v.status}</span></h3>
          <p>{v.pageCount ?? 0} pages per PDF · file hash {v.fileHash ? v.fileHash.slice(0, 16) : 'none'}</p>
          <ul>
            {v.qa.map((q) => <li key={q.id} data-testid="qa" data-passed={q.passed}>
              {q.passed ? 'Passed' : 'Failed'}: {q.label}
              {q.reasons.length > 0 && <ul>{q.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </li>)}
          </ul>
          {v.status === 'in_review' && <form action={approveVersion}>
            <input type="hidden" name="versionId" value={v.id} />
            <button type="submit" data-testid="approve">Approve this version</button>
          </form>}
          {v.status === 'qa_failed' && <p>Stays in review: it cannot be approved until every check passes.</p>}
          {v.fileHash && <p><a data-testid="preview" href={`/tools/product-review/file?version=${encodeURIComponent(v.id)}`}>Preview exact file (ZIP)</a></p>}
        </article>)}
      </section>;
    })}
  </main>;
}

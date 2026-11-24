import { createProviderRegistry } from '../../../lib/aimp/providers';
import { blueprintRegistry } from '../../../lib/aimp/blueprints';
import { ProductFactoryError } from '../../../lib/aimp/factory/generate';
import { checkClaimsAgainstRender, renderProductPdf } from '../../../lib/aimp/factory/render';
import { DEFAULT_INPUTS, specFromQuery } from '../../../lib/aimp/factory/request';
import type { ProductSpec } from '../../../lib/aimp/factory/spec';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined, d: string) => (Array.isArray(v) ? v[0] : v) ?? d;

// Isolated test page for the Product Factory: the real spec generation and rendering, run on the server.
// The page only reads the form, shows the spec and claim check, and links to the PDF/ZIP download route.
export default async function ProductFactoryTest({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const form = {
    blueprint: one(q.blueprint, 'printable-planner'),
    niche: one(q.niche, DEFAULT_INPUTS.niche), audience: one(q.audience, DEFAULT_INPUTS.audience),
    pricePointMinor: one(q.pricePointMinor, DEFAULT_INPUTS.pricePointMinor), weeklyHours: one(q.weeklyHours, DEFAULT_INPUTS.weeklyHours),
    budgetMinor: one(q.budgetMinor, DEFAULT_INPUTS.budgetMinor),
  };
  const llm = createProviderRegistry({ env: process.env }).llm.status;
  const mode = llm.status === 'live' ? 'live' : 'demo';

  let spec: ProductSpec | null = null;
  let pdfPages = 0;
  let claimProblems: string[] = [];
  let problems: string[] = [];
  let error = '';
  if (q.build) {
    const map = { get: (k: string) => (k in form ? form[k as keyof typeof form] : null) };
    try {
      spec = await specFromQuery(map, process.env);
      const rendered = (['a4', 'letter'] as const).map((s) => renderProductPdf(spec as ProductSpec, s));
      pdfPages = rendered[0]?.pageCount ?? 0;
      claimProblems = checkClaimsAgainstRender(spec, rendered).problems;
    } catch (e) {
      if (e instanceof ProductFactoryError) { error = e.message; problems = e.problems; } else error = 'The product could not be built.';
    }
  }
  const qs = new URLSearchParams(form).toString();

  return <main>
    <h1>Product Factory test</h1>
    <p>
      <span data-testid="page-mode"><strong>{mode === 'live' ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">{llm.status}</span> · {llm.label}
    </p>
    <p>{llm.reason}</p>

    <form method="get">
      <input type="hidden" name="build" value="1" />
      <p><label>Blueprint <select name="blueprint" defaultValue={form.blueprint}>
        {blueprintRegistry.list().filter((b) => b.id !== 'seller-workbook').map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select></label></p>
      <p><label>Niche <input name="niche" defaultValue={form.niche} /></label></p>
      <p><label>Audience <input name="audience" defaultValue={form.audience} /></label></p>
      <p><label>Price (whole cents) <input name="pricePointMinor" defaultValue={form.pricePointMinor} inputMode="numeric" /></label></p>
      <p><label>Hours per week <input name="weeklyHours" defaultValue={form.weeklyHours} inputMode="numeric" /></label></p>
      <p><label>Budget (whole cents) <input name="budgetMinor" defaultValue={form.budgetMinor} inputMode="numeric" /></label></p>
      <p><button type="submit">Generate sample product</button></p>
    </form>

    {error && <div role="alert" data-testid="factory-error">
      <p>{error}</p>
      <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>}

    {spec && <section>
      <h2 data-testid="product-title">{spec.title}</h2>
      {spec.mode === 'demo' && <p data-testid="demo-note">DEMO sample: wording is placeholder content, not written by a live AI model.</p>}
      <p data-testid="page-count">{pdfPages} pages per PDF · A4 and US Letter · generated {spec.generatedAt}</p>
      <p data-testid="claim-check">{claimProblems.length === 0 ? 'Every listing claim is backed by rendered pages.' : 'Some claims are not backed by pages:'}</p>
      {claimProblems.length > 0 && <ul>{claimProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <h3>Listing claims</h3>
      <ul>{spec.claims.map((c) => <li key={c.id} data-testid="claim">{c.text}</li>)}</ul>
      <h3>Sections</h3>
      <ul>{spec.sections.map((s) => <li key={s.title}>{s.title}: {s.pages.length} page(s)</li>)}</ul>
      <p>
        <a data-testid="download-a4" href={`/tools/product-factory/download?${qs}&size=a4`}>Download PDF (A4)</a>{' · '}
        <a data-testid="download-letter" href={`/tools/product-factory/download?${qs}&size=letter`}>Download PDF (US Letter)</a>{' · '}
        <a data-testid="download-zip" href={`/tools/product-factory/download?${qs}&format=zip`}>Download ZIP</a>
      </p>
    </section>}
  </main>;
}

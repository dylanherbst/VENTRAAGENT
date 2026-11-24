// Shared by the test page and its download route: query string -> real product build (same logic as production).
import { blueprintRegistry } from '../blueprints/index.ts';
import { createProviderRegistry } from '../providers/index.ts';
import type { EnvLike } from '../flags.ts';
import { generateProductSpec, ProductFactoryError } from './generate.ts';
import { renderProductPdf, renderProductZip } from './render.ts';
import type { ProductSpec } from './spec.ts';
import type { PaperSize } from './pdf.ts';

export const DEFAULT_INPUTS = { niche: 'Wedding planning', audience: 'Couples on a budget', pricePointMinor: '1400', weeklyHours: '5', budgetMinor: '5000' };

type Query = { get(name: string): string | null };

export function inputsFromQuery(q: Query): Record<string, unknown> {
  const get = (k: keyof typeof DEFAULT_INPUTS) => q.get(k) ?? DEFAULT_INPUTS[k];
  const n = (k: keyof typeof DEFAULT_INPUTS) => { const v = get(k).trim(); return v === '' ? Number.NaN : Number(v); };
  return { niche: get('niche'), audience: get('audience'), pricePointMinor: n('pricePointMinor'), weeklyHours: n('weeklyHours'), budgetMinor: n('budgetMinor') };
}

export async function specFromQuery(q: Query, env: EnvLike): Promise<ProductSpec> {
  const bp = blueprintRegistry.find(q.get('blueprint') ?? 'printable-planner');
  if (!bp) throw new ProductFactoryError('That blueprint does not exist.');
  const llm = createProviderRegistry({ env }).llm;
  return generateProductSpec({ blueprint: bp, inputs: inputsFromQuery(q), provider: llm });
}

type Built = { fileName: string; contentType: string; bytes: Uint8Array; demo: boolean };

/** The route's whole behaviour: 200 file, 422 for input problems the owner can fix, 500 for anything unexpected. */
export async function downloadResponse(
  url: string, env: EnvLike, build: (q: Query, env: EnvLike) => Promise<Built> = buildDownload,
): Promise<Response> {
  try {
    const f = await build(new URL(url).searchParams, env);
    return new Response(Buffer.from(f.bytes), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.fileName}"`,
        'cache-control': 'no-store',
        'x-product-mode': f.demo ? 'demo' : 'live',
      },
    });
  } catch (e) {
    if (e instanceof ProductFactoryError) return Response.json({ error: e.message, problems: e.problems }, { status: 422 });
    return Response.json({ error: 'The product could not be built.' }, { status: 500 });
  }
}

export async function buildDownload(q: Query, env: EnvLike): Promise<Built> {
  const spec = await specFromQuery(q, env);
  const demo = spec.mode === 'demo';
  if (q.get('format') === 'zip') {
    const z = renderProductZip(spec);
    return { fileName: z.fileName, contentType: 'application/zip', bytes: z.bytes, demo };
  }
  const size: PaperSize = q.get('size') === 'letter' ? 'letter' : 'a4';
  const pdf = renderProductPdf(spec, size);
  return { fileName: pdf.fileName, contentType: 'application/pdf', bytes: pdf.bytes, demo };
}

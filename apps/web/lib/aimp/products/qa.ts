// Render + QA for one product version. Reuses the Product Factory checks; adds byte-level integrity and layout order checks.
import { createHash } from 'node:crypto';
import { blueprintRegistry } from '../blueprints/index.ts';
import { checkClaimsAgainstRender, renderProductPdf, renderProductZip } from '../factory/render.ts';
import type { RenderedPdf } from '../factory/render.ts';
import { allPages, validateProductSpec } from '../factory/spec.ts';
import type { ProductSpec } from '../factory/spec.ts';
import type { QaResult } from './types.ts';

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown problem');

export interface BuyerFile { fileName: string; contentType: 'application/zip'; bytes: Uint8Array; hash: string }

/** The exact file a buyer receives for a spec: the ZIP of every PDF plus the README. Deterministic for a given spec. */
export function renderBuyerFile(spec: ProductSpec): BuyerFile {
  const z = renderProductZip(spec);
  return { fileName: z.fileName, contentType: 'application/zip', bytes: z.bytes, hash: sha256(z.bytes) };
}

function pdfProblems(r: RenderedPdf, expectedPages: number): string[] {
  const out: string[] = [];
  const s = text(r.bytes);
  if (!s.startsWith('%PDF-')) out.push(`${r.fileName} does not start like a PDF file.`);
  if (!s.trimEnd().endsWith('%%EOF')) out.push(`${r.fileName} is cut off: the PDF has no proper ending.`);
  const counted = (s.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  if (counted !== expectedPages) out.push(`${r.fileName} holds ${counted} pages; ${expectedPages} were expected.`);
  if (r.pageCount !== expectedPages) out.push(`${r.fileName} reports ${r.pageCount} pages; ${expectedPages} were expected.`);
  return out;
}

export interface Assessment {
  qa: QaResult[];
  qaPassed: boolean;
  claimsOk: boolean;
  pageCount: number | null;
  file: BuyerFile | null;
}

/** Run every QA check. Never throws; a failure becomes a plain-English reason. */
export function assessSpec(spec: ProductSpec): Assessment {
  const blueprint = blueprintRegistry.find(spec?.blueprint?.id ?? '');
  const qa: QaResult[] = [];
  const add = (id: QaResult['id'], label: string, reasons: string[]) => qa.push({ id, label, passed: reasons.length === 0, reasons });

  const base = validateProductSpec(spec);
  add('spec', 'The product spec is complete', base.errors);

  if (!blueprint) {
    add('required_sections', 'Every required section is present', ['The product blueprint could not be found, so its required sections cannot be checked.']);
  } else {
    const withBp = validateProductSpec(spec, blueprint);
    add('required_sections', 'Every required section is present', withBp.errors.filter((e) => !base.errors.includes(e)));
  }

  let pdfs: RenderedPdf[] = [];
  let renderReasons: string[] = [];
  if (base.ok) {
    try { pdfs = spec.paperSizes.map((s) => renderProductPdf(spec, s)); } catch (e) { renderReasons = [`The PDF could not be rendered: ${msg(e)}`]; }
  } else renderReasons = ['The PDF was not rendered because the spec is not valid.'];

  const expected = base.ok ? allPages(spec).length : 0;
  add('pdf_integrity', 'The PDF files are complete and open correctly', [...renderReasons, ...pdfs.flatMap((r) => pdfProblems(r, expected))]);

  const layout: string[] = [];
  if (base.ok && pdfs.length) {
    const want = spec.sections.flatMap((s) => s.pages.map((p) => `${s.title}|${p.template}|${p.heading}`));
    for (const r of pdfs) {
      const got = r.pages.map((p) => `${p.section}|${p.template}|${p.heading}`);
      if (got.length !== want.length || got.some((g, i) => g !== want[i])) layout.push(`${r.fileName}: the pages are not in the order the spec planned.`);
      if (r.pages[0]?.template !== 'cover') layout.push(`${r.fileName}: the first page is not the cover.`);
    }
  } else layout.push('The layout could not be checked because nothing was rendered.');
  add('layout', 'Pages are laid out in the planned order, cover first', layout);

  let claimsOk = false;
  const claimProblems: string[] = [];
  if (pdfs.length) {
    const c = checkClaimsAgainstRender(spec, pdfs);
    claimsOk = c.ok;
    claimProblems.push(...c.problems);
  } else claimProblems.push('The listing could not be compared with the files because nothing was rendered.');
  add('listing_consistency', 'The listing promises only what the files contain', claimProblems);

  let file: BuyerFile | null = null;
  if (pdfs.length && claimsOk) {
    try { file = renderBuyerFile(spec); } catch (e) { qa.find((q) => q.id === 'pdf_integrity')?.reasons.push(`The download bundle could not be built: ${msg(e)}`); }
  }
  const zipOk = file !== null && text(file.bytes).startsWith('PK');
  if (file && !zipOk) { const q = qa.find((x) => x.id === 'pdf_integrity'); q?.reasons.push('The download bundle is not a valid ZIP file.'); }
  for (const q of qa) q.passed = q.reasons.length === 0;
  return {
    qa, qaPassed: qa.every((q) => q.passed) && file !== null && zipOk, claimsOk,
    pageCount: pdfs.length ? pdfs[0]?.pageCount ?? null : null, file,
  };
}

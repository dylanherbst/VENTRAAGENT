// Renders a validated ProductSpec to a PDF per paper size, and bundles PDFs + README into a ZIP (AMP-021).
import { LICENCE_SENTENCE } from './licence.ts';
import { PAPER, PdfDocument } from './pdf.ts';
import type { PaperSize } from './pdf.ts';
import { allPages, validateProductSpec } from './spec.ts';
import type { ProductSpec, SpecPage, TemplateKind } from './spec.ts';
import { drawPage } from './templates.ts';
import { createZip } from './zip.ts';
import { ProductFactoryError } from './generate.ts';

export interface RenderedPageInfo { page: number; template: TemplateKind; section: string; heading: string }
export interface RenderedPdf { size: PaperSize; fileName: string; bytes: Uint8Array; pageCount: number; pages: RenderedPageInfo[] }

export const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';

export function renderProductPdf(spec: ProductSpec, size: PaperSize): RenderedPdf {
  const check = validateProductSpec(spec);
  if (!check.ok) throw new ProductFactoryError('The product spec is not valid, so nothing was rendered.', check.errors);
  const paper = PAPER[size];
  const doc = new PdfDocument({ title: spec.title, subject: spec.subtitle, author: 'AiMoneyPrinter' });
  const total = allPages(spec).length;
  const pages: RenderedPageInfo[] = [];
  let n = 0;
  for (const section of spec.sections) {
    for (const p of section.pages) {
      n++;
      const page = doc.addPage(paper.width, paper.height);
      drawPage({ page, spec, pageNo: n, pageCount: total }, p);
      pages.push({ page: n, template: p.template, section: section.title, heading: p.heading });
    }
  }
  return { size, fileName: `${slugify(spec.title)}-${size === 'a4' ? 'a4' : 'us-letter'}.pdf`, bytes: doc.build(), pageCount: doc.pageCount, pages };
}

export const SAMPLE_MAX_PAGES = 3;

/**
 * A short free sample: the cover plus the first page of each other kind of page, up to SAMPLE_MAX_PAGES. Pages are drawn
 * exactly as in the full product (same numbers, same total) so what a buyer sees in the sample is what they get.
 * A single PDF, not a ZIP, so it opens straight away on a phone.
 */
export function renderSamplePdf(spec: ProductSpec, size: PaperSize = 'a4'): RenderedPdf {
  const check = validateProductSpec(spec);
  if (!check.ok) throw new ProductFactoryError('The product spec is not valid, so no sample was rendered.', check.errors);
  const paper = PAPER[size];
  const flat: { page: SpecPage; section: string; no: number }[] = [];
  let n = 0;
  for (const section of spec.sections) for (const page of section.pages) { n++; flat.push({ page, section: section.title, no: n }); }
  const seen = new Set<TemplateKind>();
  const firsts = flat.filter((f) => !seen.has(f.page.template) && (seen.add(f.page.template), true));
  // The cover always leads; then the pages that show off the product best, with how-to and notes last.
  const showcase: TemplateKind[] = ['month', 'week', 'checklist', 'tracker', 'year-glance', 'prompts', 'howto', 'notes'];
  const rank = (t: TemplateKind) => (t === 'cover' ? -1 : showcase.indexOf(t));
  const chosen = [...firsts].sort((x, y) => rank(x.page.template) - rank(y.page.template)).slice(0, SAMPLE_MAX_PAGES).sort((x, y) => x.no - y.no);
  const doc = new PdfDocument({ title: `${spec.title} (free sample)`, subject: spec.subtitle, author: 'AiMoneyPrinter' });
  const pages: RenderedPageInfo[] = [];
  for (const f of chosen) {
    const page = doc.addPage(paper.width, paper.height);
    drawPage({ page, spec, pageNo: f.no, pageCount: flat.length }, f.page);
    pages.push({ page: f.no, template: f.page.template, section: f.section, heading: f.page.heading });
  }
  return { size, fileName: `${slugify(spec.title)}-sample.pdf`, bytes: doc.build(), pageCount: doc.pageCount, pages };
}

export interface ClaimCheck { ok: boolean; problems: string[] }

/** Every listing claim must be backed by rendered pages, on every paper size produced. */
export function checkClaimsAgainstRender(spec: ProductSpec, rendered: readonly RenderedPdf[]): ClaimCheck {
  const problems: string[] = [];
  if (rendered.length === 0) problems.push('Nothing was rendered.');
  for (const r of rendered) {
    if (r.pageCount !== allPages(spec).length) problems.push(`${PAPER[r.size].label} PDF has ${r.pageCount} pages; the spec has ${allPages(spec).length}.`);
    for (const c of spec.claims) {
      const have = r.pages.filter((p) => p.template === c.template).length;
      if (have !== c.count) problems.push(`${PAPER[r.size].label}: the claim "${c.text}" promises ${c.count} but ${have} were rendered.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function buildReadme(spec: ProductSpec, files: readonly string[]): string {
  const lines = [
    spec.title,
    '='.repeat(Math.min(spec.title.length, 70)),
    '',
    spec.mode === 'demo' ? 'DEMO SAMPLE: wording is placeholder content, not written by a live AI model.' : 'Thank you for your purchase.',
    '',
    'What is inside',
    ...spec.claims.map((c) => `- ${c.text}`),
    '',
    'Files',
    ...files.map((f) => `- ${f}`),
    '',
    'How to print',
    '- Open the PDF that matches your paper: A4 or US Letter.',
    '- Print at 100% (Actual size). Do not choose "Fit to page".',
    '- Print only the pages you need, and reprint any page again.',
    '',
    LICENCE_SENTENCE,
    '',
  ];
  return lines.join('\n');
}

export interface RenderedBundle { fileName: string; bytes: Uint8Array; files: string[]; pdfs: RenderedPdf[]; claimCheck: ClaimCheck }

/** Render every paper size and zip the PDFs with a README. Refuses to bundle when a claim is not backed by pages. */
export function renderProductZip(spec: ProductSpec): RenderedBundle {
  const pdfs = spec.paperSizes.map((s) => renderProductPdf(spec, s));
  const claimCheck = checkClaimsAgainstRender(spec, pdfs);
  if (!claimCheck.ok) throw new ProductFactoryError('A listing claim is not backed by rendered pages.', claimCheck.problems);
  const names = [...pdfs.map((p) => p.fileName), 'README.txt'];
  const bytes = createZip([
    ...pdfs.map((p) => ({ name: p.fileName, data: p.bytes })),
    { name: 'README.txt', data: Uint8Array.from(Buffer.from(buildReadme(spec, names), 'utf8')) },
  ]);
  return { fileName: `${slugify(spec.title)}.zip`, bytes, files: names, pdfs, claimCheck };
}

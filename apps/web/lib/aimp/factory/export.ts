// One typed entry point for the extra Product Factory export formats (AMP-025): XLSX, PNG and JPG.
// Same conventions as request.ts: input is validated first and plain-English problems are returned; an invalid spec throws
// ProductFactoryError like the PDF/ZIP renderers. Output is deterministic (no clock in the file bytes).
import { ProductFactoryError } from './generate.ts';
import { accentFromSpec, parseHexColour, renderCoverPng, MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH, PNG_CONTENT_TYPE } from './image.ts';
import type { Rgb } from './image.ts';
import { licenceNote } from './licence.ts';
import { slugify } from './render.ts';
import { allPages, validateProductSpec } from './spec.ts';
import type { ProductSpec } from './spec.ts';
import { cleanText, isTabular, renderProductXlsx, XLSX_CONTENT_TYPE, xlsxSizeProblem } from './xlsx.ts';

export const exportFormats = ['xlsx', 'png', 'jpg'] as const;
export type ExportFormat = (typeof exportFormats)[number];

export interface ExportRequest { format: ExportFormat; /** PNG/JPG width in pixels. */ width?: number; /** PNG/JPG accent colour, "#rrggbb". */ accent?: string }
export type ExportRequestCheck = { ok: true; request: ExportRequest } | { ok: false; errors: string[] };

type Query = { get(name: string): string | null };

/** Validate an unknown request body. Never throws. */
export function parseExportRequest(input: unknown): ExportRequestCheck {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['The export request must be an object.'] };
  const o = input as Record<string, unknown>;
  if (typeof o.format !== 'string' || !(exportFormats as readonly string[]).includes(o.format)) errors.push(`Choose a format: ${exportFormats.join(', ')}.`);
  if (o.width !== undefined && (typeof o.width !== 'number' || !Number.isInteger(o.width) || o.width < MIN_IMAGE_WIDTH || o.width > MAX_IMAGE_WIDTH)) {
    errors.push(`The image width must be a whole number from ${MIN_IMAGE_WIDTH} to ${MAX_IMAGE_WIDTH}.`);
  }
  if (o.accent !== undefined && (typeof o.accent !== 'string' || !parseHexColour(o.accent))) errors.push('The accent colour must look like #1a2b3c.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, request: { format: o.format as ExportFormat, ...(o.width !== undefined ? { width: o.width as number } : {}), ...(o.accent !== undefined ? { accent: o.accent as string } : {}) } };
}

/** Same check for a URL query string (format, width, accent). */
export function exportRequestFromQuery(q: Query): ExportRequestCheck {
  const width = q.get('width');
  return parseExportRequest({
    format: q.get('format') ?? '',
    ...(width !== null && width.trim() !== '' ? { width: Number(width) } : {}),
    ...(q.get('accent') ? { accent: q.get('accent') } : {}),
  });
}

export interface LicenceSidecar { fileName: string; contentType: 'text/plain; charset=utf-8'; text: string }
export interface ExportedFile {
  ok: true;
  format: 'xlsx' | 'png';
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  /** The licence note, also embedded in the file itself (Licence sheet / PNG text chunk). */
  licenceNote: string;
  sidecar: LicenceSidecar;
  demo: boolean;
}
export interface ExportUnavailable {
  ok: false;
  reason: 'not-available' | 'no-tabular-content' | 'too-large';
  format: ExportFormat;
  message: string;
  /** For not-available: what would have to be added. */
  needs?: string;
}
export type ProductExportResult = ExportedFile | ExportUnavailable;

/** True when the product has tracker or checklist pages with items, so an XLSX makes sense. */
export const canExportXlsx = (spec: ProductSpec): boolean => allPages(spec).some(isTabular);

function sidecar(spec: ProductSpec, base: string): LicenceSidecar {
  return { fileName: `${base}-licence.txt`, contentType: 'text/plain; charset=utf-8', text: `${cleanText(spec.title)}\n${licenceNote(spec)}\n` };
}

export function exportProduct(spec: ProductSpec, request: ExportRequest): ProductExportResult {
  const check = parseExportRequest(request);
  if (!check.ok) throw new ProductFactoryError('The export request needs fixing.', check.errors);
  const req = check.request;
  const valid = validateProductSpec(spec);
  if (!valid.ok) throw new ProductFactoryError('The product spec is not valid, so nothing was exported.', valid.errors);
  const base = slugify(spec.title);
  const demo = spec.mode === 'demo';

  if (req.format === 'jpg') {
    return {
      ok: false, reason: 'not-available', format: 'jpg',
      message: 'JPG export is not available yet. Use PNG: it is the same cover image.',
      needs: 'A JPEG encoder dependency (for example "jpeg-js", pure JavaScript, or "sharp"). Neither is installed, and none was added.',
    };
  }
  if (req.format === 'xlsx') {
    if (!canExportXlsx(spec)) {
      return { ok: false, reason: 'no-tabular-content', format: 'xlsx', message: 'This product has no tracker or checklist pages, so there is nothing to put in a spreadsheet. Export the PDF instead.' };
    }
    const tooBig = xlsxSizeProblem(spec);
    if (tooBig) return { ok: false, reason: 'too-large', format: 'xlsx', message: tooBig };
    const x = renderProductXlsx(spec, base);
    return { ok: true, format: 'xlsx', fileName: x.fileName, contentType: XLSX_CONTENT_TYPE, bytes: x.bytes, licenceNote: licenceNote(spec), sidecar: sidecar(spec, base), demo };
  }
  const accent: Rgb = (req.accent ? parseHexColour(req.accent) : null) ?? accentFromSpec(spec);
  const img = renderCoverPng(spec, base, { width: req.width, accent });
  return { ok: true, format: 'png', fileName: img.fileName, contentType: PNG_CONTENT_TYPE, bytes: img.bytes, licenceNote: licenceNote(spec), sidecar: sidecar(spec, base), demo };
}

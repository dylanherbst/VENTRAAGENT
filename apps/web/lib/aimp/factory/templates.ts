// Reusable page templates (AMP-021). Each template draws one SpecPage onto a PdfPage; layout scales to the paper size.
// Every template keeps all text above the bottom margin: long text is wrapped, then cut with an ellipsis, never run off the page.
import { ellipsize, fitLines } from './pdf.ts';
import type { PdfPage } from './pdf.ts';
import type { ProductSpec, SpecPage, TemplateKind } from './spec.ts';

interface Ctx { page: PdfPage; spec: ProductSpec; pageNo: number; pageCount: number }
type Draw = (c: Ctx, p: SpecPage) => void;

const M = 40;
/** Space kept clear at the bottom for the footer. */
const FOOT = 50;
const INK = 0.12;
const SOFT = 0.75;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Header band, heading, footer. Returns the y where body content may start. */
function frame(c: Ctx, p: SpecPage): number {
  const { page, spec } = c;
  const w = page.width - 2 * M;
  page.text(M, 30, ellipsize(spec.title, 8, w), { size: 8, gray: 0.45 });
  page.line(M, 36, page.width - M, 36, { gray: SOFT });
  page.text(M, 70, ellipsize(p.heading, 24, w, true), { size: 24, bold: true, gray: INK });
  let y = 84;
  if (p.subheading) { page.text(M, 84, ellipsize(p.subheading, 10, w), { size: 10, gray: 0.4 }); y = 98; }
  const foot = spec.mode === 'demo' ? `DEMO sample - not the final product  |  Page ${c.pageNo} of ${c.pageCount}` : `Page ${c.pageNo} of ${c.pageCount}`;
  page.text(page.width / 2, page.height - 24, foot, { size: 8, gray: 0.45, align: 'center' });
  return y + 14;
}

const cover: Draw = ({ page, spec }, p) => {
  const w = page.width;
  const maxY = page.height - M - 60;
  page.rect(M, M, w - 2 * M, page.height - 2 * M, { width: 2, stroke: 0.2 });
  page.rect(M + 10, M + 10, w - 2 * M - 20, page.height - 2 * M - 20, { width: 0.5, stroke: 0.6 });
  const inner = w - 2 * M - 80;
  let y = page.height * 0.3;
  for (const l of fitLines(p.heading, 38, inner, 4, true)) { page.text(w / 2, y, l, { size: 38, bold: true, align: 'center', gray: INK }); y += 46; }
  y += 6;
  page.line(w / 2 - 60, y, w / 2 + 60, y, { width: 1.5, gray: 0.3 });
  y += 36;
  for (const l of fitLines(p.subheading ?? '', 14, inner - 20, 3)) { if (y > maxY) break; page.text(w / 2, y, l, { size: 14, align: 'center', gray: 0.35 }); y += 20; }
  y += 16;
  for (const raw of (p.lines ?? []).slice(0, 3)) for (const l of fitLines(raw, 12, inner - 20, 3)) { if (y > maxY) break; page.text(w / 2, y, l, { size: 12, align: 'center', gray: 0.3 }); y += 18; }
  if (spec.mode === 'demo') page.text(w / 2, page.height - M - 30, 'DEMO sample - wording is placeholder content', { size: 9, bold: true, align: 'center', gray: 0.4 });
};

const howto: Draw = (c, p) => {
  let y = frame(c, p) + 10;
  const maxY = c.page.height - FOOT;
  const w = c.page.width - 2 * M - 30;
  for (const [i, raw] of (p.lines ?? []).entries()) {
    const room = Math.floor((maxY - y) / 20) + 1;
    if (room < 1 || y > maxY) break;
    c.page.text(M, y, `${i + 1}.`, { size: 13, bold: true });
    for (const l of fitLines(raw, 13, w, room)) { c.page.text(M + 28, y, l, { size: 13 }); y += 20; }
    y += 12;
  }
};

const yearGlance: Draw = (c, p) => {
  const top = frame(c, p);
  const items = p.items ?? [];
  const gap = 14;
  const bw = (c.page.width - 2 * M - gap) / 2;
  const rows = Math.max(1, Math.ceil(items.length / 2));
  const bh = Math.min(170, (c.page.height - top - FOOT - gap * (rows - 1)) / rows);
  items.forEach((m, i) => {
    const x = M + (i % 2) * (bw + gap);
    const y = top + Math.floor(i / 2) * (bh + gap);
    c.page.rect(x, y, bw, bh, { stroke: 0.5 });
    c.page.text(x + 8, y + 16, ellipsize(m, 12, bw - 16, true), { size: 12, bold: true });
    for (let ly = y + 36; ly < y + bh - 8; ly += 18) c.page.line(x + 8, ly, x + bw - 8, ly, { gray: 0.82 });
  });
};

const month: Draw = (c, p) => {
  const top = frame(c, p);
  const gw = c.page.width - 2 * M;
  const cw = gw / 7;
  const hh = 20;
  const rows = 6;
  const rh = Math.min(100, (c.page.height - top - hh - FOOT) / rows);
  WEEKDAYS.forEach((d, i) => {
    c.page.rect(M + i * cw, top, cw, hh, { fill: 0.9, stroke: 0.5 });
    c.page.text(M + i * cw + cw / 2, top + 14, d, { size: 9, bold: true, align: 'center' });
  });
  for (let r = 0; r < rows; r++) for (let k = 0; k < 7; k++) c.page.rect(M + k * cw, top + hh + r * rh, cw, rh, { stroke: 0.6 });
};

const week: Draw = (c, p) => {
  let y = frame(c, p);
  const w = c.page.width - 2 * M;
  c.page.rect(M, y, w, 56, { stroke: 0.5 });
  c.page.text(M + 8, y + 16, 'Top priorities', { size: 10, bold: true });
  for (let i = 0; i < 2; i++) c.page.line(M + 8, y + 32 + i * 16, M + w - 8, y + 32 + i * 16, { gray: 0.8 });
  y += 70;
  const rh = (c.page.height - y - FOOT) / 7;
  WEEKDAYS_LONG.forEach((d, i) => {
    const ry = y + i * rh;
    c.page.rect(M, ry, w, rh, { stroke: 0.55 });
    c.page.rect(M, ry, 84, rh, { fill: 0.93, stroke: 0.55 });
    c.page.text(M + 8, ry + 16, d, { size: 10, bold: true });
    for (let ly = ry + 28; ly < ry + rh - 4; ly += 18) c.page.line(M + 92, ly, M + w - 8, ly, { gray: 0.82 });
  });
};

const checklist: Draw = (c, p) => {
  let y = frame(c, p) + 4;
  const maxY = c.page.height - FOOT;
  const w = c.page.width - 2 * M;
  const items = p.items ?? [];
  const rowH = Math.min(34, (maxY - y) / Math.max(items.length, 1));
  for (const it of items) {
    if (y > maxY) break;
    c.page.rect(M, y - 11, 14, 14, { width: 1, stroke: 0.3 });
    c.page.text(M + 26, y, ellipsize(it, 12, w - 30), { size: 12 });
    c.page.line(M + 26, y + 6, M + w, y + 6, { gray: 0.82 });
    y += rowH;
  }
};

const tracker: Draw = (c, p) => {
  const top = frame(c, p);
  const items = p.items ?? [];
  const labelW = 110;
  const days = 31;
  const cw = (c.page.width - 2 * M - labelW) / days;
  const hh = 22;
  const rh = Math.min(30, (c.page.height - top - hh - FOOT) / Math.max(items.length, 1));
  c.page.rect(M, top, labelW, hh, { fill: 0.9, stroke: 0.5 });
  c.page.text(M + 6, top + 15, 'Habit', { size: 9, bold: true });
  for (let d = 0; d < days; d++) {
    c.page.rect(M + labelW + d * cw, top, cw, hh, { fill: 0.9, stroke: 0.5 });
    c.page.text(M + labelW + d * cw + cw / 2, top + 15, String(d + 1), { size: 6, align: 'center' });
  }
  items.forEach((h, r) => {
    const y = top + hh + r * rh;
    c.page.rect(M, y, labelW, rh, { stroke: 0.5 });
    c.page.text(M + 6, y + rh / 2 + 3, ellipsize(h, 9, labelW - 12), { size: 9 });
    for (let d = 0; d < days; d++) c.page.rect(M + labelW + d * cw, y, cw, rh, { stroke: 0.65 });
  });
};

const prompts: Draw = (c, p) => {
  let y = frame(c, p) + 6;
  const w = c.page.width - 2 * M;
  const list = p.lines ?? [];
  const blockH = (c.page.height - FOOT - y) / Math.max(list.length, 1);
  const maxText = Math.max(1, Math.floor((blockH - 28) / 16));
  for (const q of list) {
    const blockTop = y;
    for (const l of fitLines(q, 12, w, maxText, true)) { c.page.text(M, y, l, { size: 12, bold: true }); y += 16; }
    const end = blockTop + blockH - 6;
    for (let ly = y + 10; ly < end; ly += 22) c.page.line(M, ly, M + w, ly, { gray: 0.8 });
    y = blockTop + blockH;
  }
};

const notes: Draw = (c, p) => {
  const top = frame(c, p);
  for (let y = top + 10; y < c.page.height - FOOT; y += 24) c.page.line(M, y, c.page.width - M, y, { gray: 0.8 });
};

export const templates: Record<TemplateKind, Draw> = {
  cover, howto, 'year-glance': yearGlance, month, week, checklist, tracker, prompts, notes,
};

export function drawPage(c: Ctx, p: SpecPage): void {
  templates[p.template](c, p);
}

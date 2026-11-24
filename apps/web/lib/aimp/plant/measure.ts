// Public-site measurement: ONE closed list of events, ONE track() entry point, a pluggable sink.
// Default sink only keeps a small in-memory buffer and dispatches a DOM CustomEvent ('aimp:measure').
// No third-party script, no network call, no cookie, no personal data. Props are checked against an allow-list
// of ids, enums and small numbers: free text, emails and unknown keys are refused. A provider is plugged in later
// with setSink() once the owner approves one. Pure module (no React), so it runs in tests and in the browser.
import { site } from '../site-config.ts';

const planIds: readonly string[] = site.plans.map((p) => p.id);

export const pageIds = ['home', 'build', 'how-it-works', 'pricing', 'faq', 'contact'] as const;
export type MeasuredPage = (typeof pageIds)[number];

export const primaryPlacements = ['header', 'hero_primary', 'stage_creation', 'stage_growth', 'final', 'page_primary'] as const;
export const secondaryPlacements = ['hero_secondary', 'stage_foundation', 'watch_try'] as const;

type Spec = { kind: 'enum'; values: readonly string[] } | { kind: 'id' } | { kind: 'index' };
const id: Spec = { kind: 'id' };
const en = (values: readonly string[]): Spec => ({ kind: 'enum', values });

/** The closed event list. Each event lists every prop it may carry (all optional) and how each value is checked. */
export const eventSpecs = {
  page_view: { page: en(pageIds) },
  headline_variant_seen: { experiment: id, variant: en(['control', 'variant']) },
  primary_cta_click: { placement: en(primaryPlacements), page: en(pageIds) },
  secondary_cta_click: { placement: en(secondaryPlacements), page: en(pageIds) },
  model_selected: { model: id, via: en(['recommendation']) },
  build_started: { model: id, niche: id },
  build_step_reached: { step: en(['choose', 'preview', 'launch']) },
  build_preview_completed: { model: id, niche: id },
  signup_handoff: { plan: en(planIds) },
  pricing_plan_click: { plan: en(planIds), from: en(['home', 'pricing_page', 'build']) },
  faq_open: { index: { kind: 'index' } as Spec },
  contact_click: { channel: en(['email']) },
} as const satisfies Record<string, Record<string, Spec>>;

export type MeasureEvent = keyof typeof eventSpecs;
export const measureEvents = Object.keys(eventSpecs) as MeasureEvent[];
export type MeasureProps = Record<string, string | number>;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 48;

function valueOk(spec: Spec, v: unknown): boolean {
  if (spec.kind === 'enum') return typeof v === 'string' && spec.values.includes(v);
  if (spec.kind === 'id') return typeof v === 'string' && v.length <= MAX_ID_LENGTH && ID_PATTERN.test(v);
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100;
}

export type Validation = { ok: true; event: MeasureEvent; props: MeasureProps } | { ok: false; reason: string };

/** Pure check. Unknown event, unknown prop or a value outside its allow-list refuses the whole event. */
export function validate(event: unknown, props: unknown = {}): Validation {
  if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(eventSpecs, event)) return { ok: false, reason: 'unknown event' };
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return { ok: false, reason: 'props must be an object' };
  const spec = eventSpecs[event as MeasureEvent] as Record<string, Spec>;
  const clean: MeasureProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (!Object.prototype.hasOwnProperty.call(spec, k)) return { ok: false, reason: `unknown prop ${k}` };
    if (!valueOk(spec[k], v)) return { ok: false, reason: `bad value for ${k}` };
    clean[k] = v as string | number;
  }
  return { ok: true, event: event as MeasureEvent, props: clean };
}

export interface MeasureRecord { event: MeasureEvent; props: MeasureProps; viewport?: 'mobile' | 'desktop' }
export type MeasureSink = (record: MeasureRecord) => void;

const BUFFER_LIMIT = 200;
const buffer: MeasureRecord[] = [];

/** Default sink: memory buffer plus a DOM event. Never touches the network, storage or cookies. */
export const defaultSink: MeasureSink = (record) => {
  buffer.push(record);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('aimp:measure', { detail: record }));
  }
};

let sink: MeasureSink = defaultSink;
/** Swap the sink (a future approved provider, or a test spy). Returns the previous one. */
export function setSink(next: MeasureSink): MeasureSink { const prev = sink; sink = next; return prev; }
export function resetSink(): void { sink = defaultSink; }
export function recorded(): readonly MeasureRecord[] { return buffer; }
export function clearRecorded(): void { buffer.length = 0; }

/** The single entry point. Returns true when the event was valid and handed to the sink. Never throws. */
export function track(event: MeasureEvent, props: MeasureProps = {}): boolean {
  const v = validate(event, props);
  if (!v.ok) return false;
  const record: MeasureRecord = { event: v.event, props: v.props };
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') record.viewport = window.innerWidth < 768 ? 'mobile' : 'desktop';
  try { sink(record); } catch { return false; }
  return true;
}

/** Page id for a pathname under /plant-lab, or null. */
export function pageForPath(pathname: string): MeasuredPage | null {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'plant-lab') return null;
  if (parts.length === 1) return 'home';
  const p = parts[1];
  return parts.length === 2 && (pageIds as readonly string[]).includes(p) && p !== 'home' ? (p as MeasuredPage) : null;
}

/** Primary call-to-action placements are the ones that carry the primary label; the rest are secondary. */
export function ctaEvent(cta: string, page?: MeasuredPage | null): [MeasureEvent, MeasureProps] | null {
  const extra: MeasureProps = page ? { page } : {};
  if ((primaryPlacements as readonly string[]).includes(cta)) return ['primary_cta_click', { placement: cta, ...extra }];
  if ((secondaryPlacements as readonly string[]).includes(cta)) return ['secondary_cta_click', { placement: cta, ...extra }];
  return null;
}

/**
 * Translate the older lib/aimp/analytics.ts events (still fired by the build flow and link components) into this
 * module's closed list. Anything not mapped is ignored. Output goes through track(), so it is validated again.
 */
export function fromLegacy(name: string, p: Record<string, unknown>, page: MeasuredPage | null = null): [MeasureEvent, MeasureProps][] {
  const s = (k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  const out: [MeasureEvent, MeasureProps][] = [];
  const from = (): 'home' | 'pricing_page' | 'build' => (page === 'pricing' ? 'pricing_page' : 'home');
  switch (name) {
    case 'cta_click': {
      const cta = s('cta');
      if (cta === 'pricing' || cta === 'pricing_page') { const plan = s('plan'); if (plan) out.push(['pricing_plan_click', { plan, from: from() }]); break; }
      if (cta === 'model_card') { const model = s('model'); if (model) out.push(['model_selected', { model }]); break; }
      const e = cta ? ctaEvent(cta, s('page') as MeasuredPage | undefined ?? page) : null;
      if (e) out.push(e);
      break;
    }
    case 'model_select': { const model = s('model'); if (model) out.push(['model_selected', s('via') === 'recommendation' ? { model, via: 'recommendation' } : { model }]); break; }
    case 'preview_start': {
      if (s('source')) break; // the scripted demo on the home page is not the build flow
      const model = s('model'); const niche = s('niche');
      out.push(['build_started', model && niche ? { model, niche } : {}], ['build_step_reached', { step: 'preview' }]);
      break;
    }
    case 'preview_complete': { const model = s('model'); const niche = s('niche'); out.push(['build_preview_completed', model && niche ? { model, niche } : {}]); break; }
    case 'launch_view': out.push(['build_step_reached', { step: 'launch' }]); break;
    case 'plan_select': { const plan = s('plan'); if (plan) out.push(['pricing_plan_click', { plan, from: 'build' }]); break; }
    case 'signup_click': { const plan = s('plan'); out.push(['signup_handoff', plan ? { plan } : {}]); break; }
    default: break;
  }
  return out;
}

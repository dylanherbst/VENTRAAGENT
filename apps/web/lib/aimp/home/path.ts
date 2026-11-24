// Two entry paths, one app (owner decision 21 Nov 2026). `new` = guided: only the steps to create the business, with the next one glowing.
// `existing` = full workspace: every page open, products can be added straight away. Pure data: the front end only renders it.
import type { ChecklistStep } from './build.ts';

export type BusinessPath = 'new' | 'existing';
export const isBusinessPath = (v: unknown): v is BusinessPath => v === 'new' || v === 'existing';

/** What the front end should paint. `next` = the one thing to do now (glow colour), `done` = finished, `later` = visible but not yet (dim). */
export type StepTone = 'next' | 'done' | 'later';
export interface GuideStep { label: string; href: string | null; segment: string; tone: StepTone; locked: boolean }
export interface Guide {
  path: BusinessPath;
  /** False while a new seller is still being guided: show the stepper, not the full menu. */
  showFullMenu: boolean;
  /** Pages the nav may link to now. 'all' means no limit. */
  allowedSegments: readonly string[] | 'all';
  steps: GuideStep[];
  /** The segment (page or modal) the glow sits on; null when every step is done. */
  glowSegment: string | null;
  /** Tone names the front end maps to colours: next is the glow, done is calm, later is dim. */
  tones: Record<StepTone, string>;
}

// Colour roles, not hex: the design system owns the actual colours.
export const toneRoles: Record<StepTone, string> = { next: 'accent-glow', done: 'success', later: 'muted' };

const segmentOf = (href: string | null, base: string): string => (href && href.startsWith(base) ? href.slice(base.length).replace(/^\//, '').split('/')[0] ?? '' : '');

// Pages a new seller always keeps: Home (where the checklist lives) and Settings.
const ALWAYS = ['', 'home', 'settings'];

export function buildGuide(path: BusinessPath, steps: readonly ChecklistStep[], base: string): Guide {
  const mapped: GuideStep[] = steps.map((s) => ({
    label: s.label, href: s.href, segment: segmentOf(s.href, base),
    tone: s.done ? 'done' : s.current ? 'next' : 'later', locked: false,
  }));
  if (path === 'new') for (const s of mapped) s.locked = s.tone === 'later';
  const glow = mapped.find((s) => s.tone === 'next');
  const allowed = path === 'existing' ? 'all' : [...new Set([...ALWAYS, ...mapped.filter((s) => !s.locked && s.segment).map((s) => s.segment)])];
  return { path, showFullMenu: path === 'existing', allowedSegments: allowed, steps: mapped, glowSegment: glow ? glow.segment : null, tones: toneRoles };
}

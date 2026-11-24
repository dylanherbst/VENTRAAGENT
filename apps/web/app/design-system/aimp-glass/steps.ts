// Step and progress helpers for OnboardingHeader. Pure functions (tested in test/aimp-glass-steps.test.ts).

export type StepState = 'done' | 'current' | 'upcoming';

/** Keeps a step number inside 1..total (whole numbers). A total below 1 is treated as 1. */
export function clampStep(current: number, total: number): { current: number; total: number } {
  const t = Number.isFinite(total) ? Math.max(1, Math.floor(total)) : 1;
  const c = Number.isFinite(current) ? Math.min(t, Math.max(1, Math.floor(current))) : 1;
  return { current: c, total: t };
}

/** The announcement for assistive technology, for example "Step 2 of 3". */
export function progressLabel(current: number, total: number): string {
  const s = clampStep(current, total);
  return `Step ${s.current} of ${s.total}`;
}

/** State of the 1-based step `index` when `current` is the active step. */
export function stepState(index: number, current: number): StepState {
  if (index < current) return 'done';
  return index === current ? 'current' : 'upcoming';
}

export interface StepDot { index: number; state: StepState; label: string }

/** One entry per dot on the progress track, with the text read out for each. */
export function stepDots(current: number, total: number): StepDot[] {
  const s = clampStep(current, total);
  return Array.from({ length: s.total }, (_, i) => {
    const index = i + 1;
    const state = stepState(index, s.current);
    const suffix = state === 'done' ? 'done' : state === 'current' ? 'current step' : 'not started';
    return { index, state, label: `Step ${index}, ${suffix}` };
  });
}

/** Keeps a meter value inside 0..max and gives the fill width as a percentage. A max below or equal to 0 becomes 1. */
export function clampMeter(value: number, max: number): { value: number; max: number; percent: number } {
  const m = Number.isFinite(max) && max > 0 ? max : 1;
  const v = Number.isFinite(value) ? Math.min(m, Math.max(0, value)) : 0;
  return { value: v, max: m, percent: Math.round((v / m) * 1000) / 10 };
}

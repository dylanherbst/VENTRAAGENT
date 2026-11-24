import Link from 'next/link';
import { OutlineIcon } from './primitives';

export type GuidedStep = { id: string; label: string; done: boolean; href?: string; note?: string; disabled?: boolean };

/** Numbered steps. Done is shown with a tick AND the word "Done"; disabled steps say why. Never colour only. */
export function GuidedSteps({ steps, label }: { steps: readonly GuidedStep[]; label: string }) {
  return <ol className="v-steps" aria-label={label}>{steps.map((s, i) => {
    const inner = <>
      <span className="v-step-dot" aria-hidden="true">{s.done ? <OutlineIcon name="check" /> : i + 1}</span>
      <span className="v-step-copy"><strong>{s.label}</strong><small>{s.disabled ? (s.note ?? 'Coming soon') : s.done ? 'Done' : (s.note ?? 'Not started')}</small></span>
    </>;
    return <li key={s.id} data-done={s.done || undefined} data-disabled={s.disabled || undefined}>
      {s.href && !s.disabled ? <Link href={s.href}>{inner}</Link> : <div aria-disabled={s.disabled || undefined}>{inner}</div>}
    </li>;
  })}</ol>;
}

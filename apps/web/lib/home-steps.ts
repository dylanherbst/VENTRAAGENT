// Home's one primary button: the first setup step not done yet, with that step's own target. Only when every step is
// done does it fall back to the audit. Optional steps (no real done signal yet) are never chosen. Pure, so it is tested.
export type StepLike = { title: string; note: string; href: string; done: boolean; optional?: boolean };
export type NextStep = { label: string; href: string; note: string };

export function nextStep(steps: StepLike[]): NextStep {
  const open = steps.find(s => !s.done && !s.optional);
  return open ? { label: open.title, href: open.href, note: open.note }
    : { label: 'Start the audit', href: '/grow/audit', note: 'Everything is set up. A few questions show where bookings are slipping.' };
}

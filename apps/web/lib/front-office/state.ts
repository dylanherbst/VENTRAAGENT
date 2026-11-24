// Contact state machine for the AI front office (tracker 0.3). One record per contact, shared by every agent.
// supabase/migrations/202611060001_front_office.sql enforces the same transitions (fo_transition_ok); test/front-office.test.ts
// checks that the two lists match.

export const contactStates = ['new', 'contacted', 'qualifying', 'qualified', 'booked', 'no-show', 'disqualified', 'nurture', 'customer'] as const;
export type ContactState = typeof contactStates[number];

/** Allowed moves. `customer` = onboarded after a close; their traffic goes to the Receptionist. */
export const transitions: Readonly<Record<ContactState, readonly ContactState[]>> = {
  new: ['contacted', 'qualifying', 'disqualified', 'nurture', 'customer'],
  contacted: ['qualifying', 'disqualified', 'nurture', 'customer'],
  qualifying: ['qualified', 'disqualified', 'nurture'],
  qualified: ['booked', 'nurture', 'disqualified'],
  booked: ['customer', 'no-show', 'qualified', 'nurture', 'disqualified'],
  'no-show': ['booked', 'nurture', 'disqualified'],
  disqualified: ['nurture', 'qualifying'],
  nurture: ['contacted', 'qualifying', 'qualified', 'booked', 'disqualified'],
  customer: [],
};

export function isContactState(value: unknown): value is ContactState {
  return typeof value === 'string' && (contactStates as readonly string[]).includes(value);
}
export function canTransition(from: ContactState, to: ContactState): boolean {
  return transitions[from].includes(to);
}
export function nextState(from: ContactState, to: ContactState): ContactState {
  if (!canTransition(from, to)) throw new Error(`Contact cannot move from ${from} to ${to}.`);
  return to;
}

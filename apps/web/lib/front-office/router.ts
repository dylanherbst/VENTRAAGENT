// The orchestrator's routing rule (tracker 0.2): one inbound router that looks up the contact and dispatches by state.
// Unknown or unqualified goes to the Setter, booked goes to Sales, onboarded customers go to the Receptionist.
// Opted-out contacts get no agent at all.
import type { Agent } from './handoff';
import type { ContactState } from './state';

export type Route = { agent: Agent | null; reason: string };
export function routeByState(state: ContactState | null, optedOut: boolean): Route {
  if (optedOut) return { agent: null, reason: 'Contact opted out. No automation.' };
  if (state === null) return { agent: 'setter', reason: 'Unknown contact.' };
  switch (state) {
    case 'booked': return { agent: 'sales', reason: 'Booked contacts belong to Sales.' };
    case 'customer': return { agent: 'receptionist', reason: 'Existing customer.' };
    default: return { agent: 'setter', reason: `Contact is ${state}.` };
  }
}

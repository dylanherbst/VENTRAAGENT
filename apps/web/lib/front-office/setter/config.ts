// Setter configuration per client (tracker 1.1: the client's questions are config, not code). Ventra is customer zero.
// OWNER: check the Ventra defaults below (drafted from the master plan; see docs/agents/OWNER_TODO.md).
import { checkedAvailability } from '../calendar/slots';
import type { Availability } from '../calendar/slots';

export type QualificationQuestion = {
  /** Stable id used as the key in the contact's answers. */
  id: string;
  /** What the Setter needs to find out, in plain words. The model phrases the actual question. */
  ask: string;
  required: boolean;
};
export type SetterConfig = {
  businessName: string;
  /** What the client sells, in one or two sentences the Setter can use. */
  offer: string;
  /** Who is a good fit, and who is not (disqualified politely and moved to nurture). */
  idealCustomer: string;
  notAFit: string;
  questions: QualificationQuestion[];
  meetingTitle: string;
  /** How the booked call happens: "a phone call", "Zoom", "at the gym". */
  where: string;
  availability: Availability;
  /** Facts the Setter may state. Anything not here (prices, guarantees, discounts) goes to a human. */
  facts: string[];
  /** Follow-up texts for the ladder (1 h, 1 d, 3 d, 7 d, monthly; the 5-minute nudge is the first). {name} is replaced. */
  followUps: string[];
  reminder24h: string;
  reminder2h: string;
  noShowRescue: string[];
};

export const ventraSetterConfig: SetterConfig = {
  businessName: 'Ventra',
  offer: 'Ventra sets up an AI front office for service businesses: an AI Setter that replies to every lead in under a minute, qualifies them and books them; an AI Sales agent; and an AI Receptionist. Done for you.',
  idealCustomer: 'Owners of service businesses (gyms, studios, clinics, trades, coaches) that get enquiries by text, web or phone and lose some because nobody replies fast.',
  notAFit: 'People looking for a job, students, other agencies wanting to resell, anyone with no business yet, and spam.',
  questions: [
    { id: 'business', ask: 'What their business is and where it is', required: true },
    { id: 'lead_flow', ask: 'Roughly how many enquiries or leads they get a week, and from where', required: true },
    { id: 'problem', ask: 'What happens to leads now and what is not working (slow replies, no-shows, no follow-up)', required: true },
    { id: 'timing', ask: 'How soon they want this fixed', required: true },
    { id: 'decision_maker', ask: 'Whether they make the decision or someone else needs to be on the call', required: false },
  ],
  meetingTitle: 'Ventra strategy call',
  where: '30-minute phone call',
  availability: {
    timeZone: 'Australia/Perth',
    weekly: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
    slotMinutes: 30, bufferMinutes: 15, minNoticeMinutes: 120, horizonDays: 10,
  },
  facts: [
    'The strategy call is free, 30 minutes, by phone, with a person from Ventra.',
    'On the call we look at where leads come from now and show what the AI front office would do with them.',
    'Ventra is based in Perth, Western Australia, and works with businesses across Australia.',
  ],
  followUps: [
    'Hi {name}, just checking you saw my last message. Happy to find a time that suits.',
    'Hi {name}, still keen to chat about getting every lead answered in under a minute? I can book you in.',
    'Hi {name}, following up from Ventra. Want me to hold a 30-minute call this week?',
    'Hi {name}, last nudge from me this week. Reply with a day that works and I will sort the rest.',
    'Hi {name}, it is Ventra. If leads are still slipping through, reply and I will find you a time.',
  ],
  reminder24h: 'Hi {name}, reminder: your {meeting} is tomorrow at {time}. Reply here if you need to change it.',
  reminder2h: 'Hi {name}, see you at {time} for your {meeting}. Reply here if something has come up.',
  noShowRescue: [
    'Hi {name}, sorry we missed you today. Want to pick a new time? I can offer a couple now.',
    'Hi {name}, happy to rebook your call whenever suits. Just reply with a day.',
  ],
};

export function checkedSetterConfig(c: SetterConfig): SetterConfig {
  if (!c.businessName.trim() || !c.offer.trim()) throw new Error('Setter config needs a business name and an offer.');
  if (c.questions.length < 3 || c.questions.length > 5) throw new Error('Use 3 to 5 qualification questions.');
  const ids = new Set<string>();
  for (const q of c.questions) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(q.id) || ids.has(q.id)) throw new Error(`Question id "${q.id}" must be unique, lower case and short.`);
    ids.add(q.id);
  }
  if (c.followUps.length < 1 || c.noShowRescue.length < 1) throw new Error('Setter config needs follow-up and no-show texts.');
  for (const t of [...c.followUps, ...c.noShowRescue, c.reminder24h, c.reminder2h]) if (t.length > 320) throw new Error('Keep each scheduled text under 320 characters (two SMS).');
  checkedAvailability(c.availability);
  return c;
}

export function fillTemplate(t: string, v: { name?: string | null; meeting?: string; time?: string }): string {
  return t.replace(/\{name\}/g, v.name?.split(/\s+/)[0] || 'there').replace(/\{meeting\}/g, v.meeting ?? '').replace(/\{time\}/g, v.time ?? '').replace(/\s+/g, ' ').trim();
}

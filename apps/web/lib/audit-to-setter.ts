// Growth Audit -> AI Setter hand-off (Build Plan p.8: Growth Audit -> Setter demo -> enquiry -> booking).
// Deterministic: the audit's business details and answers in, a SetterConfig the owner reviews out. Only facts the owner
// gave are stated; prices, guarantees and anything else stay with a human (the Setter's own rule).
import { checkedSetterConfig, ventraSetterConfig } from './front-office/setter/config.ts';
import type { SetterConfig } from './front-office/setter/config.ts';
import type { AuditAnswers, AuditBusiness, Finding } from './growth-opportunity.ts';

/** A saved Growth Audit (OpportunitySnapshot from lib/audit-sync.ts) or any partial of it. */
export type SetterAuditInput = {
  business?: Partial<AuditBusiness> | null;
  answers?: Partial<AuditAnswers> | null;
  findings?: readonly Pick<Finding, 'id'>[] | null;
} | null | undefined;

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[{}\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

export function auditToSetterConfig(audit: SetterAuditInput): SetterConfig {
  const b = audit?.business ?? {};
  const name = clean(b.name, 60) || 'our team';
  const businessName = clean(b.name, 120) || 'Your business';
  const area = clean(b.area, 120), industry = clean(b.industry, 120), audience = clean(b.audience, 200);
  const offer = clean(b.offer, 400) || (industry ? `${industry} services.` : 'Bookings and enquiries for this business.');
  const ids = new Set((Array.isArray(audit?.findings) ? audit.findings : []).map(f => f?.id));
  const answers = audit?.answers ?? {};
  // Lead-flow problems found in the audit (missed or slow replies) get the full follow-up ladder; otherwise a short one.
  const leadLeak = ids.has('missed') || ids.has('speed') || (Number(answers.missedPct) > 0) || answers.replySpeed === 'same-day' || answers.replySpeed === 'next-day';
  const noShows = ids.has('no-show') || Number(answers.noShowPct) > 0;

  const facts = [`${businessName} offers: ${offer}`];
  if (area) facts.push(`${businessName} is based in ${area}.`);
  facts.push(`A person from ${businessName} confirms every booking.`);

  const followUps = [
    `Hi {name}, just checking you saw my last message from ${name}. Happy to find a time that suits.`,
    `Hi {name}, still keen to get booked in with ${name}? Reply with a day that works.`,
    `Hi {name}, following up from ${name}. Want me to hold a time for you this week?`,
    `Hi {name}, last nudge from me this week. Reply with a day that works and I will sort the rest.`,
    `Hi {name}, it is ${name}. If you still need help, reply and I will find you a time.`,
  ];

  return checkedSetterConfig({
    businessName,
    offer,
    idealCustomer: [audience ? `${audience}.` : 'People who want what this business offers.', area ? `Ideally in or near ${area}.` : ''].filter(Boolean).join(' '),
    notAFit: `People looking for a job, suppliers or agencies selling to ${businessName}${area ? `, people too far from ${area} to be served` : ''}, and spam.`,
    questions: [
      { id: 'need', ask: 'What they need help with', required: true },
      { id: 'location', ask: area ? `Where they are, to check they are in or near ${area}` : 'Where they are', required: true },
      { id: 'timing', ask: 'How soon they want to get started', required: true },
      { id: 'contact', ask: 'The best phone number or email to confirm the booking', required: false },
    ],
    meetingTitle: `Booking with ${name}`,
    where: 'a short phone call',
    availability: { ...ventraSetterConfig.availability, weekly: { ...ventraSetterConfig.availability.weekly } },
    facts,
    followUps: leadLeak ? followUps : followUps.slice(0, 3),
    reminder24h: `Hi {name}, reminder: your {meeting} is tomorrow at {time}. Reply here if you need to change it.`,
    reminder2h: `Hi {name}, see you at {time} for your {meeting}. Reply here if something has come up.`,
    noShowRescue: noShows
      ? [`Hi {name}, sorry we missed you today. Want to pick a new time with ${name}? I can offer a couple now.`, 'Hi {name}, happy to rebook whenever suits. Just reply with a day.']
      : ['Hi {name}, sorry we missed you today. Reply with a day that suits and I will rebook you.'],
  });
}

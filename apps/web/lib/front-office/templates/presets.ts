// Industry presets for the AI Setter and Receptionist: Beauty, Fitness, Trades.
// A preset is a starting point the business edits before going live. Everything in it, and every price above all, is
// EXAMPLE content (exampleValues: true, exampleLabel, exampleIds). It is never the business's real price, policy or
// answer until the owner edits and saves it in their own settings. `knowledge` uses the real A-16 knowledge base
// shapes (settings.ts), so checkedKnowledge accepts it as is; `faqs` uses the settings FAQ shape; `template` has the
// same keys as gymTemplate. Example conversations never state a price in plain text: they use {price:<serviceId>},
// resolved from the business's own saved knowledge by fillExamplePlaceholders.
import type { QualificationQuestion } from '../setter/config';
import type { Faq, KnowledgeBase } from '../settings';
import { formatPriceAud } from '../settings';

export const EXAMPLE_LABEL = 'Example value - edit before going live';

export type PresetBookingType = { id: string; name: string; minutes: number; where: string };
export type PresetConversation = { title: string; turns: { from: 'customer' | 'ai'; text: string }[] };

export type PresetTemplate = {
  offer: string;
  idealCustomer: string;
  notAFit: string;
  questions: QualificationQuestion[];
  bookingType: string;
  bookingWhere: string;
  bookingMinutes: number;
  /** Empty, as in gymTemplate: facts come from the business's own knowledge and FAQs, never from the preset. */
  facts: string[];
  greeting: string;
  aiDisclosure: string;
  followUps: string[];
  reminder24h: string;
  reminder2h: string;
  noShowRescue: string[];
};

export type IndustryPreset = {
  id: string;
  name: string;
  covers: string[];
  /** Always true: the whole preset is example content for the business to edit. */
  exampleValues: true;
  exampleLabel: typeof EXAMPLE_LABEL;
  /** Every service and policy id in this preset holds an example value (price, length or wording). */
  exampleIds: { services: string[]; policies: string[] };
  knowledge: KnowledgeBase;
  faqs: Faq[];
  qualification: QualificationQuestion[];
  /** Derived from the services that have a durationMinutes, in service order. The first is the main booking. */
  bookingTypes: PresetBookingType[];
  exampleConversations: PresetConversation[];
  template: PresetTemplate;
};

type PresetInput = Omit<IndustryPreset, 'exampleValues' | 'exampleLabel' | 'exampleIds' | 'bookingTypes' | 'template'> & {
  where: string;
  template: Pick<PresetTemplate, 'offer' | 'idealCustomer' | 'notAFit' | 'followUps' | 'noShowRescue'>;
};

function preset(p: PresetInput): IndustryPreset {
  const { where, template, ...rest } = p;
  const bookingTypes = rest.knowledge.services.flatMap((s) => (s.durationMinutes ? [{ id: s.id, name: s.name, minutes: s.durationMinutes, where }] : []));
  const main = bookingTypes[0];
  return {
    ...rest,
    exampleValues: true,
    exampleLabel: EXAMPLE_LABEL,
    exampleIds: { services: rest.knowledge.services.map((s) => s.id), policies: rest.knowledge.policies.map((x) => x.id) },
    bookingTypes,
    template: {
      ...template,
      questions: rest.qualification,
      bookingType: main.name,
      bookingWhere: main.where,
      bookingMinutes: main.minutes,
      facts: [],
      greeting: 'Thanks for contacting {business}.',
      aiDisclosure: "I'm the {business} AI assistant.",
      reminder24h: 'Hi {name}, reminder: your {meeting} is tomorrow at {time}. Reply here if you need to change it.',
      reminder2h: 'Hi {name}, see you at {time} for your {meeting}. Reply here if something has come up.',
    },
  };
}

/** Replace {price:<serviceId>} with the business's saved price ("$55", "free"), or "a price the team will confirm"
 * when the service has no price on file or is not in the knowledge base. */
export function fillExamplePlaceholders(text: string, knowledge: KnowledgeBase): string {
  return text.replace(/\{price:([a-z0-9_-]+)\}/g, (_, id: string) => {
    const s = knowledge.services.find((x) => x.id === id);
    return s && s.priceAud !== null ? formatPriceAud(s.priceAud, s.priceUnit) : 'a price the team will confirm';
  });
}

const beauty = preset({
  id: 'beauty',
  name: 'Beauty (nails and lashes)',
  covers: ['nails', 'lashes', 'beauty'],
  where: 'at the salon',
  knowledge: {
    services: [
      { id: 'gel-manicure', name: 'Gel manicure', description: 'Shape, cuticle care and gel colour.', priceAud: 55, priceUnit: '', durationMinutes: 45 },
      { id: 'acrylic-full-set', name: 'Acrylic full set', description: 'New acrylic extensions with colour.', priceAud: 80, priceUnit: '', durationMinutes: 90 },
      { id: 'classic-lashes', name: 'Classic lash full set', description: 'One extension per natural lash.', priceAud: 120, priceUnit: '', durationMinutes: 120 },
      { id: 'lash-infill', name: 'Lash infill', description: 'Top-up of an existing lash set.', priceAud: 65, priceUnit: '', durationMinutes: 60 },
    ],
    offers: [],
    policies: [
      { id: 'cancellation', topic: 'Cancellation', text: 'Please give at least 24 hours notice to cancel or move a booking. Late cancellations may lose the deposit.' },
      { id: 'deposit', topic: 'Deposit', text: 'A deposit may be taken to secure new client bookings. The salon sets the amount and it comes off the final price.' },
      { id: 'lateness', topic: 'Lateness', text: 'If you are more than 15 minutes late the service may be shortened or rebooked.' },
    ],
    objections: [],
  },
  faqs: [
    { q: 'Do I need a patch test for lashes?', a: 'Please ask the salon. A person will confirm whether a patch test is needed before your lash booking.' },
    { q: 'How long do gel nails last?', a: 'It varies from person to person. Ask the salon for its own guide.' },
    { q: 'Can I remove my old set here?', a: 'Removal may be available. The salon will confirm when you book.' },
  ],
  qualification: [
    { id: 'service', ask: 'Which service they want (for example nails or lashes, and the style)', required: true },
    { id: 'new_or_returning', ask: 'Whether they are a new or returning client', required: true },
    { id: 'preferred_times', ask: 'Which days and times suit them', required: true },
    { id: 'allergies', ask: 'Any allergies or sensitivities the salon should know about (a person will follow up)', required: false },
  ],
  exampleConversations: [
    { title: 'New lash client books a full set', turns: [
      { from: 'customer', text: 'Hi, how much for classic lashes?' },
      { from: 'ai', text: "I'm the salon's AI assistant. A classic full set is listed at {price:classic-lashes} and takes about 2 hours. Have you had lashes done with us before?" },
      { from: 'customer', text: 'No, first time. Saturday morning?' },
      { from: 'ai', text: 'Great. The salon may ask new clients for a patch test and a deposit first; a person will confirm. I have Saturday at 9:30 am, shall I hold it?' },
    ] },
    { title: 'Client asks to cancel late', turns: [
      { from: 'customer', text: 'Can I cancel my nails tomorrow morning?' },
      { from: 'ai', text: 'I can help. Bookings cancelled inside 24 hours may lose the deposit. Would you like to move it to another day instead?' },
    ] },
  ],
  template: {
    offer: 'Easy online booking for nails and lashes, with a quick chat to find the right service.',
    idealCustomer: 'Local clients looking for nail or lash appointments.',
    notAFit: 'Job seekers, sales pitches, spam, and services the salon does not offer.',
    followUps: [
      'Hi {name}, just checking you saw my last message. Happy to find a time that suits.',
      'Hi {name}, still keen to book in? I can look for a spot for you.',
      'Hi {name}, it is {business}. Reply with a day that suits and I will sort the rest.',
    ],
    noShowRescue: ['Hi {name}, sorry we missed you today. Want to pick a new time?'],
  },
});

const fitness = preset({
  id: 'fitness',
  name: 'Fitness (personal trainers and coaches)',
  covers: ['personal training', 'coaching'],
  where: 'at the studio or by video call',
  knowledge: {
    services: [
      { id: 'free-consult', name: 'Free consult', description: 'Free. Meet the coach and talk through your goal.', priceAud: 0, priceUnit: '', durationMinutes: 30 },
      { id: 'pt-session', name: '1:1 personal training session', description: 'A coached one-on-one session.', priceAud: 80, priceUnit: 'per session', durationMinutes: 60 },
      { id: 'pt-pack-10', name: '10-session pack', description: 'Ten 1:1 sessions to use within 3 months.', priceAud: 720, priceUnit: '', durationMinutes: null },
      { id: 'online-coaching', name: 'Online coaching', description: 'Program, check-ins and messaging support.', priceAud: 50, priceUnit: 'per week', durationMinutes: null },
    ],
    offers: [],
    policies: [
      { id: 'cancellation', topic: 'Cancellation', text: 'Sessions cancelled with less than 12 hours notice may be charged as used.' },
      { id: 'deposit', topic: 'Deposit', text: 'Packs are paid upfront. The free consult has no deposit.' },
      { id: 'lateness', topic: 'Lateness', text: 'Sessions finish at the booked time even if you arrive late.' },
    ],
    objections: [],
  },
  faqs: [
    { q: 'Do I need to be fit to start?', a: 'No. The coach will talk through where you are starting from at the consult.' },
    { q: 'What should I bring?', a: 'Water, a towel and comfortable shoes.' },
  ],
  qualification: [
    { id: 'goal', ask: 'What they want to achieve (for example lose weight, build strength, train for an event)', required: true },
    { id: 'experience', ask: 'Training experience and any injuries the coach should know about (a person will confirm what suits them)', required: true },
    { id: 'preferred_times', ask: 'Which days and times suit them to train', required: true },
    { id: 'start_timeframe', ask: 'How soon they want to start', required: false },
  ],
  exampleConversations: [
    { title: 'New lead books a free consult', turns: [
      { from: 'customer', text: 'Hey, I want to get stronger but I have a dodgy knee.' },
      { from: 'ai', text: "I'm the coach's AI assistant. Thanks for mentioning the knee. I will pass that on, and a person will confirm what suits you. How soon would you like to start?" },
      { from: 'customer', text: 'Next week, evenings.' },
      { from: 'ai', text: 'A free 30 minute consult is the first step. Tuesday at 6 pm is open, shall I book it?' },
    ] },
    { title: 'Price question', turns: [
      { from: 'customer', text: 'How much is PT?' },
      { from: 'ai', text: 'A 1:1 session is listed at {price:pt-session}, or {price:pt-pack-10} for a 10-session pack. Would a free consult first help?' },
    ] },
  ],
  template: {
    offer: 'A free consult so new clients can meet the coach before committing.',
    idealCustomer: 'Local people who want coached training and can get to the studio, or want online coaching.',
    notAFit: 'People wanting medical advice, job seekers, sales pitches and spam.',
    followUps: [
      'Hi {name}, just checking you saw my last message. Happy to find a consult time.',
      'Hi {name}, still keen to get started? I can book your free consult.',
      'Hi {name}, it is {business}. Reply with a day that suits and I will sort the rest.',
    ],
    noShowRescue: ['Hi {name}, sorry we missed you today. Want to pick a new time for your consult?'],
  },
});

const trades = preset({
  id: 'trades',
  name: 'Trades (electricians, plumbers, cleaners)',
  covers: ['electrician', 'plumber', 'cleaner'],
  where: "at the customer's property",
  knowledge: {
    services: [
      { id: 'call-out', name: 'Call-out and first hour', description: 'Electrical or plumbing: attend, diagnose and up to one hour of work.', priceAud: 150, priceUnit: '', durationMinutes: 60 },
      { id: 'hourly', name: 'Additional labour', description: 'Electrical or plumbing work after the first hour, parts extra.', priceAud: 95, priceUnit: 'per hour', durationMinutes: null },
      { id: 'quote', name: 'On-site quote', description: 'Free. A visit to measure up and quote larger jobs.', priceAud: 0, priceUnit: '', durationMinutes: 30 },
      { id: 'regular-clean', name: 'Regular home clean', description: 'Standard clean of a 3-bedroom home.', priceAud: 180, priceUnit: '', durationMinutes: 180 },
    ],
    offers: [],
    policies: [
      { id: 'cancellation', topic: 'Cancellation', text: 'Please give 24 hours notice to cancel. Same-day cancellations may be charged a fee set by the business.' },
      { id: 'deposit', topic: 'Deposit', text: 'Larger quoted jobs may need a deposit before materials are ordered. The business sets the amount.' },
      { id: 'lateness', topic: 'Lateness', text: 'Arrival windows are 2 hours. The team aims to message you if they are running late.' },
    ],
    objections: [],
  },
  faqs: [
    { q: 'Do you do emergencies?', a: 'Emergency jobs are passed straight to a person to confirm who can come. If there is gas, fire or electrical danger, call 000 first.' },
    { q: 'Do you have a licence and insurance?', a: 'A person will confirm licence and insurance details.' },
  ],
  qualification: [
    { id: 'job', ask: 'What the job is, in their own words (and photos if they have them)', required: true },
    { id: 'suburb', ask: 'The suburb or address, to check it is in the service area', required: true },
    { id: 'urgency', ask: 'How urgent it is (emergency, this week, flexible)', required: true },
    { id: 'property', ask: 'Whether they own or rent the property', required: false },
  ],
  exampleConversations: [
    { title: 'Customer needs a quote', turns: [
      { from: 'customer', text: 'Hi, need some downlights installed. Can you quote?' },
      { from: 'ai', text: "I'm the AI assistant for the business. Happy to help. Which suburb are you in, and how many lights roughly?" },
      { from: 'customer', text: 'Joondalup, about 8.' },
      { from: 'ai', text: 'That is in the area. An on-site quote is {price:quote} and takes about 30 minutes. Does Thursday 8 to 10 am suit?' },
    ] },
    { title: 'Emergency handed to a person', turns: [
      { from: 'customer', text: 'Water pipe burst in my kitchen!' },
      { from: 'ai', text: 'If it is safe to do so, you may want to turn the water off; I am passing this to the team now. If there is gas, fire or electrical danger, call 000.' },
    ] },
  ],
  template: {
    offer: 'Fast replies, clear example pricing and an easy booking for a visit or a quote.',
    idealCustomer: 'Home owners, renters and property managers inside the service area.',
    notAFit: 'Jobs outside the service area, work the business does not offer, sales pitches and spam.',
    followUps: [
      'Hi {name}, just checking you saw my last message. Happy to find a time.',
      'Hi {name}, still need a hand with the job? I can book a visit.',
      'Hi {name}, it is {business}. Reply with a day that suits and I will sort the rest.',
    ],
    noShowRescue: ['Hi {name}, sorry we could not get access today. Want to pick a new time?'],
  },
});

const PRESETS: readonly IndustryPreset[] = [beauty, fitness, trades];

/** All presets, for a preset selector. Returns copies so callers cannot change the shared data. */
export function listIndustryPresets(): IndustryPreset[] {
  return PRESETS.map((p) => structuredClone(p));
}

/** One preset by id, or null if the id is unknown. */
export function getIndustryPreset(id: string): IndustryPreset | null {
  const p = PRESETS.find((x) => x.id === id);
  return p ? structuredClone(p) : null;
}

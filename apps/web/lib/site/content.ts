// VENTRA marketing site content. One honest source for every claim the site makes.
// Status rule (owner brief, "feature honesty"): live = a customer can use it today; demo = built, shown as a labelled preview,
// not yet switched on for customers; soon = not built. Never upgrade a status here without the feature actually shipping.

export type Status = 'live' | 'demo' | 'soon';
export const statusLabel: Record<Status, string> = { live: 'Live', demo: 'Demo', soon: 'Coming soon' };

export type Capability = { text: string; status: Status };
export type Pillar = {
  id: 'launcher' | 'courses' | 'receptionist' | 'setter' | 'growth';
  name: string; line: string; summary: string; status: Status; capabilities: Capability[];
};

export const pillars: Pillar[] = [
  {
    id: 'receptionist', name: 'AI Receptionist', line: 'Never miss another opportunity.',
    summary: 'Your AI receptionist answers calls, helps customers, and books appointments — even when you’re busy.',
    status: 'soon',
    capabilities: [
      { text: 'Answers calls and common questions', status: 'soon' },
      { text: 'Checks your calendar and books appointments', status: 'soon' },
      { text: 'Routes urgent calls to a person', status: 'soon' },
      { text: 'Missed-call text back', status: 'soon' },
      { text: 'Call summaries saved to your CRM', status: 'soon' },
    ],
  },
  {
    id: 'setter', name: 'AI Sales Setter', line: 'Find leads. Start conversations. Book appointments.',
    summary: 'Your AI sales assistant replies to every enquiry, qualifies the lead and books it into your calendar, so you can focus on growing your business.',
    status: 'demo',
    capabilities: [
      { text: 'Replies to enquiries by text, web chat and email', status: 'demo' },
      { text: 'Asks your qualifying questions, one at a time', status: 'demo' },
      { text: 'Offers real open times and books into Google Calendar', status: 'demo' },
      { text: 'Reminders and follow-ups that stop when the lead replies', status: 'demo' },
      { text: 'Instagram, Facebook Messenger and WhatsApp Business', status: 'soon' },
      { text: 'Phone conversations', status: 'soon' },
    ],
  },
  {
    id: 'launcher', name: 'AI Business Launcher', line: 'From an idea to your own business.',
    summary: 'Turn skills and ideas into a business: validate the idea, shape the offer and price, write the plan and prepare to launch.',
    status: 'demo',
    capabilities: [
      { text: 'Skills, idea evidence and offer validation worksheets', status: 'demo' },
      { text: 'Pricing scenarios and a one-page business plan', status: 'demo' },
      { text: 'Guided launch checklist', status: 'demo' },
      { text: 'AI idea generation and website builder', status: 'soon' },
    ],
  },
  {
    id: 'courses', name: 'AI Course & Education Creator', line: 'Turn what you know into something you can sell.',
    summary: 'Structure a course, write lessons and quizzes, plan coaching and workshops, and draft the page that sells it.',
    status: 'demo',
    capabilities: [
      { text: 'Course editor with modules, lessons and quizzes', status: 'demo' },
      { text: 'Coaching, workshop and certificate plans', status: 'demo' },
      { text: 'Course sales page drafts', status: 'demo' },
      { text: 'AI course generation, video hosting and learner logins', status: 'soon' },
    ],
  },
  {
    id: 'growth', name: 'AI Business Growth & Automation', line: 'Your business. Working smarter.',
    summary: 'Contacts, deals and follow-ups in one place, with marketing and automation built around them.',
    status: 'demo',
    capabilities: [
      { text: 'Contacts, sales pipeline and lead scoring', status: 'live' },
      { text: 'Follow-up reminders and appointment availability', status: 'live' },
      { text: 'Email campaigns, funnels and content plans (drafts)', status: 'demo' },
      { text: 'Running automations, ads and analytics from real data', status: 'soon' },
    ],
  },
];
export const pillarById = (id: Pillar['id']) => pillars.find(p => p.id === id) as Pillar;

export type Journey = { id: 'start' | 'educate' | 'grow'; title: string; who: string; detail: string; cta: string; demo: DemoId; heroLine: string };
export type DemoId = 'plan' | 'course' | 'receptionist' | 'social' | 'booking' | 'crm';
export const journeys: Journey[] = [
  { id: 'start', title: 'Start my business', who: 'For people turning ideas and skills into income.', detail: 'Validate the idea, set the price, write the plan, then let AI answer your first customers.', cta: 'Start with the Launcher', demo: 'plan', heroLine: 'Turn an idea into a business, then let AI answer your first customers.' },
  { id: 'educate', title: 'Create & sell education', who: 'For coaches, educators, mentors and creators.', detail: 'Structure a course, plan coaching, draft the sales page, and let AI book your discovery calls.', cta: 'Build a course', demo: 'course', heroLine: 'Turn what you know into a course, and let AI book your discovery calls.' },
  { id: 'grow', title: 'Grow & automate my business', who: 'For businesses that want every enquiry answered.', detail: 'An AI Setter that replies in under a minute and books qualified leads, with an AI Receptionist on the way.', cta: 'See the AI Setter', demo: 'booking', heroLine: 'Every enquiry answered in under a minute, qualified and booked.' },
];

export const demos: { id: DemoId; tab: string; title: string; status: Status }[] = [
  { id: 'plan', tab: 'Business plan', title: 'A one-page plan from your own answers', status: 'demo' },
  { id: 'course', tab: 'Course', title: 'A course structured module by module', status: 'demo' },
  { id: 'receptionist', tab: 'Receptionist', title: 'A call answered and booked', status: 'soon' },
  { id: 'social', tab: 'Social leads', title: 'An Instagram enquiry becomes a lead', status: 'soon' },
  { id: 'booking', tab: 'Booking', title: 'A qualified lead booked by text', status: 'demo' },
  { id: 'crm', tab: 'CRM', title: 'Every lead and deal in one pipeline', status: 'live' },
];

export const benefits = [
  'Spend less time on admin.',
  'Turn enquiries into appointments.',
  'Never lose track of a lead.',
  'Build products faster.',
  'Manage more of your business in one place.',
  'Focus on the work only you can do.',
];

// Pricing. OWNER: set real prices here (docs/agents/OWNER_TODO.md). While a price is null the site says it is confirmed on
// the strategy call and no checkout is offered. Usage (messages, phone minutes) is shown as its own line, never hidden.
export type Plan = { id: 'launch' | 'grow'; name: string; for: string; priceMonthlyAud: number | null; includes: string[]; usage: string | null };
export const plans: Plan[] = [
  { id: 'launch', name: 'Launch', for: 'Build your business and products', priceMonthlyAud: null,
    includes: ['Business Launcher tools', 'Course & Education Creator', 'Contacts, pipeline and follow-ups', 'Email support'], usage: null },
  { id: 'grow', name: 'Grow', for: 'Add AI employees that answer and book', priceMonthlyAud: null,
    includes: ['Everything in Launch', 'AI Sales Setter (text, web chat, email)', 'Google Calendar booking with reminders', 'Done-for-you setup'],
    usage: 'Text messages and, when it launches, AI phone minutes are billed at cost, shown on every invoice.' },
];
export const formatPrice = (p: Plan) => p.priceMonthlyAud === null ? null : `A$${p.priceMonthlyAud.toLocaleString('en-AU')}`;
/** Checkout opens only with a real price, Stripe configured and the owner's approval (NEXT_PUBLIC_SITE_CHECKOUT=1). */
export const checkoutReady = (p: Plan, env: Record<string, string | undefined> = process.env) => p.priceMonthlyAud !== null && env.NEXT_PUBLIC_SITE_CHECKOUT === '1';

export const faqs: { q: string; a: string }[] = [
  { q: 'What is VENTRA?', a: 'One workspace to start, run and grow a business: tools to plan a business and build courses, plus AI employees that answer enquiries and book appointments.' },
  { q: 'How does the AI Receptionist work?', a: 'It will answer your business calls, help with common questions, check your calendar and book appointments, and pass urgent calls to you. It is coming soon; today the AI Setter handles text, web chat and email.' },
  { q: 'Can it answer calls and book appointments?', a: 'Booking works today by text, web chat and email through the AI Setter (being switched on for customers now). Answering phone calls is coming soon with the AI Receptionist.' },
  { q: 'How does the AI Setter find leads?', a: 'It replies to people who contact you: texts, website chats and emails, within a minute. It asks your qualifying questions, offers real times from your calendar and books them. It never buys lists or messages people who have not contacted you.' },
  { q: 'Can the AI Setter connect to Instagram and Facebook?', a: 'Coming soon, through the official Meta business APIs with your permission. It will follow each platform’s messaging rules.' },
  { q: 'Can it contact customers over the phone?', a: 'Not yet. Phone conversations are coming soon, and will only call people who have opted in. The AI always says it is an AI assistant.' },
  { q: 'Do I need technical experience?', a: 'No. We set it up with you: your questions, your calendar, your number.' },
  { q: 'Does VENTRA replace my existing phone number?', a: 'No. The AI Setter uses its own Australian mobile number for texts. When the Receptionist launches you will be able to forward your existing number to it.' },
  { q: 'How are calls and messages charged?', a: 'Your plan covers the software. Text messages, and later phone minutes, are billed at cost and listed on every invoice. No hidden fees.' },
  { q: 'Can I try the product first?', a: 'Yes. Try the demos on this page, then book a free strategy call and we will show it working on your own enquiries.' },
  { q: 'Can I cancel?', a: 'Yes, any time. Terms are confirmed in writing before you pay.' },
  { q: 'What is available now versus coming soon?', a: 'Every feature on this page carries a label: Live (use it today), Demo (built, shown as a preview, being switched on) or Coming soon (not built yet).' },
];

export const contactEmail = 'founder@aiventrai.com';

// Copy and data for the public pages under /plant-lab (how it works, pricing, FAQ, contact).
// Plain data so it can be tested without rendering. Plan names and prices come from site-config only.
// Rules: no earnings promises, no invented proof, and every capability carries an honest status.
import { site } from '../site-config.ts';

export type PlanId = (typeof site.plans)[number]['id'];
export type Status = 'working' | 'pilot' | 'planned';

export const statusLabels: Record<Status, string> = {
  working: 'Working today',
  pilot: 'In pilot testing',
  planned: 'Planned',
};

export const BUILD_HREF = '/plant-lab/build';
export const PRIMARY_CTA = 'Build My AI Business';
export const PRICING_NOTICE = 'Draft pilot pricing: subject to change';

/**
 * Plan buttons start the free preview. The build flow reads ?plan= only to pre-select that plan on its last step
 * (nothing is bought and nothing is saved), so the label says that and no more.
 */
export function planButton(plan: { id: string; name: string; priceAud: number }): { label: string; href: string } {
  return {
    label: plan.priceAud === 0 ? 'Start the free preview' : `Start the free preview, then review ${plan.name}`,
    href: `${BUILD_HREF}?plan=${plan.id}`,
  };
}

/** The public pages that exist. Header and footer links are built from this list, so nothing links to a missing page. */
export const sitePages = [
  { id: 'how-it-works', href: '/plant-lab/how-it-works', label: 'How it works' },
  { id: 'pricing', href: '/plant-lab/pricing', label: 'Pricing' },
  { id: 'faq', href: '/plant-lab/faq', label: 'FAQ' },
  { id: 'contact', href: '/plant-lab/contact', label: 'Contact' },
] as const;

export type SitePageId = (typeof sitePages)[number]['id'];

export const howSteps: ReadonlyArray<{ title: string; body: string; status: Status }> = [
  {
    title: 'Choose a business',
    body: 'Pick one of the digital-product business models, or answer three short questions about your budget, spare hours and interests and get a suggestion. No account and no long form first.',
    status: 'working',
  },
  {
    title: 'See a sample preview',
    body: 'You get a sample business: a name, an offer, example products, a store design, starting prices to test and draft marketing posts. It is built from a prepared blueprint for the model you chose and is labelled as a sample. It is not a forecast of sales.',
    status: 'working',
  },
  {
    title: 'Review the plan and what you will connect',
    body: 'Before you sign up you see the draft plan price, the accounts you would connect yourself and the steps that need your approval.',
    status: 'working',
  },
  {
    title: 'Set up and review your launch',
    body: 'After sign-up, guided setup takes you through your idea, your first products and your store. You review everything and approve it before it is published. Setup is being tested with a small pilot group.',
    status: 'pilot',
  },
];

export const capabilities: ReadonlyArray<{ title: string; body: string; status: Status }> = [
  {
    title: 'Business preview',
    body: 'The two-step preview on this site runs today. Its output is a labelled sample.',
    status: 'working',
  },
  {
    title: 'Storefront and product pages',
    body: 'A store with product pages for your business. Built and being checked with a small pilot group before wider use.',
    status: 'pilot',
  },
  {
    title: 'Payments through Stripe',
    body: 'Checkout is designed to pay into your own Stripe account, and you complete Stripe’s identity check yourself. It runs in test mode only: no real payments are taken yet.',
    status: 'pilot',
  },
  {
    title: 'Automatic file delivery',
    body: 'After a confirmed payment the buyer is sent a download link. Tested alongside test-mode checkout; not yet used for real orders.',
    status: 'pilot',
  },
  {
    title: 'Pinterest publishing',
    body: 'The preview drafts sample posts. Posting them to a real Pinterest account, on a schedule you approve, is planned and not connected yet.',
    status: 'planned',
  },
  {
    title: 'Daily checks and summaries',
    body: 'A daily check that tells you what needs your attention is planned.',
    status: 'planned',
  },
];

export const control: ReadonlyArray<string> = [
  'Nothing is published, posted or charged without your approval.',
  'You choose the business, the name, the products and when to publish.',
  'Payments are designed to go to your own Stripe account, not to ours.',
  'Sales depend on your niche, your products and your marketing. We make no promise about sales or income.',
];

/** Comparison rows. Every row has one cell per plan in site-config; the price row is built from site-config. */
export type ComparisonRow = { id: string; label: string; status?: Status; cells: Record<PlanId, string> };

const priceText = (priceAud: number) => (priceAud === 0 ? 'Free' : `A$${priceAud} a month`);

const priceCells = Object.fromEntries(site.plans.map((p) => [p.id, priceText(p.priceAud)])) as Record<PlanId, string>;

export const comparisonRows: ReadonlyArray<ComparisonRow> = [
  { id: 'price', label: 'Draft price (AUD)', cells: priceCells },
  { id: 'ideas', label: 'Business idea suggestions', status: 'working', cells: { discover: '5 suggestions', launch: 'Included', autopilot: 'Included', scale: 'Included' } },
  { id: 'preview', label: 'Sample business preview', status: 'working', cells: { discover: 'Included', launch: 'Included', autopilot: 'Included', scale: 'Included' } },
  { id: 'store', label: 'Business and storefront', status: 'pilot', cells: { discover: 'Not included', launch: '1 business', autopilot: '1 business', scale: '1 business (more is planned)' } },
  { id: 'products', label: 'Product creation', status: 'pilot', cells: { discover: 'Not included', launch: 'Within monthly limits', autopilot: 'Within monthly limits', scale: 'Higher monthly limits' } },
  { id: 'payments', label: 'Payments to your own Stripe account', status: 'pilot', cells: { discover: 'Not included', launch: 'Included (test mode only for now)', autopilot: 'Included (test mode only for now)', scale: 'Included (test mode only for now)' } },
  { id: 'delivery', label: 'Automatic file delivery', status: 'pilot', cells: { discover: 'Not included', launch: 'Included', autopilot: 'Included', scale: 'Included' } },
  { id: 'pinterest', label: 'Approved Pinterest publishing', status: 'planned', cells: { discover: 'Not included', launch: 'Not included', autopilot: 'Planned', scale: 'Planned' } },
  { id: 'checks', label: 'Daily checks and summaries', status: 'planned', cells: { discover: 'Not included', launch: 'Not included', autopilot: 'Planned', scale: 'Planned' } },
  { id: 'multi', label: 'More than one business', status: 'planned', cells: { discover: 'Not included', launch: 'Not included', autopilot: 'Not included', scale: 'Planned' } },
];

export const pricingNotes: ReadonlyArray<string> = [
  'These prices are a draft being tested with pilot users. They are not final and may change before or after the pilot.',
  'Prices are in Australian dollars.',
  'Card fees on each sale are charged by Stripe under Stripe’s own pricing and are separate from the plan price.',
  'Monthly limits for product creation are still being set.',
  'Billing, cancellation and refund terms are being finalised and will be shown to you before you pay for anything.',
  'Optional extras such as a custom web address or advertising are not included in any plan price.',
];

export const faqItems: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What does it actually do today?',
    a: 'Today you can choose a digital-product business model and see a labelled sample preview with a name, an offer, example products, a store design, starting prices and draft marketing posts. Guided setup, the storefront, test-mode checkout and file delivery are being tested with a small pilot group. Pinterest publishing and daily checks are planned.',
  },
  {
    q: 'Do I need technical or design skills?',
    a: 'No. You make the decisions: which business, which name, which products and when to publish. The product does the setup work and asks for your approval.',
  },
  {
    q: 'Will this make me money?',
    a: 'We cannot promise that, and we will not suggest a figure. Sales depend on your niche, your products and your marketing. Starting any business carries cost and risk, and many new businesses make few or no sales.',
  },
  {
    q: 'Is the preview written for me personally?',
    a: 'Not yet. The preview is built from a prepared blueprint for the business model and niche you choose, and it is labelled as a sample. You confirm and change the details during setup.',
  },
  {
    q: 'What does it cost?',
    a: 'The preview is free and needs no card. Paid plans are shown on the pricing page as draft pilot pricing that is subject to change. Stripe charges its own card fee on each sale.',
  },
  {
    q: 'Can I take real payments now?',
    a: 'Not yet. Checkout is built to pay into your own Stripe account, but it runs in test mode only while the pilot is under way. No real customer payments are taken today.',
  },
  {
    q: 'Does it post to Pinterest for me?',
    a: 'Not yet. The preview drafts sample posts. Publishing approved posts to a real Pinterest account is planned and is not connected.',
  },
  {
    q: 'What happens before anything goes public?',
    a: 'Nothing is published, posted or charged without your approval. You review the brand, the first products and the store before they are published.',
  },
  {
    q: 'Who owns the store and the products?',
    a: 'The intent is that you do: the products are made for your business and payments are designed to go to your own Stripe account. The written terms are being finalised and will be shown to you before you pay.',
  },
  {
    q: 'Can I cancel, and what about refunds?',
    a: 'Cancellation and refund terms are being finalised. They will be shown to you before you pay for a plan. Until then, treat nothing on this site as a commitment on those terms.',
  },
  {
    q: 'Where is it available?',
    a: 'The pilot is focused on Australia, with prices in Australian dollars, and content is generated in English only for now.',
  },
  {
    q: 'What happens to the answers I give in the preview?',
    a: 'The preview does not ask for your name, email or card. Your choices are used to build the sample and to carry it into sign-up so you do not start again. A full privacy policy is being prepared.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. Nothing on this site is financial, legal or tax advice. Starting prices in the preview are suggestions to test, not forecasts.',
  },
];

export const pageMeta: Record<SitePageId, { title: string; description: string; h1: string; lead: string }> = {
  'how-it-works': {
    title: `How it works · ${site.name}`,
    description: `How ${site.name} takes you from choosing a digital-product business to a sample preview and guided setup, and which parts are working, in pilot or planned.`,
    h1: 'How it works',
    lead: 'Choose a business, see a sample preview, then decide. Each part below is marked as working today, in pilot testing or planned.',
  },
  pricing: {
    title: `Pricing and plan comparison · ${site.name}`,
    description: `Draft pilot pricing for ${site.name} plans, compared side by side. Prices are being tested and are subject to change.`,
    h1: 'Pricing',
    lead: 'The preview is free. The paid plans below are a draft we are testing with pilot users.',
  },
  faq: {
    title: `Questions and answers · ${site.name}`,
    description: `Plain answers about what ${site.name} does today, what is still being tested, costs, payments, approvals and ownership.`,
    h1: 'Questions and answers',
    lead: 'Plain answers, including what does not work yet.',
  },
  contact: {
    title: `Contact · ${site.name}`,
    description: `How to reach the ${site.name} team with questions about the product or the pilot.`,
    h1: 'Contact',
    lead: 'Questions about the product or the pilot are welcome.',
  },
};

/** Everything a visitor can read from this module, for the claims scan in tests. */
export function allPageText(): string[] {
  return [
    PRIMARY_CTA,
    PRICING_NOTICE,
    ...Object.values(statusLabels),
    ...sitePages.map((p) => p.label),
    ...howSteps.flatMap((s) => [s.title, s.body]),
    ...capabilities.flatMap((c) => [c.title, c.body]),
    ...control,
    ...comparisonRows.flatMap((r) => [r.label, ...Object.values(r.cells)]),
    ...pricingNotes,
    ...faqItems.flatMap((f) => [f.q, f.a]),
    ...Object.values(pageMeta).flatMap((m) => [m.title, m.description, m.h1, m.lead]),
  ];
}

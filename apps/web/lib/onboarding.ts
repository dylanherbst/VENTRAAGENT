export type Pathway = 'education' | 'business';
export type Stage = 'idea' | 'existing';
export const educationOffers = ['Course', '1:1 coaching', 'Mentorship', 'Group program', 'Workshop', 'In-person training'] as const;
export const businessTypes = ['Physical services', 'Physical products', 'Digital products & services'] as const;
export type Profile = {
  version: 1; id: string; name: string; primary: Pathway; pathways: Pathway[]; stage: Stage;
  industry: string; location: string; audience: string; goal: string; expertise: string;
  educationOffer: string; businessType: string; website: string; channels: string;
  completed: string[]; toolNotes: Record<string, string>;
};
export const storageKey = 'launchpad.business-profile.v1';
export function blankProfile(): Profile {
  return { version: 1, id: 'local-business', name: '', primary: 'education', pathways: ['education'], stage: 'idea', industry: '', location: '', audience: '', goal: '', expertise: '', educationOffer: 'Course', businessType: 'Physical services', website: '', channels: '', completed: [], toolNotes: {} };
}
export type RouteId = 'education' | 'independent' | 'grow';
export const routes: readonly { id: RouteId; title: string; summary: string }[] = [
  { id: 'education', title: 'Education & Mentoring', summary: 'Create courses, coaching or mentoring and manage your students.' },
  { id: 'independent', title: 'Independent Business', summary: 'Turn your skills into a business: offer, pricing, website and first customers.' },
  { id: 'grow', title: 'Grow & Automate My Business', summary: 'Connect your tools, win more leads and automate follow-up for an existing business.' },
];
// The three routes are views of the one profile model: they set stage, primary pathway and enabled pathways only.
export function routeOf(p: Pick<Profile, 'stage' | 'primary'>): RouteId {
  return p.stage === 'existing' ? 'grow' : p.primary === 'education' ? 'education' : 'independent';
}
export function applyRoute(p: Profile, route: RouteId): Profile {
  if (routeOf(p) === route) return p;
  const primary: Pathway = route === 'education' ? 'education' : 'business';
  // A profile that already has both pathways keeps both; changing route never drops one silently.
  const pathways: Pathway[] = p.pathways.length === 2 ? ['education', 'business'] : [primary];
  return { ...p, primary, pathways, stage: route === 'grow' ? 'existing' : 'idea' };
}
export function enablePathway(profile: Profile, pathway: Pathway): Profile {
  return { ...profile, pathways: [...new Set([...profile.pathways, pathway])] };
}
export function profileErrors(p: Profile): string[] {
  const errors = [];
  if (!p.name.trim()) errors.push('Add your business or project name.');
  if (!p.audience.trim()) errors.push('Tell us who your customers or learners are.');
  if (!p.goal.trim()) errors.push('Add your main goal.');
  if (p.pathways.includes('education') && !p.expertise.trim()) errors.push('Add the knowledge or skill you want to teach.');
  if (p.pathways.includes('business') && !p.industry.trim()) errors.push('Add your business industry or service.');
  if (p.website.trim()) { try { const u = new URL(p.website); if (!['https:', 'http:'].includes(u.protocol)) throw new Error(); } catch { errors.push('Use a full http:// or https:// website address, or leave it blank.'); } }
  return errors;
}
export type PlanStep = { id: string; title: string; detail: string; area: string };
export function buildPlan(p: Profile): PlanStep[] {
  const shared: PlanStep[] = p.stage === 'existing' ? [
    { id: 'connect', title: 'Connect your existing website and channels', detail: 'Review your website and sales channels, then plan a verified connection. No connection is active yet.', area: 'website' },
    { id: 'import', title: 'Prepare your customer import', detail: 'Review customer fields, consent and duplicates before connecting a CRM or importing records.', area: 'crm' },
    { id: 'agents', title: 'Configure your AI setter and receptionist', detail: 'Draft your FAQ, qualification questions, booking rules and human handoff. Live agents are not connected.', area: 'setter' },
    { id: 'campaigns', title: 'Generate your campaign brief', detail: `Plan a campaign for ${p.audience} around your goal: ${p.goal}. Review creative and follow-ups before sending.`, area: 'marketing' },
    { id: 'conversions', title: 'Optimise conversions', detail: 'Define enquiry, appointment, sales and repeat-customer measures. Connect a data source before measuring results.', area: 'analytics' },
  ] : [];
  if (p.pathways.includes('education')) shared.push(
    { id: 'education-expertise', title: 'Identify your expertise and audience', detail: `Validate demand for ${p.expertise} with ${p.audience}.`, area: 'education' },
    { id: 'education-offer', title: `Shape your ${p.educationOffer.toLowerCase()} offer`, detail: 'Define the learning outcome, format, price and support promise.', area: 'education' },
    { id: 'education-build', title: 'Build your education business', detail: 'Draft curriculum and lesson materials; prepare course pages, checkout and scheduling.', area: 'course' },
    { id: 'education-market', title: 'Market and sell your knowledge', detail: 'Prepare a lead magnet, social content, ads, email funnel and sales conversation.', area: 'marketing' },
    { id: 'education-deliver', title: 'Deliver and grow', detail: 'Plan your student portal, community, progress tracking, subscriptions and analytics.', area: 'education' },
  );
  if (p.pathways.includes('business')) shared.push(
    { id: 'business-understand', title: 'Understand your business', detail: `Define your ${p.businessType.toLowerCase()} offer in ${p.industry}${p.location ? ` for ${p.location}` : ''}, serving ${p.audience}.`, area: 'business' },
    { id: 'business-foundation', title: 'Build your business foundation', detail: 'Draft offers, pricing, brand assets and website; choose storefront, booking or checkout.', area: 'website' },
    { id: 'business-operations', title: 'Connect operations', detail: 'Plan calendar, CRM, payments, enquiries and customer records before connecting providers.', area: 'crm' },
    { id: 'business-growth', title: 'Activate AI growth', detail: 'Prepare the setter, receptionist, organic lead capture, ad creative and marketing automation.', area: 'setter' },
    { id: 'business-revenue', title: 'Optimise revenue', detail: 'Track enquiries, appointments, sales, repeat customers and marketing performance after connecting data.', area: 'analytics' },
  );
  return shared;
}
export const tools = [
  { id: 'website', title: 'AI Website Builder', prompt: 'Describe the pages, offer, pricing, brand and booking or checkout you need.' },
  { id: 'creative', title: 'AI Ad Creative', prompt: 'Draft your audience, offer, creative angle and permitted assets.' },
  { id: 'marketing', title: 'AI Marketing', prompt: 'Plan lead magnets, social content, email funnels and campaign goals.' },
  { id: 'setter', title: 'AI Sales Setter', prompt: 'Draft qualification questions, FAQ, sales channels and human handoff rules.' },
  { id: 'receptionist', title: 'AI Receptionist', prompt: 'Draft opening hours, services, call FAQs, booking rules and escalation contacts.' },
  { id: 'crm', title: 'CRM & Payments', prompt: 'Plan customer fields, consent, import mapping, deposits, checkout or invoices.' },
  { id: 'booking', title: 'Booking & Calendar', prompt: 'Plan appointment types, duration, service area, availability and buffers.' },
  { id: 'analytics', title: 'Analytics', prompt: 'Define enquiries, bookings, sales, repeat customers and campaign measures.' },
];
export function serializeProfile(profile: Profile): string {
  if (profileErrors(profile).length) throw new Error('Complete the required business details before saving.');
  return JSON.stringify(profile);
}
export function restoreProfile(raw: string | null): Profile | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || p.version !== 1 || p.id !== 'local-business' || !['education', 'business'].includes(p.primary) || !['idea', 'existing'].includes(p.stage)) return null;
    if (!Array.isArray(p.pathways) || !p.pathways.length || p.pathways.some((x: unknown) => !['education', 'business'].includes(x as string)) || !p.pathways.includes(p.primary) || new Set(p.pathways).size !== p.pathways.length) return null;
    for (const field of ['name', 'industry', 'location', 'audience', 'goal', 'expertise', 'educationOffer', 'businessType', 'website', 'channels']) if (typeof p[field] !== 'string') return null;
    if (!(educationOffers as readonly string[]).includes(p.educationOffer) || !(businessTypes as readonly string[]).includes(p.businessType)) return null;
    if (!Array.isArray(p.completed) || p.completed.some((x: unknown) => typeof x !== 'string')) return null;
    if (!p.toolNotes || typeof p.toolNotes !== 'object' || Array.isArray(p.toolNotes) || Object.values(p.toolNotes).some(x => typeof x !== 'string')) return null;
    return profileErrors(p).length ? null : p;
  } catch { return null; }
}

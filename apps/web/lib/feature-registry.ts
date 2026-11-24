// Single feature status registry for the customer-facing screens.
// SOURCE OF TRUTH for status is docs/agents/FEATURES.md. Every entry names the exact FEATURES.md "Feature" cell it
// is based on (`row`); test/feature-registry.test.ts fails if a row is missing or its status differs.
// Presentation only: this file never enables anything. A "working" entry is enabled for the verified capability only.

export type FeatureStatus = 'working' | 'local-draft' | 'blocked' | 'not-started';
export type FeatureSection =
  | 'courses' | 'start' | 'services' | 'website'
  | 'marketing' | 'content' | 'leads' | 'automation' | 'receptionist'
  | 'customers' | 'insights' | 'account';

export type Feature = {
  id: string;
  name: string;
  description: string;
  section: FeatureSection;
  /** Customer-facing route. Null when nothing can be opened. */
  route: string | null;
  status: FeatureStatus;
  /** Plain-English line about what this is and is not. Shown on the tile and read to screen readers. */
  availability: string;
  /** Backend, API or account needed. */
  requires: string;
  permissions: string;
  /** Exact "Feature" cell in docs/agents/FEATURES.md. */
  row: string;
  /** Where the evidence lives (the isolated verification page). Never linked from customer navigation. */
  verification: string;
};

const SAVED = 'Saves on this device. Sign in to keep a copy in your account.';
const f = (
  id: string, name: string, description: string, section: FeatureSection, route: string | null,
  status: FeatureStatus, availability: string, row: string, verification: string,
  requires = status === 'working' ? 'Account storage (optional, for saving to your account)' : status === 'local-draft' ? 'None. Browser data only' : 'Not available yet',
  permissions = 'Signed-in workspace member',
): Feature => ({ id, name, description, section, route, status, availability, requires, permissions, row, verification });

export const features: readonly Feature[] = [
  // Create > Courses & Coaching
  f('course-editor', 'Course editor', 'Write modules and lessons.', 'courses', '/business?tab=delivery#course-editor', 'working', SAVED, 'Course Creator (create, edit, save, reload, update, delete)', '/tools/course-creator'),
  f('lesson-quizzes', 'Lesson quizzes', 'Add questions to a lesson.', 'courses', '/business?tab=delivery#course-quizzes', 'working', SAVED, 'Lesson quizzes', '/tools/lesson-quiz'),
  f('learner-preview', 'Learner preview', 'See your course as a student would.', 'courses', '/business?tab=delivery#learner-preview', 'working', 'A preview for you only. It is not a student login or a student portal.', 'Learner portal preview', '/tools/learner-portal'),
  f('course-sales-page', 'Course sales page', 'Draft the page that sells your course.', 'courses', '/business?tab=offers#course-sales-page', 'working', 'A draft. It is not published.', 'Course sales page', '/tools'),
  f('coaching-programs', 'Coaching and workshops', 'Plan a program, a workshop or 1:1 sessions.', 'courses', '/business?tab=offers#coaching', 'working', 'A plan you write yourself. Nothing is booked or sent.', 'Coaching program and workshop plans', '/tools'),
  f('certificates', 'Certificates', 'Design a certificate template.', 'courses', '/business?tab=offers#certificates', 'working', 'A template. No certificate is issued to anyone.', 'Certificates', '/tools'),
  f('student-progress', 'Student progress', 'Record how each student is going.', 'courses', '/business?tab=delivery#student-progress', 'working', 'You record this by hand. It is not automatic tracking.', 'Student progress tracking (owner-recorded)', '/business?tab=delivery'),
  f('ai-course', 'AI course generation', 'Create a course outline with AI.', 'courses', null, 'blocked', 'Needs setup: an AI provider connection.', 'AI course generation', '/tools/course-creator'),
  f('video-lessons', 'Video lessons', 'Host and play lesson videos.', 'courses', null, 'not-started', 'Coming soon. Needs video hosting.', 'Video lessons', ''),
  f('student-portal', 'Student accounts', 'Student logins and a learner portal.', 'courses', null, 'not-started', 'Coming soon. The learner preview is not a login.', 'Student portal (learner login, learner-facing portal, automatic progress tracking)', ''),
  // Create > Start a Business
  f('skills', 'My skills', 'Rate what you are good at.', 'start', '/create/start#start-skills', 'working', SAVED, 'Skill self-assessment saved to your account', '/tools'),
  f('evidence', 'Business idea evidence', 'Keep notes on what customers say.', 'start', '/create/start#start-evidence', 'working', SAVED, 'Market evidence notebook saved to your account', '/tools'),
  f('validate', 'Validate your offer', 'Check that people want it.', 'start', '/create/start#start-validate', 'working', SAVED, 'Offer validation worksheet saved to your account', '/tools'),
  f('pricing', 'Pricing', 'Try out prices and see the numbers.', 'start', '/create/start#start-pricing', 'working', SAVED, 'Pricing scenario saved to your account', '/tools/launcher-account'),
  f('branding', 'Branding', 'Choose your look and tone.', 'start', '/create/start#start-branding', 'working', SAVED, 'Brand direction saved to your account', '/tools'),
  f('business-plan', 'Business plan', 'Write a one-page plan.', 'start', '/create/start#start-plan', 'working', SAVED, 'Business plan draft saved to your account', '/tools'),
  f('launch-checklist', 'Launch checklist', 'Tick off each step to launch.', 'start', '/create/start#start-checklist', 'working', SAVED, 'Guided launch checklist', '/tools/launch-checklist'),
  f('ai-idea', 'AI business idea helper', 'Get business ideas from AI.', 'start', null, 'not-started', 'Coming soon. Needs an AI provider.', 'AI business idea generator and AI Business Advisor', ''),
  // Create > Services & Offers
  f('offers', 'Offers and pricing', 'Describe what you sell and its price.', 'services', '/business?tab=offers', 'working', SAVED, 'Service offers and pricing', '/tools/service-offers'),
  f('proposals', 'Proposals', 'Draft a proposal for a client.', 'services', '/business?tab=delivery#proposals', 'working', 'A draft. Nothing is sent to the client.', 'Proposals saved to your account', '/tools'),
  f('agreements', 'Agreements', 'Draft an agreement.', 'services', '/business?tab=offers#agreements', 'working', 'A draft. It is not a signed contract.', 'Agreements and contracts saved to your account', '/tools'),
  f('invoices', 'Invoice drafts', 'Prepare an invoice.', 'services', '/sales?tab=invoices', 'working', 'A draft. It is not a payment and nothing is sent.', 'Invoices saved to your account', '/tools'),
  f('client-portal', 'Client portal draft', 'Plan what a client would see.', 'services', '/business?tab=offers#client-portal', 'working', 'A draft. Clients cannot log in.', 'Client portal draft saved to your account', '/tools'),
  f('project-board', 'Project board', 'Track client work by stage.', 'services', '/business?tab=delivery#client-projects', 'working', SAVED, 'Project board saved to your account', '/tools'),
  f('membership-plans', 'Membership plans', 'Plan membership tiers.', 'services', '/business?tab=memberships', 'working', 'A plan only. Nobody can join yet.', 'Membership plan drafts (planning only)', '/tools/membership-plans'),
  f('public-booking', 'Public booking page', 'Let customers book a time.', 'services', null, 'not-started', 'Coming soon. Needs a calendar connection.', 'Public booking pages and real bookings', ''),
  f('live-memberships', 'Live memberships', 'Take members and payments.', 'services', null, 'not-started', 'Coming soon.', 'Memberships', ''),
  // Create > Website & Store
  f('website-pages', 'Website pages', 'Write and preview a page.', 'website', '/business?tab=website', 'working', 'A draft. It is not published.', 'Website pages and templates', '/business?tab=website'),
  f('storefront', 'Storefront', 'List your products.', 'website', '/business?tab=website#storefront', 'working', 'A draft. It is not live and has no checkout.', 'Storefront and product listings', '/tools'),
  f('link-in-bio', 'Link in bio', 'Plan one page of links.', 'website', '/business?tab=offers#link-in-bio', 'working', 'A draft. It is not published.', 'Link-in-bio page', '/tools'),
  f('ai-website', 'AI website builder', 'AI writing, drag and drop, your own domain.', 'website', null, 'not-started', 'Coming soon.', 'AI website generation, drag-and-drop editing, custom domains', ''),
  f('checkout', 'Checkout', 'Take a card payment.', 'website', null, 'blocked', 'Needs setup: a payment provider connection. No payment can be taken.', 'Test-mode Stripe checkout', '/tools/checkout'),
  f('orders', 'Orders', 'See paid orders.', 'website', null, 'blocked', 'Needs setup: a payment connection.', 'Payment webhook and orders', ''),
  // Grow > Marketing
  f('email-drafts', 'Email campaigns', 'Draft emails and follow-up sequences.', 'marketing', '/grow?tab=campaigns', 'working', 'Drafts only. Nothing is sent.', 'Email campaign and nurture sequence drafts', '/tools/email-campaigns'),
  f('funnel-drafts', 'Funnels', 'Plan how a visitor becomes a customer.', 'marketing', '/grow?tab=funnels', 'working', 'A plan only. Nothing is tracked.', 'Funnel drafts (planning only)', '/tools/funnels'),
  f('email-sending', 'Sending and tracking', 'Send emails and track results.', 'marketing', null, 'not-started', 'Coming soon. Needs an email provider.', 'Lead magnets, funnel execution and tracking, and sending of email campaigns and nurture sequences', ''),
  // Grow > Content Studio
  f('content-calendar', 'Plan content', 'Plan posts by date.', 'content', '/grow?tab=content', 'working', 'Drafts and dates. Nothing is posted for you.', 'Content calendar and social post drafts', '/tools/content-calendar'),
  f('ad-concepts', 'Create an ad', 'Write an ad idea by hand.', 'content', '/business?tab=offers#ad-concepts', 'working', 'A manual concept. Nothing is run or published.', 'Ad concepts (manual drafts)', '/tools'),
  f('create-post', 'Create a post', 'Write a social post draft.', 'content', '/grow?tab=content', 'working', 'A draft. Nothing is posted for you.', 'Content calendar and social post drafts', '/tools/content-calendar'),
  f('create-image', 'Create an image', 'Make an image with AI.', 'content', null, 'not-started', 'Coming soon. Needs an AI provider.', 'AI captions, AI images and video', ''),
  f('create-video', 'Create a video', 'Make a video with AI.', 'content', null, 'not-started', 'Coming soon. Needs an AI provider.', 'AI captions, AI images and video', ''),
  // Grow > Lead Generation
  f('lead-forms', 'Find customers: lead forms', 'Draft a form that collects enquiries.', 'leads', '/grow?tab=leads', 'working', 'A draft. It is not on a public page.', 'Lead capture forms', '/tools'),
  f('growth-plan', 'Growth plan', 'A 30-day plan from your own notes.', 'leads', '/grow?tab=leads', 'working', SAVED, 'Growth plan and manual audit', '/tools/growth-plan'),
  f('lead-discovery', 'Automatic lead discovery', 'Find leads and draft outreach with AI.', 'leads', null, 'not-started', 'Coming soon. Needs an AI provider and consent rules.', 'Lead discovery, outreach drafts, AI appointment setter, lead scoring, follow-ups', ''),
  // Grow > Automations and AI Receptionist
  f('workflow-drafts', 'Workflow drafts', 'Design a workflow.', 'automation', '/grow?tab=automations', 'working', 'A saved workflow is a plan. It is not running.', 'Workflow builder drafts (design only)', '/tools/workflow-builder'),
  f('workflow-run', 'Run automations', 'Activate a workflow and run AI agents.', 'automation', null, 'not-started', 'Coming soon. Nothing runs automatically.', 'Workflow execution engine, real triggers, AI agents', ''),
  f('ai-receptionist', 'AI receptionist', 'Answer calls, FAQs and bookings.', 'receptionist', null, 'not-started', 'Coming soon. Needs a phone provider. No calls are answered.', 'AI answering calls, FAQs, bookings, call summaries', ''),
  // Customers
  f('contacts', 'Contacts', 'Your customers and enquiries.', 'customers', '/customers?tab=contacts', 'working', SAVED, 'Contacts saved to your account', '/customers'),
  f('deals', 'Deals', 'Track each sale by stage.', 'customers', '/customers?tab=opportunities', 'working', SAVED, 'Sales pipeline and deals saved to your account', '/customers?tab=opportunities'),
  f('lead-scoring', 'Lead scoring', 'Rank leads with rules you set.', 'customers', '/customers?tab=lead-scoring', 'working', 'Rule-based. Not AI.', 'Lead qualification and rule-based scoring', '/tools/lead-scoring'),
  f('follow-ups', 'Follow-ups', 'Reminders to get back to people.', 'customers', '/customers?tab=follow-ups', 'working', 'Reminders you write. Nothing is sent for you.', 'Lead follow-up task list (manual)', '/tools/lead-followups'),
  f('appointments', 'Appointments', 'Plan the times you are available.', 'customers', '/sales?tab=appointments', 'working', 'An availability draft. It is not a booking and has no calendar.', 'Booking page drafts (availability preview)', '/tools/booking-page'),
  f('client-projects', 'Client projects', 'Track work for each client.', 'customers', '/business?tab=delivery#client-projects', 'working', SAVED, 'Project board saved to your account', '/tools'),
  f('sales-reports', 'Sales reports', 'Totals from your saved deals.', 'customers', '/customers?tab=reports', 'local-draft', 'Draft. Worked out from deals saved in this browser. Not real payments.', 'Sales reporting from saved deals', '/tools/sales-report'),
  f('inbox', 'Unified inbox', 'Email and messages in one place.', 'customers', null, 'not-started', 'Coming soon. Needs an email or messaging connection.', 'Unified inbox', ''),
  f('calendar', 'Calendar connection', 'Real appointments on your calendar.', 'customers', null, 'not-started', 'Coming soon. Needs a calendar connection.', 'Calendar connection and real appointments', ''),
  f('auto-assign', 'Automatic assignment', 'Assign leads and move deals automatically.', 'customers', null, 'not-started', 'Coming soon.', 'Lead qualification follow-up (assignment, stage automation)', ''),
  // More > Insights & Reports, Account
  f('business-overview', 'Business overview', 'Counts and charts from what you saved.', 'insights', '/insights?tab=overview', 'local-draft', 'Draft. Worked out from data saved in this browser. Not real revenue.', 'Business overview from saved data', '/tools/business-overview'),
  f('revenue-insights', 'Revenue and AI insights', 'Real revenue and AI advice.', 'insights', null, 'not-started', 'Coming soon. Needs connected payments and lead data.', 'Revenue from real payments, AI insights', ''),
  f('integrations', 'Integrations', 'See what is connected.', 'account', '/settings?section=integrations', 'working', 'Shows what is connected. Nothing is connected for you.', 'Integrations settings', '/api/integrations/status'),
  f('team', 'Team', 'See who is in your workspace.', 'account', '/settings?section=team', 'working', 'A read-only list. Invites are not available yet.', 'Team members list (read-only)', '/tools/team-members'),
  f('notifications', 'Notifications', 'Notices from your saved data.', 'account', '/settings?section=notifications', 'working', 'In the app only. No email or push.', 'Notifications centre (in-app)', '/tools/notifications'),
  f('account-save', 'Account and saved work', 'Profile, saved data, export and restore.', 'account', '/settings', 'working', SAVED, 'Account data saving (profile, offers)', '/workspace'),
  f('billing', 'Billing', 'Your VENTRA plan and invoices.', 'account', null, 'not-started', 'Coming soon.', 'Subscriptions and billing for VENTRA itself', ''),
];

export const featureById = (id: string): Feature | undefined => features.find(x => x.id === id);
export const featuresIn = (...sections: FeatureSection[]): Feature[] => features.filter(x => sections.includes(x.section));

/** One vocabulary everywhere: Ready, Draft, Needs setup, Coming soon. */
export function statusLabel(s: FeatureStatus): string {
  return s === 'working' ? 'Ready' : s === 'local-draft' ? 'Draft' : s === 'blocked' ? 'Needs setup' : 'Coming soon';
}
/** Only working and local-draft features can be opened. Blocked and not-started are never actionable. */
export const isOpenable = (x: Feature): boolean => (x.status === 'working' || x.status === 'local-draft') && x.route !== null;

/** Features whose editor only appears when that pathway is on in the business profile. The hubs show these as "Turn on ..." instead of Ready when it is off. */
export const pathwayNeeded: Readonly<Record<string, 'education' | 'business'>> = {
  'course-editor': 'education', 'lesson-quizzes': 'education', 'learner-preview': 'education', 'course-sales-page': 'education', 'coaching-programs': 'education', certificates: 'education', 'student-progress': 'education',
  proposals: 'business', agreements: 'business', 'client-portal': 'business', 'project-board': 'business', 'client-projects': 'business',
};

/** Search by feature name or description (all words must match). Used by the global search box. */
export function searchFeatures(query: string): Feature[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return features.filter(x => terms.every(t => (x.name + ' ' + x.description).toLowerCase().includes(t)));
}

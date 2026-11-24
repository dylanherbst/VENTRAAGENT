// Every feature of the Claude Small Business plugin, mapped onto AiMoneyPrinter. Source: the plugin's router and connector map (read 16 Nov 2026).
// This is the feature map, not the plugin itself: each entry says what the owner gets, which Store-team workflow carries it (if one exists),
// the highest action it takes (which sets the approval default), and when it ships. Pure data; nothing runs from here.
//
// Phases: launch = part of the first side-hustle release; later = documented, built after launch; outside_brief = in the plugin but the rework
// brief keeps it out of the default journey (payroll, hiring, inventory, supplier bills, bookkeeping, tax). Those are catalogued, switched off.
import type { ActionKind } from './catalog.ts';

export const pluginBuckets = ['money', 'growth', 'customers', 'week', 'build'] as const;
export type PluginBucket = (typeof pluginBuckets)[number];
export const BUCKET_LABELS: Readonly<Record<PluginBucket, string>> = { money: 'Your money', growth: 'Your growth', customers: 'Your customers', week: 'Your week', build: 'Build your own' };

export type Phase = 'launch' | 'later' | 'outside_brief';

export interface PluginFeature {
  /** Plugin skill or command name. */
  id: string;
  /** True when the plugin exposes it as a slash command (the end-to-end flow). */
  command: boolean;
  bucket: PluginBucket;
  label: string;
  /** What the owner gets, in shop language. */
  summary: string;
  /** The Store-team workflow that carries it, or null when none exists yet. */
  workflow: string | null;
  action: ActionKind;
  phase: Phase;
  /** Connector categories it reads from (never a vendor). */
  needs: string[];
  /** Works without any connector: paste, CSV or the shop's own data. */
  fallback: string;
}

const f = (id: string, command: boolean, bucket: PluginBucket, label: string, summary: string, workflow: string | null, action: ActionKind, phase: Phase, needs: string[], fallback: string): PluginFeature =>
  ({ id, command, bucket, label, summary, workflow, action, phase, needs, fallback });

export const pluginFeatures: readonly PluginFeature[] = [
  // Your week
  f('monday-brief', true, 'week', 'Monday brief', 'One page to start the week: results, what needs you, what is due.', null, 'read', 'launch', ['orders', 'marketing'], 'The shop\'s own orders and posts.'),
  f('business-pulse', false, 'week', 'Business pulse', 'How the shop is doing: yesterday\'s orders, revenue and open decisions.', null, 'read', 'launch', ['orders'], 'The shop\'s own orders.'),
  f('inbox-manager', false, 'week', 'Inbox manager', 'Sorts enquiries, drafts replies, flags what needs you.', 'receptionist', 'draft', 'launch', ['mailbox'], 'Messages pasted into the Inbox.'),
  // Your growth
  f('social-content-engine', false, 'growth', 'Content engine', 'A weekly calendar of posts and captions from your product and brand.', null, 'draft', 'launch', ['social'], 'Export the posts to publish by hand.'),
  f('canva-creator', false, 'growth', 'Design creator', 'Turns an approved campaign brief into finished post graphics.', null, 'draft', 'launch', ['design'], 'Downloadable text and image briefs.'),
  f('marketing-monday', true, 'growth', 'Marketing Monday', 'The weekly growth brief: what worked, what to post, what to try.', null, 'draft', 'launch', ['social', 'orders'], 'The shop\'s own orders and posts.'),
  f('content-strategy', false, 'growth', 'Content strategy', 'What to promote this week, based on what sells.', null, 'draft', 'launch', ['orders'], 'The shop\'s own orders.'),
  f('growth-pulse', false, 'growth', 'Growth pulse', 'Is marketing working: which posts and links bring buyers.', null, 'read', 'launch', ['social', 'analytics'], 'Shop link visits and orders.'),
  f('seo-ai-visibility', false, 'growth', 'Be found', 'Search and AI-search visibility for the shop page and product listing.', null, 'draft', 'launch', ['website'], 'The shop\'s own page.'),
  f('lead-finder', false, 'growth', 'Lead finder', 'A short list of people likely to want the product.', null, 'read', 'later', ['web'], 'The owner\'s own list.'),
  f('outreach-composer', false, 'growth', 'Outreach composer', 'Messages and follow-ups to the first buyers the owner already knows.', null, 'draft', 'launch', [], 'Written in the app; the owner sends them.'),
  f('speed-to-lead', false, 'growth', 'Speed to lead', 'Fast first reply to every enquiry so none go cold.', 'receptionist', 'draft', 'launch', ['mailbox'], 'Messages pasted into the Inbox.'),
  f('reactivate', true, 'growth', 'Win back buyers', 'Re-engages past buyers with a relevant offer.', 'cart-follow-up', 'send', 'later', ['orders'], 'Past orders in the shop.'),
  f('ad-manager', false, 'growth', 'Ad manager', 'Reads ad results and recommends what to pause or move. Never spends on its own.', 'ad-watcher', 'money', 'later', ['ads'], 'Pasted ad report.'),
  f('lead-triage', false, 'growth', 'Lead triage', 'Ranks leads so the owner knows who to answer first.', null, 'read', 'later', ['crm'], 'A pasted list.'),
  f('call-list', true, 'growth', 'Call list', 'Top people to contact today, with time blocked.', null, 'read', 'later', ['crm', 'calendar'], 'A pasted list.'),
  f('grow-pipeline', true, 'growth', 'Grow pipeline', 'Find, message and follow up end to end.', null, 'send', 'later', ['crm'], 'A pasted list.'),
  f('crm-autopilot', false, 'growth', 'CRM autopilot', 'Keeps contact records tidy and logs calls.', null, 'draft', 'later', ['crm'], 'A pasted list.'),
  f('proposal-builder', false, 'growth', 'Proposal builder', 'Quotes and proposals for service work.', null, 'draft', 'later', [], 'Typed brief.'),
  f('grant-rfp-writer', false, 'growth', 'Grant writer', 'Drafts grant and tender responses.', null, 'draft', 'later', [], 'Typed brief.'),
  // Your customers
  f('ticket-deflector', false, 'customers', 'Order questions', 'Answers where-is-my-order and download questions from real order facts, and escalates upset customers.', 'order-tracker', 'draft', 'launch', ['orders', 'mailbox'], 'Order ID and email typed into the Inbox.'),
  f('review-reputation', false, 'customers', 'Reviews', 'Asks for reviews after delivery, flags bad ones to the owner, drafts replies.', 'review-asker', 'send', 'launch', ['reviews'], 'Reviews pasted in.'),
  // Your money
  f('invoice-chase', false, 'money', 'Invoice chase', 'Reminders for overdue invoices (service shops).', null, 'send', 'later', ['invoices'], 'Pasted receivables list.'),
  f('cash-flow-snapshot', false, 'money', 'Cash snapshot', 'A short cash picture from sales and costs.', null, 'read', 'later', ['payments'], 'Shop sales only.'),
  f('report-builder', false, 'money', 'Report builder', 'Tracks the numbers the owner picks.', null, 'read', 'later', ['orders'], 'Shop sales only.'),
  f('report-pack', true, 'money', 'Report pack', 'Recurring reports on a schedule.', null, 'read', 'later', ['orders'], 'Shop sales only.'),
  f('plan-payroll', true, 'money', 'Payroll plan', 'Cash forecast before payroll.', null, 'read', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('payroll-prep', false, 'money', 'Payroll prep', 'Timesheets to a payroll run.', null, 'money', 'outside_brief', ['payroll'], 'Not in the default journey.'),
  f('pay-the-bills', true, 'money', 'Pay the bills', 'Supplier bills to a payment run.', null, 'money', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('ap-processor', false, 'money', 'Bill processing', 'Codes supplier invoices.', null, 'draft', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('close-month', true, 'money', 'Close the month', 'Month-end close packet.', null, 'draft', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('month-end-prep', false, 'money', 'Month-end prep', 'Reconciliation only.', null, 'draft', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('tax-prep', true, 'money', 'Tax prep', 'Quarterly estimates and 1099s.', null, 'draft', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  f('tax-season-organizer', false, 'money', 'Tax organiser', 'Year-end tax records.', null, 'draft', 'outside_brief', ['accounting'], 'Not in the default journey.'),
  // Operations and people (the plugin files these under "week" and "build" in its router; grouped here by job)
  f('restock', true, 'week', 'Restock', 'Reorder drafts for physical stock.', 'order-drafter', 'draft', 'outside_brief', ['inventory'], 'Not in the default journey.'),
  f('inventory-planner', false, 'week', 'Inventory planner', 'Stock levels and reorder timing.', 'stock-watcher', 'read', 'outside_brief', ['inventory'], 'Not in the default journey.'),
  f('job-post-builder', false, 'week', 'Job post builder', 'Job post and screening rubric.', null, 'draft', 'outside_brief', [], 'Not in the default journey.'),
  f('hiring-screener', false, 'week', 'Hiring screener', 'Scores applications and drafts replies.', null, 'draft', 'outside_brief', [], 'Not in the default journey.'),
  f('contract-review', false, 'week', 'Contract review', 'Reads a contract or NDA and flags risks. Not legal advice.', null, 'read', 'later', [], 'Pasted text.'),
  // Build your own
  f('smb-onboard', false, 'build', 'Set-up interview', 'Learns the shop, brand and headaches once, so every workflow uses them.', null, 'draft', 'launch', [], 'The Find-my-side-hustle answers.'),
  f('brand-style', false, 'build', 'Brand style', 'Keeps tone, colours and report style consistent.', null, 'draft', 'launch', [], 'The brand step.'),
  f('build-agent', false, 'build', 'Make it automatic', 'Turns a weekly chore into a saved workflow.', null, 'draft', 'later', [], 'Typed description.'),
  f('build-connector', false, 'build', 'Connect a tool', 'Connects a tool that is not supported yet.', null, 'read', 'later', [], 'CSV or paste.'),
  f('smb-router', false, 'build', 'Concierge', 'Understands what the owner needs and picks the right workflow.', null, 'read', 'launch', [], 'Pick from the list.'),
];

export function featuresIn(bucket: PluginBucket): PluginFeature[] { return pluginFeatures.filter((x) => x.bucket === bucket); }
export function featuresAt(phase: Phase): PluginFeature[] { return pluginFeatures.filter((x) => x.phase === phase); }
export const featureById = (id: string): PluginFeature | undefined => pluginFeatures.find((x) => x.id === id);

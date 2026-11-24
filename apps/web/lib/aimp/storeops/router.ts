// The concierge: picks the single best feature for what the owner typed. Deterministic (no model), so it is testable and safe to run on every
// message. Rules are ordered by urgency (money before marketing, complaints before pipeline), as in the plugin's own router.
import { featureById, type PluginFeature } from './plugin.ts';

interface Rule { id: string; test: RegExp }

const rules: readonly Rule[] = [
  { id: 'ticket-deflector', test: /\b(upset|angry|complain\w*|where('s| is) my (order|download)|check my orders|chargeback)\b/i },
  { id: 'plan-payroll', test: /\b(make payroll|payroll next|can i (make|cover) payroll)\b/i },
  { id: 'payroll-prep', test: /\b(run payroll|timesheets?)\b/i },
  { id: 'tax-prep', test: /\b(tax(es)?|1099s?|quarterly estimates?)\b/i },
  { id: 'close-month', test: /\b(close the (books|month)|month[- ]end|reconcil\w+)\b/i },
  { id: 'pay-the-bills', test: /\b(pay the bills|payment run)\b/i },
  { id: 'ap-processor', test: /\b(code (these )?invoices|process (these )?bills)\b/i },
  { id: 'invoice-chase', test: /\b(who owes me|overdue invoices?)\b/i },
  { id: 'cash-flow-snapshot', test: /\b(cash ?flow|runway|cash is tight)\b/i },
  { id: 'ad-manager', test: /\b(my ads?|ad spend|ad money)\b/i },
  { id: 'restock', test: /\b(reorder|restock|running out of|stock)\b/i },
  { id: 'hiring-screener', test: /\b(screen (these )?applications?|rank candidates)\b/i },
  { id: 'job-post-builder', test: /\b(job post|hire someone|hiring packet)\b/i },
  { id: 'contract-review', test: /\b(contract|nda|should i sign)\b/i },
  { id: 'review-reputation', test: /\b(reviews?|reputation|what are customers saying|churn)\b/i },
  { id: 'reactivate', test: /\b(win back|re-?engage|quiet customers|past buyers)\b/i },
  { id: 'speed-to-lead', test: /\b(leads? (are )?(going )?cold|answer (my )?inquir\w+ fast|nothing falls through)\b/i },
  { id: 'lead-finder', test: /\b(find (me )?(customers|leads|buyers)|prospect list|more leads)\b/i },
  { id: 'outreach-composer', test: /\b(cold email|outreach|follow-?up sequence|message (my )?friends)\b/i },
  { id: 'seo-ai-visibility', test: /\b(seo|found on google|ai search|visibility)\b/i },
  { id: 'canva-creator', test: /\b(run this brief|execute the campaign|make the graphics?)\b/i },
  { id: 'marketing-monday', test: /\b(marketing monday|weekly growth brief)\b/i },
  { id: 'social-content-engine', test: /\b(posts?|captions?|content calendar|make the content|what should we post)\b/i },
  { id: 'content-strategy', test: /\b(what should i promote|what to promote|sales brief)\b/i },
  { id: 'growth-pulse', test: /\b(is my marketing working|campaign roi|funnel|competitors?)\b/i },
  { id: 'monday-brief', test: /\b(monday brief|start my week|weekly briefing)\b/i },
  { id: 'business-pulse', test: /\b(how('s| is) the (business|shop)|snapshot|catch me up|brief me|prep my day)\b/i },
  { id: 'inbox-manager', test: /\b(inbox|email|emails|messages|enquir\w+)\b/i },
  { id: 'report-pack', test: /\b(weekly pack|recurring reports?)\b/i },
  { id: 'report-builder', test: /\b(build me a report|kpi|track these numbers)\b/i },
  { id: 'build-agent', test: /\b(every week|automate|make this automatic|i do this every)\b/i },
  { id: 'brand-style', test: /\b(rebrand\w*|update my brand|brand voice)\b/i },
  { id: 'smb-onboard', test: /\b(set me up|i'?m new|get started)\b/i },
];

export type Availability = 'available_soon' | 'documented' | 'switched_off';

export interface Route {
  feature: PluginFeature;
  /** launch: part of this release. later: documented, not built yet. outside_brief: kept out of the default journey. */
  availability: Availability;
  /** One plain sentence the app can show before asking the owner to confirm. */
  message: string;
}

/** Returns the one best feature, or null when nothing fits (the app then shows the overview). Digital shops skip physical-only matches. */
export function routeRequest(text: string, opts: { digitalShop?: boolean } = {}): Route | null {
  const t = text.slice(0, 500);
  for (const r of rules) {
    if (!r.test.test(t)) continue;
    const feature = featureById(r.id);
    if (!feature) continue;
    if (opts.digitalShop && (feature.id === 'restock' || feature.id === 'inventory-planner')) continue;
    const availability: Availability = feature.phase === 'launch' ? 'available_soon' : feature.phase === 'later' ? 'documented' : 'switched_off';
    const message = availability === 'switched_off'
      ? `${feature.label} is part of the full toolkit but is switched off for new shops. Nothing has been done.`
      : availability === 'documented' ? `${feature.label} is planned but not available yet.` : `${feature.label}: ${feature.summary}`;
    return { feature, availability, message };
  }
  return null;
}

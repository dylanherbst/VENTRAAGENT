// Home answers three questions at once (rework brief 02): What's ready? What needs me? What happened? It also writes the weekly brief.
// Pure: it only rewords the overview read model plus the Inbox counts. Every number comes from real records; an unknown number says so.
import { formatMoneyList, plural } from '../overview/format.ts';
import type { BusinessOverview } from '../overview/types.ts';
import { buildGuide, type BusinessPath, type Guide } from './path.ts';

export interface InboxCounts { waiting: number; sent: number; needYou: number }

export interface HomeInput {
  businessName: string;
  overview: BusinessOverview;
  inbox: InboxCounts;
  /** `/app/<business>` with no trailing slash. */
  base: string;
  /** True for a path that exists as a page. Anything else is shown as plain text, never a dead link. */
  canLink: (href: string) => boolean;
  /** Which entry path the business chose. Default 'existing' so older callers see the full workspace. */
  path?: BusinessPath;
}

export interface HomeItem { text: string; href: string | null }
export interface HomeNext { title: string; action: string; href: string | null }
export interface ChecklistStep { label: string; done: boolean; current: boolean; href: string | null }
export interface HomeView {
  headline: string;
  /** The whole path from idea to first order, in order, with the step to do now marked. */
  checklist: { steps: ChecklistStep[]; done: number; total: number };
  /** Two-path guidance: which pages are open and which step glows. */
  guide: Guide;
  next: HomeNext;
  ready: HomeItem[];
  needsMe: HomeItem[];
  happened: HomeItem[];
  weeklyBrief: { title: string; lines: string[] };
}

const MAX = 5;

export function buildHome(i: HomeInput): HomeView {
  const o = i.overview;
  const link = (href: string): string | null => (i.canLink(href) ? href : null);
  const inboxHref = link(`${i.base}/inbox`);

  const ready: HomeItem[] = o.launchProgress.steps.filter((s) => s.done).map((s) => ({ text: s.label, href: null }));
  if (o.summary.storeUrl) ready.push({ text: `Your shop is live at ${o.summary.storeUrl}`, href: null });
  else if (o.flags.storePublished) ready.push({ text: 'Your shop is live', href: null });

  const needsMe: HomeItem[] = o.needsYou.slice(0, MAX).map((n) => ({ text: `${n.title}. ${n.action}`, href: link(n.href) }));
  if (i.inbox.waiting > 0) needsMe.unshift({ text: `${plural(i.inbox.waiting, 'message')} waiting for your reply`, href: inboxHref });

  const happened: HomeItem[] = [];
  const s = o.summary;
  if (s.orders > 0) happened.push({ text: `${plural(s.orders, 'order')}, ${formatMoneyList(s.grossSales)} in sales`, href: link(`${i.base}/orders`) });
  if (s.delivery.delivered > 0) happened.push({ text: `${plural(s.delivery.delivered, 'download')} delivered`, href: null });
  if (i.inbox.sent > 0) happened.push({ text: `${plural(i.inbox.sent, 'reply', 'replies')} approved and sent`, href: inboxHref });
  for (const a of o.recentActivity.slice(0, 3)) happened.push({ text: `${a.title} (${a.label})`, href: null });

  const nextNeed = o.needsYou[0];
  const nextStep = o.launchProgress.nextStep;
  const next: HomeNext = i.inbox.waiting > 0
    ? { title: `${plural(i.inbox.waiting, 'message')} waiting`, action: 'Review replies', href: inboxHref }
    : nextNeed
      ? { title: nextNeed.title, action: nextNeed.action, href: link(nextNeed.href) }
      : nextStep
        ? { title: `Next: ${nextStep.label}`, action: nextStep.label, href: link(nextStep.href) }
        : { title: 'Your shop is running', action: 'Draft a launch campaign', href: link(`${i.base}/marketing`) };

  const sales = s.orders === 0 ? 'No orders yet.' : `${plural(s.orders, 'order')} and ${formatMoneyList(s.grossSales)} in sales.`;
  const visits = s.visits.known ? `${plural(s.visits.value, 'visit')} to your shop.` : 'Visits are not measured yet, so traffic is unknown (not zero).';
  const lines = [
    sales,
    s.delivery.delivered + s.delivery.pending + s.delivery.failed === 0 ? 'Nothing to deliver yet.' : `${s.delivery.delivered} delivered, ${s.delivery.pending} on the way, ${s.delivery.failed} failed.`,
    i.inbox.waiting === 0 ? 'No messages are waiting for a reply.' : `${plural(i.inbox.waiting, 'message')} waiting for a reply.`,
    visits,
    `One next step: ${next.action}.`,
  ];

  const headline = o.flags.storePublished
    ? `${i.businessName} is live.`
    : `${i.businessName}: ${o.launchProgress.done} of ${o.launchProgress.total} launch steps done.`;
  const checklist = {
    // An existing business did not choose an idea: the first step reads as adding the business.
    steps: o.launchProgress.steps.map((st) => ({ label: i.path === 'existing' && st.label === 'Choose your idea' ? 'Add your business' : st.label, done: st.done, current: st.id === o.launchProgress.nextStep?.id, href: link(st.href) })),
    done: o.launchProgress.done, total: o.launchProgress.total,
  };
  return { headline, checklist, guide: buildGuide(i.path ?? 'existing', checklist.steps, i.base), next, ready, needsMe, happened, weeklyBrief: { title: `Weekly brief: ${i.businessName}`, lines } };
}

/** The plain-text email for "Send my weekly brief". Only the brief lines; nothing private is added. */
export function weeklyBriefEmail(home: HomeView): { subject: string; text: string } {
  return { subject: home.weeklyBrief.title, text: `${home.weeklyBrief.title}\n\n${home.weeklyBrief.lines.map((l) => `- ${l}`).join('\n')}\n` };
}

import type { Contact } from './local-crm-contacts.ts';
import type { ContentPost } from './local-content-calendar.ts';
import type { ServiceInvoiceDraft } from './local-service-invoice-draft.ts';
import { isEnabled } from './notification-prefs.ts';
import type { NotificationPrefs } from './notification-prefs.ts';

// Pure, read-only notifications centre. Every item is derived from saved local data passed in.
// Nothing is invented, sent, pushed or emailed. An unreadable part produces one notice and is never treated as empty.

export const UNREADABLE = { unreadable: true } as const;
export type Part<T> = T | null | typeof UNREADABLE;
export const isUnreadable = (v: unknown): v is typeof UNREADABLE => typeof v === 'object' && v !== null && (v as { unreadable?: unknown }).unreadable === true;

export type NotificationInput = {
  todayIso: string; // YYYY-MM-DD, the owner's local date
  contacts: Part<readonly Contact[]>;
  posts: Part<readonly ContentPost[]>;
  invoice: Part<ServiceInvoiceDraft>;
  prefs?: NotificationPrefs | null; // the owner's choices; absent means every notice is on
};
export type NotificationKind = 'recent-contact' | 'post-overdue' | 'post-upcoming' | 'invoice-overdue' | 'unreadable';
export type Notification = { id: string; kind: NotificationKind; text: string; href: string; dateIso: string | null };

export const recentDays = 7;
export const upcomingDays = 7;

const dayNumber = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const validDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(dayNumber(v));

export function computeNotifications(input: NotificationInput): Notification[] {
  const out: Notification[] = [];
  const today = dayNumber(input.todayIso);
  const on = (k: Parameters<typeof isEnabled>[1]) => isEnabled(input.prefs, k);
  const unreadable = (id: string, name: string, href: string) => out.push({ id, kind: 'unreadable', text: `${name} could not be read, so it is not checked. Nothing was changed.`, href, dateIso: null });

  if (!on('invoice-overdue')) { /* switched off */ }
  else if (isUnreadable(input.invoice)) unreadable('invoice-unreadable', 'The saved invoice draft', '/sales');
  else if (input.invoice && validDay(input.invoice.dueDate) && dayNumber(input.invoice.dueDate) < today) {
    const days = today - dayNumber(input.invoice.dueDate);
    out.push({ id: 'invoice-overdue', kind: 'invoice-overdue', text: `Invoice draft ${input.invoice.draftReference} is ${days} day${days === 1 ? '' : 's'} past its due date. It is a draft; nothing has been sent.`, href: '/sales', dateIso: input.invoice.dueDate.slice(0, 10) });
  }

  if (!on('post-overdue') && !on('post-upcoming')) { /* switched off */ }
  else if (isUnreadable(input.posts)) unreadable('posts-unreadable', 'The saved content calendar', '/grow?tab=content');
  else if (input.posts) {
    for (const p of input.posts) {
      if (p.status === 'posted-manually' || !validDay(p.plannedDate)) continue;
      const diff = dayNumber(p.plannedDate) - today;
      if (diff < 0) { if (on('post-overdue')) out.push({ id: `post-overdue-${p.id}`, kind: 'post-overdue', text: `"${p.title}" was planned for ${p.plannedDate} and is not marked as posted.`, href: '/grow?tab=content', dateIso: p.plannedDate }); }
      else if (diff <= upcomingDays && on('post-upcoming')) out.push({ id: `post-upcoming-${p.id}`, kind: 'post-upcoming', text: diff === 0 ? `"${p.title}" is planned for today.` : `"${p.title}" is planned for ${p.plannedDate}.`, href: '/grow?tab=content', dateIso: p.plannedDate });
    }
  }

  if (!on('recent-contact')) { /* switched off */ }
  else if (isUnreadable(input.contacts)) unreadable('contacts-unreadable', 'The saved contacts', '/customers');
  else if (input.contacts) {
    for (const c of input.contacts) {
      if (!validDay(c.updatedAt)) continue;
      const age = today - dayNumber(c.updatedAt);
      if (age >= 0 && age < recentDays) out.push({ id: `recent-contact-${c.id}`, kind: 'recent-contact', text: `${c.name} was added or updated in your contacts${age === 0 ? ' today' : ` ${age} day${age === 1 ? '' : 's'} ago`}.`, href: '/customers', dateIso: c.updatedAt.slice(0, 10) });
    }
  }

  const rank: Record<NotificationKind, number> = { 'invoice-overdue': 0, 'post-overdue': 1, 'post-upcoming': 2, 'recent-contact': 3, unreadable: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.dateIso ?? '').localeCompare(b.dateIso ?? '') || a.id.localeCompare(b.id));
}

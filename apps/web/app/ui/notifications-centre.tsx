'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { computeNotifications, UNREADABLE } from '../../lib/notifications';
import type { Notification, NotificationInput, Part } from '../../lib/notifications';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import { contentCalendarStorageKey, restoreContentCalendar } from '../../lib/local-content-calendar';
import { restoreServiceInvoiceDraft, serviceInvoiceStorageKey } from '../../lib/local-service-invoice-draft';
import type { Profile } from '../../lib/onboarding';
import { notificationPrefsKey, restorePrefs } from '../../lib/notification-prefs';

function read<T>(load: () => T | null): Part<T> { try { return load(); } catch { return UNREADABLE; } }
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function readNotificationInput(profile: Profile): NotificationInput {
  const id = profile.id;
  return {
    todayIso: todayLocal(),
    contacts: read(() => restoreContacts(localStorage.getItem(contactStorageKey(id)), id)),
    posts: read(() => restoreContentCalendar(localStorage.getItem(contentCalendarStorageKey(id)), id)),
    invoice: read(() => restoreServiceInvoiceDraft(localStorage.getItem(serviceInvoiceStorageKey(id)), id)),
    // Unreadable choices fall back to showing everything; the editor tells the owner.
    prefs: (() => { try { return restorePrefs(localStorage.getItem(notificationPrefsKey)); } catch { return null; } })(),
  };
}

// In-app only. Items are computed from saved browser data each time; nothing is emailed, pushed or sent.
export default function NotificationsCentre({ profile }: { profile: Profile }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  useEffect(() => { setItems(computeNotifications(readNotificationInput(profile))); }, [profile]);
  if (!items) return <p role="status">Loading…</p>;
  return <section aria-label="Notifications" data-testid="notifications-centre">
    <h2>Notifications</h2>
    <p>Worked out from your saved data in this browser. Nothing is sent to you or anyone else. Choose which notices to show in <Link href="/settings?section=notifications">Settings</Link>.</p>
    {items.length === 0 ? <p role="status" data-testid="notifications-empty">Nothing needs your attention right now.</p> : <ul>{items.map(n => <li key={n.id} data-kind={n.kind}>{n.text} <Link href={n.href}>Open</Link></li>)}</ul>}
  </section>;
}

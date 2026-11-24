// Which in-app notices the owner wants to see. Stored as one small JSON object in browser storage and, optionally, as the account draft `notification-prefs`.
// Notices that a saved part could not be read ("unreadable") are never switchable off by a preference alone; they are hidden only when the notices that part feeds are all off.

export const notificationPrefsKey = 'ventra.notification-prefs.v1';
export const prefKinds = ['invoice-overdue', 'post-overdue', 'post-upcoming', 'recent-contact'] as const;
export type PrefKind = typeof prefKinds[number];
export type NotificationPrefs = { version: 1; enabled: Record<PrefKind, boolean>; updatedAt: string };
export const prefLabels: Record<PrefKind, string> = {
  'invoice-overdue': 'Invoice drafts past their due date',
  'post-overdue': 'Planned posts not marked as posted',
  'post-upcoming': 'Posts planned in the next 7 days',
  'recent-contact': 'Contacts added or updated in the last 7 days',
};

export const defaultPrefs = (updatedAt = new Date(0).toISOString()): NotificationPrefs => ({ version: 1, enabled: { 'invoice-overdue': true, 'post-overdue': true, 'post-upcoming': true, 'recent-contact': true }, updatedAt });

/** Strict: null means nothing saved (use defaults); anything unreadable or malformed throws and is never replaced by defaults silently. */
export function restorePrefs(raw: string | null): NotificationPrefs | null {
  if (raw === null) return null;
  if (raw.length > 2000) throw new Error('Saved notification settings are too large. Nothing was overwritten.');
  let p: unknown;
  try { p = JSON.parse(raw); } catch { throw new Error('Saved notification settings cannot be read. Nothing was overwritten.'); }
  const o = p as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.version !== 1 || typeof o.updatedAt !== 'string' || !Number.isFinite(Date.parse(o.updatedAt)) || !o.enabled || typeof o.enabled !== 'object' || Array.isArray(o.enabled)) throw new Error('Saved notification settings are not valid. Nothing was overwritten.');
  const e = o.enabled as Record<string, unknown>;
  const enabled = {} as Record<PrefKind, boolean>;
  for (const k of prefKinds) { if (typeof e[k] !== 'boolean') throw new Error('Saved notification settings are not valid. Nothing was overwritten.'); enabled[k] = e[k] as boolean; }
  return { version: 1, enabled, updatedAt: o.updatedAt };
}
export const serializePrefs = (p: NotificationPrefs): string => { const raw = JSON.stringify(p); restorePrefs(raw); return raw; };
/** For account sync: throws if the raw value is not a valid preferences object. */
export function checkPrefsRaw(raw: string): void { if (!restorePrefs(raw)) throw new Error('Notification settings are not valid. Your local copy is unchanged.'); }
export const isEnabled = (prefs: NotificationPrefs | null | undefined, kind: PrefKind) => !prefs || prefs.enabled[kind];

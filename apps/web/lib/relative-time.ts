// Plain relative times for recent things (presentation helper).
/** "12 min ago", "3 h ago", "Yesterday", then "9 Nov 2026". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Time not recorded';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Time not recorded';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  if (mins < 60 * 48) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

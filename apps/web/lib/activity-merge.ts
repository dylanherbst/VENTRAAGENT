// Pure merge for Home's recent activity: browser-saved items plus account items, newest first, at most `limit`.
export type ActivityItem = { key: string; title: string; when: string | null; href: string };
export type MergedActivity = { items: ActivityItem[]; failed: boolean };

/** `remote` is null when the account was not asked or the request failed (`failed` tells which). Items without a time go last. */
export function mergeActivity(local: ActivityItem[], remote: { items: ActivityItem[]; failed: boolean } | null, limit = 4): MergedActivity {
  const items = [...local, ...(remote?.items ?? [])].sort((a, b) => (a.when === null ? 1 : 0) - (b.when === null ? 1 : 0) || (b.when ?? '').localeCompare(a.when ?? ''));
  return { items: items.slice(0, limit), failed: !!remote?.failed };
}

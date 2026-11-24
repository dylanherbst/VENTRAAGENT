// The owner workspace navigation list as plain data (no React, no Next), so the node tests can check it. The bar itself is
// workspace-nav.tsx. Add a page here when its route exists; a page that is not built yet stays `ready: false` and is not a link.
export interface NavItem { label: string; segment: string; ready: boolean }

// Simplified (owner request, 20 Nov 2026): only the screens on the path from product to first sale. Everything else still exists and is
// reached from Settings (settingsLinks below).
export const workspaceNavItems: readonly NavItem[] = [
  { label: 'Home', segment: 'home', ready: true },
  { label: 'Offer', segment: 'offers', ready: true },
  { label: 'Products', segment: 'products', ready: true },
  { label: 'Website', segment: 'website', ready: true },
  { label: 'Payments', segment: 'payments', ready: true },
  { label: 'Marketing', segment: 'marketing', ready: true },
  { label: 'AI Team', segment: 'ai-team', ready: true },
  { label: 'Orders', segment: 'orders', ready: true },
];

/** Where a nav item goes for this business, or null while its page is not built (the bar then draws plain "Soon" text, never a link). */
export const workspaceNavHref = (business: string, item: NavItem): string | null =>
  !item.ready ? null : item.segment ? `/app/${business}/${item.segment}` : `/app/${business}`;

/** The first path segment after `/app/<business>`, which decides the highlighted item (so the editor keeps "Products" lit). */
export function currentSegment(pathname: string, business: string): string {
  const base = `/app/${business}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : '';
  return rest.split('/')[0] ?? '';
}

// Phone layout (rework brief 04): four bottom tabs, with Settings behind the profile icon. Labels come from lib/aimp/entry.ts so
// the website, setup and app say the same words. The desktop bar above is unchanged.
import { appTabs } from '../../../lib/aimp/entry.ts';

export type TabId = (typeof appTabs)[number]['id'] | 'settings';

/** Where each tab goes, and which first path segments keep it lit. */
export const tabRoutes: Record<TabId, { segment: string; segments: readonly string[] }> = {
  home: { segment: 'home', segments: ['', 'home', 'dashboard'] },
  shop: { segment: 'products', segments: ['offers', 'products', 'orders', 'website', 'brand', 'domains', 'payments'] },
  growth: { segment: 'marketing', segments: ['marketing', 'ai-team'] },
  settings: { segment: 'settings', segments: ['settings', 'integrations', 'approvals', 'operator', 'inbox', 'gaps', 'setter', 'results'] },
};

export const tabHref = (business: string, id: TabId): string => {
  const { segment } = tabRoutes[id];
  return segment ? `/app/${business}/${segment}` : `/app/${business}`;
};

/** The tab a page belongs to, from its first path segment; null for an unknown page. */
export function tabForSegment(segment: string): TabId | null {
  for (const id of Object.keys(tabRoutes) as TabId[]) if (tabRoutes[id].segments.includes(segment)) return id;
  return null;
}

/** Everything in the bar that is not one of the four tabs, shown on the Settings page so no screen becomes unreachable on a phone. */
export const settingsLinks: readonly { label: string; segment: string; detail: string }[] = [
  { label: 'Shop results', segment: 'results', detail: 'Visits, Buy presses and paid orders: where buyers drop off.' },
  { label: 'AI Setter', segment: 'setter', detail: 'Answers Instagram DMs and sends your links.' },
  { label: 'Inbox', segment: 'inbox', detail: 'Messages from customers.' },
  { label: 'Competitor gaps', segment: 'gaps', detail: 'What other tools miss.' },
  { label: 'Brand', segment: 'brand', detail: 'Your name, look and wording.' },
  { label: 'Domains', segment: 'domains', detail: 'Your shop address.' },
  { label: 'Payments', segment: 'payments', detail: 'Get paid by card.' },
  { label: 'Integrations', segment: 'integrations', detail: 'Connected accounts and tools.' },
  { label: 'Approvals', segment: 'approvals', detail: 'Things waiting for your yes.' },
  { label: 'Operator', segment: 'operator', detail: 'What your AI helpers did and may do.' },
  { label: 'Dashboard', segment: 'dashboard', detail: 'Sales and activity at a glance.' },
];

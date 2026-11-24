// What each side panel shows (plain data, no React). Every number and line is read from the overview view model for this business;
// nothing is made up. A page with nothing real to show yet says so in words instead of showing a zero.
import type { HomeView, InboxCounts } from '../../../../lib/aimp/home/build';
import type { OverviewViewModel } from '../view-model';

export type Tint = 'lavender' | 'peach' | 'mint' | 'blue';
export interface SidePanel {
  title: string;
  tint: Tint;
  metric: { label: string; value: string; note: string };
  feature: { title: string; text: string };
  rows: { label: string; done: boolean | null }[];
}

export function buildSidePanels(vm: OverviewViewModel, extra?: { home: HomeView; inbox: InboxCounts }): Record<string, SidePanel> {
  const step = (id: string) => vm.progress.steps.find((s) => s.id === id);
  const done = (id: string) => step(id)?.done ?? false;
  const tile = (id: string) => vm.tiles.find((t) => t.id === id);
  const storeLive = done('store');
  const frac = (ids: string[]) => `${ids.filter(done).length} / ${ids.length}`;
  const stepRows = (ids: string[]) => ids.map((id) => ({ label: step(id)?.label ?? id, done: done(id) }));
  const nextOpen = vm.progress.steps.find((s) => !s.done)?.label ?? 'Everything is done';
  const needs = vm.needsYou;
  const orders = tile('orders');
  const address = vm.storeLine.url ?? vm.storeLine.text;
  const pct = vm.progress.total ? `${Math.round((vm.progress.done / vm.progress.total) * 100)}%` : '0%';
  const activity = vm.activity.slice(0, 3).map((a) => ({ label: a.title, done: null as boolean | null }));
  const needsRows = needs.slice(0, 3).map((n) => ({ label: n.title, done: false as boolean | null }));

  return {
    '': { title: 'Overview', tint: 'lavender', metric: { label: 'Launch progress', value: pct, note: vm.progress.label }, feature: { title: 'Next step', text: nextOpen }, rows: vm.progress.steps.slice(0, 4).map((s) => ({ label: s.label, done: s.done })) },
    home: extra ? { title: 'Home', tint: 'blue', metric: { label: 'Needs you', value: String(extra.home.needsMe.length), note: extra.home.needsMe.length ? 'Open items' : 'Nothing waiting' }, feature: { title: 'Next', text: extra.home.next.title }, rows: (extra.home.needsMe.length ? extra.home.needsMe : extra.home.happened).slice(0, 3).map((x) => ({ label: x.text, done: null as boolean | null })) }
      : { title: 'Home', tint: 'blue', metric: { label: 'Needs you', value: String(needs.length), note: needs.length ? 'Open items' : 'Nothing waiting' }, feature: { title: 'Today', text: vm.brief[0]?.text ?? vm.stateLabel }, rows: needsRows.length ? needsRows : activity },
    offers: { title: 'Offer', tint: 'lavender', metric: { label: 'Offer', value: done('product') ? 'Approved' : 'Not yet', note: done('product') ? 'Your first product is ready' : 'Answer three questions to get offers' }, feature: { title: 'Next up', text: ['idea', 'product'].map(step).find((x) => x && !x.done)?.label ?? 'Review your offer' }, rows: stepRows(['idea', 'product']) },
    products: { title: 'Products', tint: 'lavender', metric: { label: 'Product & catalogue', value: frac(['product', 'catalogue']), note: done('product') ? 'Your product file exists' : 'Product still to make' }, feature: { title: 'Next up', text: ['product', 'catalogue'].map(step).find((s) => s && !s.done)?.label ?? 'Review your products' }, rows: stepRows(['idea', 'product', 'catalogue']) },
    brand: { title: 'Brand', tint: 'peach', metric: { label: 'Brand', value: done('brand') ? 'Saved' : 'Not yet', note: done('brand') ? 'Your name and look are saved' : 'Save your brand to continue' }, feature: { title: 'Business', text: vm.title }, rows: stepRows(['idea', 'brand']) },
    website: { title: 'Website', tint: 'mint', metric: { label: 'Shop', value: storeLive ? 'Live' : 'Not live', note: storeLive ? 'Published' : 'Not published yet' }, feature: { title: 'Store address', text: address }, rows: stepRows(['product', 'catalogue', 'store']) },
    domains: { title: 'Domains', tint: 'mint', metric: { label: 'Address', value: vm.storeLine.url ? 'Ready' : 'Not yet', note: vm.storeLine.url ? 'Public address set' : 'No public address yet' }, feature: { title: 'Store address', text: address }, rows: stepRows(['store']) },
    payments: { title: 'Payments', tint: 'peach', metric: { label: 'Card payments', value: done('payments') ? 'On' : 'Off', note: done('payments') ? 'Buyers can check out' : 'Checkout is unavailable' }, feature: { title: 'Gross sales', text: tile('gross')?.value ?? 'Not measured yet' }, rows: stepRows(['store', 'payments', 'first_order']) },
    marketing: { title: 'Marketing', tint: 'peach', metric: { label: 'First order', value: done('first_order') ? 'Got it' : 'Not yet', note: orders ? `${orders.value} paid orders` : 'No orders measured' }, feature: { title: 'Shop link', text: address }, rows: stepRows(['store', 'payments', 'first_order']) },
    orders: { title: 'Orders', tint: 'blue', metric: { label: 'Paid orders', value: orders?.value ?? 'Not measured', note: orders?.note ?? '' }, feature: { title: 'Gross sales', text: tile('gross')?.value ?? 'Not measured yet' }, rows: [tile('delivery'), tile('refunds')].filter(<T,>(t: T | undefined): t is T => Boolean(t)).map((t) => ({ label: `${t.label}: ${t.value}`, done: null })) },
    inbox: extra ? { title: 'Inbox', tint: 'blue', metric: { label: 'Waiting for you', value: String(extra.inbox.waiting), note: extra.inbox.needYou ? `${extra.inbox.needYou} need you` : `${extra.inbox.sent} replies sent` }, feature: { title: 'Latest', text: extra.home.needsMe[0]?.text ?? 'No messages waiting' }, rows: extra.home.needsMe.slice(0, 3).map((x) => ({ label: x.text, done: false as boolean | null })) }
      : { title: 'Inbox', tint: 'blue', metric: { label: 'Needs you', value: String(needs.length), note: needs.length ? 'Waiting for you' : 'Nothing waiting' }, feature: { title: 'Latest', text: activity[0]?.label ?? 'No messages or activity yet' }, rows: needsRows.length ? needsRows : activity },
    settings: { title: 'Settings', tint: 'lavender', metric: { label: 'Business', value: vm.stateLabel, note: storeLive ? 'Shop is published' : 'Setup in progress' }, feature: { title: 'Store address', text: address }, rows: stepRows(['brand', 'store', 'payments']) },
    integrations: { title: 'Integrations', tint: 'mint', metric: { label: 'Payments', value: done('payments') ? 'Connected' : 'Not connected', note: done('payments') ? 'Stripe is ready' : 'Connect Stripe to sell' }, feature: { title: 'Business', text: vm.title }, rows: stepRows(['payments']) },
    approvals: { title: 'Approvals', tint: 'peach', metric: { label: 'Waiting for you', value: String(needs.filter((n) => n.categoryLabel === 'Approval').length), note: 'Approval items' }, feature: { title: 'Top item', text: needs[0]?.title ?? 'Nothing waiting' }, rows: needsRows },
    operator: { title: 'Operator', tint: 'lavender', metric: { label: 'Recent activity', value: String(vm.activity.length), note: 'AI helper actions' }, feature: { title: 'Latest', text: activity[0]?.label ?? 'No activity yet' }, rows: activity },
    gaps: { title: 'Competitor gaps', tint: 'blue', metric: { label: 'Needs you', value: String(needs.length), note: 'Open items' }, feature: { title: 'Business', text: vm.title }, rows: needsRows },
    dashboard: { title: 'Dashboard', tint: 'mint', metric: { label: 'Gross sales', value: tile('gross')?.value ?? 'Not measured', note: tile('gross')?.note ?? '' }, feature: { title: 'Visits', text: tile('visits')?.value ?? 'Not measured yet' }, rows: [tile('orders'), tile('refunds')].filter(<T,>(t: T | undefined): t is T => Boolean(t)).map((t) => ({ label: `${t.label}: ${t.value}`, done: null })) },
  };
}

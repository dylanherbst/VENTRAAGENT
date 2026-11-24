// Owner workspace navigation bar (15 Nov request). The bar is a client component; its list and link rules are plain data in
// workspace-nav-items.ts, which the component renders, so these tests check what it draws.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { currentSegment, settingsLinks, tabForSegment, tabHref, tabRoutes, workspaceNavHref, workspaceNavItems } from '../app/app/[business]/workspace-nav-items.ts';
import { appTabs } from '../lib/aimp/entry.ts';

const item = (label: string) => {
  const i = workspaceNavItems.find((x) => x.label === label);
  assert.ok(i, `${label} is in the bar`);
  return i;
};

test('Home, Products and Orders are links with the right addresses for a business id', () => {
  assert.equal(workspaceNavHref('biz-a', item('Orders')), '/app/biz-a/orders');
  assert.equal(workspaceNavHref('biz-a', item('Home')), '/app/biz-a/home');
  assert.equal(workspaceNavHref('biz-a', item('Products')), '/app/biz-a/products');
  assert.equal(workspaceNavHref('other_1', item('Products')), '/app/other_1/products');
});

test('Website and Payments are links now that their pages exist (AMP-087, AMP-088)', () => {
  assert.equal(workspaceNavHref('biz-a', item('Website')), '/app/biz-a/website');
  assert.equal(workspaceNavHref('biz-a', item('Payments')), '/app/biz-a/payments');
});

test('screens cut from the bar (20 Nov 2026) are still real pages, reached from Settings', () => {
  for (const l of ['Dashboard', 'Brand', 'Domains', 'Approvals', 'Operator']) assert.ok(!workspaceNavItems.some((i) => i.label === l), `${l} is not in the bar`);
  for (const seg of ['dashboard', 'brand', 'domains', 'approvals', 'operator', 'inbox', 'gaps']) assert.ok(existsSync(new URL(`../app/app/[business]/${seg}/page.tsx`, import.meta.url)), seg);
  assert.equal(currentSegment('/app/biz-a/dashboard', 'biz-a'), 'dashboard');
});

test('a page that is not built is plain text, never a link', () => {
  assert.equal(workspaceNavHref('biz-a', { label: 'Later', segment: 'later', ready: false }), null);
});

test('every item is either a link or plain text, never both, and the order is stable', () => {
  assert.deepEqual(workspaceNavItems.map((i) => i.label), ['Home', 'Offer', 'Products', 'Website', 'Payments', 'Marketing', 'AI Team', 'Orders']);
  for (const i of workspaceNavItems) assert.equal(workspaceNavHref('b', i) === null, !i.ready, i.label);
  assert.equal(new Set(workspaceNavItems.map((i) => i.label)).size, workspaceNavItems.length);
});

test('the highlighted item follows the first path segment, so the product editor keeps Products lit', () => {
  assert.equal(currentSegment('/app/biz-a', 'biz-a'), '');
  assert.equal(currentSegment('/app/biz-a/products', 'biz-a'), 'products');
  assert.equal(currentSegment('/app/biz-a/products/prod-1', 'biz-a'), 'products');
  assert.equal(currentSegment('/app/biz-a/brand', 'biz-a'), 'brand');
  assert.equal(currentSegment('/elsewhere', 'biz-a'), '');
  assert.equal(workspaceNavItems.find((i) => i.segment === currentSegment('/app/biz-a/products/prod-1', 'biz-a'))?.label, 'Products');
});

test('phone layout: four bottom tabs in the brief\'s order, Settings behind the profile icon, each with the right address', () => {
  assert.deepEqual(appTabs.map((t) => t.label), ['Home', 'My Shop', 'Growth']);
  assert.equal(tabHref('biz-a', 'home'), '/app/biz-a/home');
  assert.equal(tabHref('biz-a', 'shop'), '/app/biz-a/products');
  assert.equal(tabHref('biz-a', 'growth'), '/app/biz-a/marketing');
  assert.equal(tabHref('biz-a', 'settings'), '/app/biz-a/settings');
  assert.ok(!appTabs.some((t) => (t.id as string) === 'settings'), 'Settings is not one of the four tabs');
});

test('every screen in the desktop bar belongs to a tab or to Settings, so none is unreachable on a phone', () => {
  for (const item of workspaceNavItems) {
    assert.ok(tabForSegment(item.segment) !== null, `${item.label} has a home on the phone`);
  }
  for (const l of settingsLinks) assert.ok(existsSync(new URL(`../app/app/[business]/${l.segment}/page.tsx`, import.meta.url)), `${l.label} is a real screen`);
});

test('a page keeps its own tab lit, and no page belongs to two tabs', () => {
  assert.equal(tabForSegment(currentSegment('/app/biz-a/orders/o-1', 'biz-a')), 'shop');
  assert.equal(tabForSegment(currentSegment('/app/biz-a/marketing/calendar', 'biz-a')), 'growth');
  assert.equal(tabForSegment(currentSegment('/app/biz-a', 'biz-a')), 'home');
  assert.equal(tabForSegment('no-such-page'), null);
  const all = Object.values(tabRoutes).flatMap((r) => r.segments);
  assert.equal(new Set(all).size, all.length);
});

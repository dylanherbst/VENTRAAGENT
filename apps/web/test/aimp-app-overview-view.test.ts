// AMP-081 rework (H01, screen 10): what the overview VIEW decides. `overview-view.tsx` and `page.tsx` cannot be loaded by the node test
// runner (JSX, extension-less imports, the glass library's CSS-backed components), so every decision the view makes lives in the view
// model and is tested here; the TSX is then checked as source text to prove it draws those decisions and nothing else. What this does
// not prove: the rendered HTML in a browser, focus order, or `availability()` itself (app/start/_server/runtime.ts is not loadable here).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildOverviewViewModel, COMING_SOON, FIX_NEXT_ISSUE, GUIDED_SETUP_EXPLANATION, GUIDED_SETUP_NOTE, headingOutline, NOTHING_NEEDS_YOU, OPEN_GUIDED_SETUP,
  overviewGate, PRIMARY_DESCRIPTION_ID,
} from '../app/app/[business]/view-model.ts';
import type { LinkVM, OverviewViewModel } from '../app/app/[business]/view-model.ts';
import { buildBusinessOverview, overviewStates } from '../lib/aimp/overview/index.ts';
import type { BusinessOverview, NeedsYouItem, OverviewState } from '../lib/aimp/overview/index.ts';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../lib/aimp/overview/demo.ts';

const src = (name: string) => readFileSync(new URL(`../app/app/[business]/${name}`, import.meta.url), 'utf8');
const VIEW = src('overview-view.tsx');
const PAGE = src('page.tsx');

const overviewOf = (state: OverviewState, businessId = 'biz-x'): BusinessOverview => buildBusinessOverview({ ...demoSnapshot(state), businessId }, DEMO_OVERVIEW_NOW);
const vmOf = (state: OverviewState, businessId = 'biz-x') => buildOverviewViewModel({ overview: overviewOf(state, businessId), businessName: 'Example' });
/** The same overview with a different needs-you list (the view model takes the list as given, in rank order). */
const withNeeds = (o: BusinessOverview, needsYou: NeedsYouItem[]) => buildOverviewViewModel({ overview: { ...o, needsYou, needsYouTotal: needsYou.length } });
const setupItem = (o: BusinessOverview, step: string, page: string): NeedsYouItem => ({
  ...o.needsYou[0], id: `setup:${step}`, category: 'setup', title: `Finish ${step}`, action: `Do ${step}`, href: `/app/${o.businessId}/${page}`,
  source: { kind: 'build_step', id: step },
} as NeedsYouItem);
const allLinks = (vm: OverviewViewModel): LinkVM[] => [
  ...(vm.primary.kind === 'fix' ? [vm.primary, ...(vm.primary.secondary ? [vm.primary.secondary] : [])] : []),
  ...vm.needsYou, ...vm.progress.steps, ...vm.brief, ...vm.banners.flatMap((b) => (b.link ? [b.link] : [])),
];

test('top item with no page: an aria-disabled control tied to an explanation that names the top item', () => {
  const vm = vmOf('degraded_checkout');
  const p = vm.primary;
  assert.equal(p.kind, 'fix');
  if (p.kind !== 'fix') return;
  assert.equal(p.title, vm.needsYou[0].title);
  assert.equal(p.destination, '/app/biz-x/payments');
  assert.equal(p.control, 'disabled');
  assert.equal(p.href, null);
  assert.equal(p.label, FIX_NEXT_ISSUE);
  assert.equal(p.describedBy, PRIMARY_DESCRIPTION_ID);
  assert.ok(p.explanation.includes(`"${p.title}"`), p.explanation);
  assert.ok(p.explanation.includes(COMING_SOON) && p.explanation.includes(p.action), p.explanation);
  // An urgent item is never swapped for something else; a later doable item may only appear as the secondary link.
  if (p.secondary) assert.notEqual(p.secondary.title, p.title);
});

test('the view draws that control as a focusable aria-disabled button with a description, never a native disabled button', () => {
  assert.match(VIEW, /<button type="button"[^>]*aria-disabled="true"[^>]*aria-describedby=\{p\.describedBy\}/);
  assert.match(VIEW, /id=\{p\.describedBy\}[^>]*>\{p\.explanation\}</);
  assert.match(VIEW, /p\.control === 'link' && p\.href/);
  assert.match(VIEW, /href=\{p\.href\} aria-describedby=\{p\.describedBy\}/);
  assert.doesNotMatch(VIEW, /\sdisabled(\s|>|=)/); // no native `disabled` attribute anywhere in the view
  assert.doesNotMatch(VIEW, /tabIndex=\{?-1/);
  assert.match(VIEW, /data-testid="primary-secondary"/);
});

test('top item with a built page: the button links to exactly that item, with no secondary link', () => {
  const o = overviewOf('new_setup');
  const top = setupItem(o, 'brand', 'brand');
  const vm = withNeeds(o, [top, setupItem(o, 'product', 'products')]);
  const p = vm.primary;
  assert.equal(p.kind, 'fix');
  if (p.kind !== 'fix') return;
  assert.equal(p.control, 'link');
  assert.equal(p.href, '/app/biz-x/brand');
  assert.equal(p.guided, false);
  assert.equal(p.label, FIX_NEXT_ISSUE);
  assert.equal(p.title, top.title);
  assert.equal(p.secondary, null);
  assert.equal(p.explanation, `Next step: ${top.action}.`);
});

test('top item with no page and a later doable item: the top item stays primary and the later one is only a labelled secondary link', () => {
  const o = overviewOf('new_setup');
  const payments = { ...setupItem(o, 'payments', 'payments'), title: 'Connect payments first' };
  // AMP-086: /orders is built now, so the stand-in for "a page that does not exist" is /website.
  const vm = withNeeds(o, [payments, setupItem(o, 'first_order', 'website'), setupItem(o, 'brand', 'brand'), setupItem(o, 'product', 'products')]);
  const p = vm.primary;
  assert.equal(p.kind, 'fix');
  if (p.kind !== 'fix') return;
  assert.equal(p.title, 'Connect payments first');
  assert.equal(p.control, 'disabled');
  assert.equal(p.href, null);
  // The first LATER item that has a page (first_order has none), not simply the second one.
  assert.equal(p.secondary?.href, '/app/biz-x/brand');
  assert.equal(p.secondary?.title, 'Finish brand');
  assert.match(p.secondary?.lead ?? '', /next thing you can do now/);
  // With nothing doable, there is no secondary link at all.
  const none = withNeeds(o, [payments, setupItem(o, 'first_order', 'website')]).primary;
  assert.equal(none.kind === 'fix' ? none.secondary : 'x', null);
});

test('a primary action that goes to /start is labelled as the guided setup, never as this business\'s "Fix next issue"', () => {
  const o = overviewOf('new_setup');
  // AMP-083: the product step now has its own /app page, so this uses the catalogue step, which is still a /start link.
  const p = withNeeds(o, [setupItem(o, 'catalogue', 'catalogue')]).primary;
  assert.equal(p.kind, 'fix');
  if (p.kind !== 'fix') return;
  assert.equal(p.href, '/start/catalogue');
  assert.equal(p.guided, true);
  assert.equal(p.label, OPEN_GUIDED_SETUP);
  assert.notEqual(p.label, FIX_NEXT_ISSUE);
  assert.ok(p.explanation.includes(GUIDED_SETUP_EXPLANATION));
  assert.match(GUIDED_SETUP_EXPLANATION, /guided setup/);
  assert.match(GUIDED_SETUP_EXPLANATION, /may not be this business/);
  assert.match(GUIDED_SETUP_NOTE, /guided setup/);
});

test('for two businesses, in every state, no link reaches /start without the guided-setup label, and /app links stay in their own business', () => {
  for (const b of ['biz-a', 'biz-b']) {
    const other = b === 'biz-a' ? 'biz-b' : 'biz-a';
    for (const s of overviewStates) {
      const o = overviewOf(s, b);
      // Each fixture as it is, and again with every setup step put first in turn, so every possible primary action is covered.
      const vms = [vmOf(s, b), ...['idea', 'brand', 'product', 'catalogue', 'store', 'payments'].map((step) => withNeeds(o, [setupItem(o, step, `${step}s`), ...o.needsYou]))];
      for (const vm of vms) {
        for (const l of allLinks(vm)) {
          if (l.href === null) continue;
          const toStart = l.href.startsWith('/start');
          assert.equal(l.guided, toStart, `${b} ${s}: ${l.href}`);
          if (!toStart) assert.ok(l.href === `/app/${b}` || l.href.startsWith(`/app/${b}/`), `${b} ${s}: ${l.href}`);
          assert.ok(!l.href.includes(other), `${b} ${s}: ${l.href}`);
        }
        const p = vm.primary;
        if (p.kind === 'fix' && p.href?.startsWith('/start')) {
          assert.equal(p.label, OPEN_GUIDED_SETUP, `${b} ${s}`);
          assert.ok(p.explanation.includes(GUIDED_SETUP_EXPLANATION), `${b} ${s}`);
        }
        if (p.kind === 'fix' && p.label === FIX_NEXT_ISSUE && p.href !== null) assert.ok(p.href === `/app/${b}` || p.href.startsWith(`/app/${b}/`), `${b} ${s}: ${p.href}`);
      }
    }
  }
});

test('the view shows the guided-setup note beside every guided link it draws', () => {
  assert.match(VIEW, /\{to\.guided \? <GuidedNote \/> : null\}/); // PageLink: needs-you, steps, banners, the secondary link
  assert.match(VIEW, /l\.guided \? <> <GuidedNote \/><\/> : null/); // the daily summary lines
  assert.match(VIEW, /\{GUIDED_SETUP_NOTE\}/);
  // Every <Link> in the overview is inside PageLink or the summary line; the primary button carries its label and explanation instead.
  assert.equal(VIEW.split('<Link ').length - 1, 2);
});

test('headings: one h1, then an h2 per section with h3 only inside a section, in every state', () => {
  for (const s of overviewStates) {
    const vm = vmOf(s);
    const h = headingOutline(vm);
    assert.equal(h[0].level, 1, s);
    assert.equal(h[0].text, 'Example', s);
    assert.equal(h.filter((x) => x.level === 1).length, 1, s);
    for (let n = 1; n < h.length; n++) assert.ok(h[n].level - h[n - 1].level <= 1, `${s}: ${h[n].text}`);
    assert.ok(h.every((x) => x.text.trim().length > 0), s);
    assert.deepEqual(h.filter((x) => x.level === 2).map((x) => x.text), [
      vm.primary.kind === 'fix' ? vm.primary.title : NOTHING_NEEDS_YOU, 'At a glance', vm.headings.needsYou, vm.progress.label, 'Summary', 'Recent activity',
    ], s);
    assert.deepEqual(h.filter((x) => x.level === 3).map((x) => x.text), [...vm.tiles.map((t) => t.label), ...vm.needsYou.map((i) => i.title)], s);
    assert.match(vm.headings.needsYou, vm.needsYou.length ? new RegExp(`^Needs you \\(${vm.needsYou.length + vm.needsYouHidden}\\)$`) : /^Needs you$/, s);
  }
  assert.equal(vmOf('zero_orders').headings.primary, NOTHING_NEEDS_YOU);
});

test('the view takes every section title from the view model and keeps the heading levels', () => {
  for (const k of ['primary', 'glance', 'needsYou', 'progress', 'brief', 'activity']) assert.ok(VIEW.includes(`{vm.headings.${k}}`), k);
  assert.match(VIEW, /<AppIntro[\s\S]*?title=\{vm\.title\}/);
  assert.match(VIEW, /<h2 id="ao-glance"[^>]*>\{vm\.headings\.glance\}<\/h2>/);
  assert.match(VIEW, /<h3 className="ao-needs-title">\{i\.title\}<\/h3>/);
  assert.match(VIEW, /heading="h3" title=\{t\.label\}/);
  assert.equal(VIEW.split('heading="h2"').length - 1, 5);
  assert.doesNotMatch(VIEW, /<h1|heading="h1"|<h4|heading="h4"/); // the one h1 is AppIntro's
});

test('AMP-136 approvals could not be read: the empty Needs-you card says so, never "Nothing needs you right now."', () => {
  const o = overviewOf('new_setup');
  const failed = buildOverviewViewModel({ overview: { ...o, needsYou: [], needsYouTotal: 0 }, approvalsFailed: true });
  assert.equal(failed.needsYou.length, 0);
  assert.ok(failed.banners.some((b) => b.id === 'approvals_not_read'));
  const fine = buildOverviewViewModel({ overview: { ...o, needsYou: [], needsYouTotal: 0 } });
  assert.ok(!fine.banners.some((b) => b.id === 'approvals_not_read'));
  // The view picks the plain "could not check" line from that banner, and keeps the calm line only for a real, successful read.
  const at = VIEW.indexOf("b.id === 'approvals_not_read'");
  assert.ok(at > 0);
  const card = VIEW.slice(VIEW.indexOf('data-testid="needs-you"'), VIEW.indexOf('data-testid="progress"'));
  assert.match(card, /We could not check your approvals, so we cannot say whether anything needs you/);
  assert.ok(card.indexOf("approvals_not_read") < card.indexOf('Nothing needs you right now.'));
});

test('demo storage off (production without the demo switch): the page stops at a plain notice before reading anything', () => {
  const reason = 'This step runs on demo storage, which is switched off on this site. Nothing was saved.';
  for (const valid of [true, false]) {
    const g = overviewGate({ available: false, reason }, valid);
    assert.deepEqual(g, { kind: 'off', title: 'This page is not switched on here', noticeTitle: 'Demo storage is off on this site', reason });
  }
  assert.deepEqual(overviewGate({ available: true, reason: '' }, true), { kind: 'ok' });
  assert.deepEqual(overviewGate({ available: true, reason: '' }, false), { kind: 'unknown' });
  // The page asks the gate first, with the real availability(), and returns for "off" before any read or fixture.
  const body = PAGE.slice(PAGE.indexOf('export default async function'));
  const gateAt = body.indexOf('overviewGate(availability(), checkBusiness(business))');
  const offAt = body.indexOf("gate.kind === 'off'");
  assert.ok(gateAt > 0 && offAt > gateAt);
  // AMP-093: the page reads through the one shared cache (`extras` is handed over as a function, so it is not called here).
  for (const read of ['loadCachedBusinessOverview(', 'sharedOverviewCache(', 'demoSnapshot(', 'runtime()', 'toolsEnabled()']) {
    assert.ok(body.indexOf(read) > offAt, read);
  }
  assert.match(body.slice(offAt, body.indexOf("gate.kind === 'unknown'")), /return \([\s\S]*gate\.title[\s\S]*gate\.noticeTitle[\s\S]*gate\.reason/);
});

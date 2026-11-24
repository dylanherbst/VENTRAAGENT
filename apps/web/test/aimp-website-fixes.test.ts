import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { site } from '../lib/aimp/site-config.ts';
import { BUILD_HREF, planButton, sitePages } from '../lib/aimp/plant/site-pages.ts';

const appDir = new URL('../app/plant-lab/', import.meta.url);
const source = (rel: string) => readFileSync(new URL(rel, appDir), 'utf8');

const planText = site.plans.flatMap((p) => [p.name, p.blurb, ...p.includes]);
const earnings = [/guarantee/i, /passive income/i, /effortless/i, /financial freedom/i, /6[\s-]?figure/i, /\bearn\b/i, /limited (time|spots)/i, /countdown/i];

test('landing page links to all four public pages and each link resolves to an existing route', () => {
  const landing = source('page.tsx');
  assert.match(landing, /import \{[^}]*sitePages[^}]*\} from '\.\.\/\.\.\/lib\/aimp\/plant\/site-pages'/);
  assert.match(landing, /<nav className="amp-footer-links" aria-label="Footer">/);
  assert.match(landing, /sitePages\.map\(\(p\) => <a key=\{p\.id\} href=\{p\.href\}>\{p\.label\}<\/a>\)/);
  const labels = sitePages.map((p) => p.label);
  assert.deepEqual(labels, ['How it works', 'Pricing', 'FAQ', 'Contact']);
  for (const p of sitePages) {
    assert.equal(p.href, `/plant-lab/${p.id}`);
    assert.ok(existsSync(new URL(`${p.id}/page.tsx`, appDir)), `${p.href} has no page`);
  }
  assert.match(source('plant.css'), /\.amp-footer-links a/);
});

test('plan buttons only promise the free preview, never a purchase or a selected plan', () => {
  for (const plan of site.plans) {
    const b = planButton(plan);
    assert.equal(b.href, `${BUILD_HREF}?plan=${plan.id}`);
    assert.match(b.label, /^Start the free preview/);
    assert.ok(!/choose|buy|subscribe|get started with|upgrade|pay/i.test(b.label), b.label);
    if (plan.priceAud > 0) assert.ok(b.label.endsWith(`review ${plan.name}`), b.label);
  }
  assert.equal(new Set(site.plans.map((p) => planButton(p).label)).size, site.plans.length);
  for (const rel of ['pricing/page.tsx', 'page.tsx']) {
    const src = source(rel);
    assert.match(src, /planButton\(plan\)\.href/, rel);
    assert.match(src, /planButton\(plan\)\.label/, rel);
    assert.ok(!/Choose \$\{plan\.name\}|Preview with \{plan\.name\}/.test(src), rel);
  }
});

test('pricing buttons keep their measurement event and the build flow still reads ?plan=', () => {
  assert.match(source('pricing/page.tsx'), /event=\{\{ cta: 'pricing_page', plan: plan\.id \}\}/);
  assert.match(source('page.tsx'), /event=\{\{ cta: 'pricing', plan: plan\.id \}\}/);
  assert.match(source('build/state.ts'), /get\('plan'\)/);
});

test('plan features that are not built carry the planned label in the visible text', () => {
  const find = (id: string) => site.plans.find((p) => p.id === id)!;
  const autopilot = find('autopilot');
  assert.ok(autopilot.includes.some((i) => /Pinterest/.test(i) && /\(planned\)/.test(i)));
  assert.ok(autopilot.includes.some((i) => /Daily/.test(i) && /\(planned\)/.test(i)));
  assert.match(autopilot.blurb, /planned/);
  assert.ok(find('scale').includes.some((i) => /Multiple businesses/.test(i) && /\(planned\)/.test(i)));
  assert.match(find('scale').blurb, /\(planned\)/);
  const launch = find('launch');
  assert.ok(launch.includes.some((i) => /Stripe/.test(i) && /test mode only/.test(i)));
  assert.ok(launch.includes.some((i) => /delivery/.test(i) && /in pilot/.test(i)));
  assert.match(launch.blurb, /test mode only/);
  assert.ok(!/coming\)/.test(planText.join('|')), 'use "planned", as the pages do');
});

test('prices are unchanged and no earnings or urgency wording appears in plan text', () => {
  assert.deepEqual(site.plans.map((p) => [p.id, p.priceAud]), [['discover', 0], ['launch', 79], ['autopilot', 149], ['scale', 249]]);
  for (const t of planText) for (const re of earnings) assert.ok(!re.test(t), `"${t}" matches ${re}`);
  assert.ok(!/\d\s*figure/i.test(planButton(site.plans[1]).label));
});

test('keyboard focus is visible on shell links, buttons and FAQ summaries and outlines are never removed', () => {
  const css = source('_site/pages.css');
  assert.match(css, /\.amp-pnav a:focus-visible/);
  assert.match(css, /\.amp-fnav a:focus-visible/);
  assert.match(css, /\.amp-btn:focus-visible/);
  assert.match(css, /\.amp-faq summary:focus-visible/);
  assert.match(css, /outline: 3px solid #5a3fbf/);
  assert.ok(!/outline:\s*(none|0)/.test(css));
});

test('header has a 320px rule that wraps instead of overflowing', () => {
  const css = source('_site/pages.css');
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /white-space: normal/);
});

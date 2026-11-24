import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { site } from '../lib/aimp/site-config.ts';
import { track as legacyTrack } from '../lib/aimp/analytics.ts';
import {
  HEADLINE_EXPERIMENT_ENABLED, HEADLINE_EXPERIMENT_ID, HEADLINE_VARIANT_TEXT, assignVariant, headlineFor, newVisitorKey,
} from '../lib/aimp/plant/experiment.ts';
import {
  clearRecorded, eventSpecs, fromLegacy, measureEvents, pageForPath, recorded, resetSink, setSink, track, validate,
  type MeasureRecord,
} from '../lib/aimp/plant/measure.ts';

const labDir = fileURLToPath(new URL('../app/plant-lab/', import.meta.url));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('the event list is closed and unknown events are refused', () => {
  assert.ok(measureEvents.length >= 10);
  for (const bad of ['click', 'hero_view', '__proto__', 'constructor', '', 'page_view ', 42, null, undefined]) {
    assert.equal(validate(bad).ok, false, String(bad));
  }
  clearRecorded();
  assert.equal(track('not_an_event' as never), false);
  assert.equal(recorded().length, 0);
});

test('unknown props and values outside the allow-list are refused, nothing is recorded', () => {
  clearRecorded();
  const refused: [string, unknown][] = [
    ['page_view', { page: 'checkout' }],
    ['page_view', { page: 'home', email: 'a@b.co' }],
    ['page_view', { page: 'home', __proto__x: 1 }],
    ['primary_cta_click', { placement: 'Free text with spaces' }],
    ['pricing_plan_click', { plan: 'enterprise' }],
    ['build_started', { model: 'user@example.com' }],
    ['build_started', { model: 'a'.repeat(60) }],
    ['faq_open', { index: -1 }],
    ['faq_open', { index: 1.5 }],
    ['faq_open', { index: '3' }],
    ['faq_open', { question: 'Will this make me money?' }],
    ['contact_click', { channel: 'phone' }],
    ['headline_variant_seen', { experiment: 'x', variant: 'C' }],
    ['page_view', null],
    ['page_view', []],
  ];
  for (const [e, p] of refused) assert.equal(validate(e, p).ok, false, `${e} ${JSON.stringify(p)}`);
  assert.equal(track('page_view', { page: 'checkout' }), false);
  assert.equal(recorded().length, 0);
});

test('valid events pass through the sink once, with only allowed props', () => {
  const seen: MeasureRecord[] = [];
  const prev = setSink((r) => { seen.push(r); });
  try {
    assert.equal(track('page_view', { page: 'pricing' }), true);
    assert.equal(track('pricing_plan_click', { plan: site.plans[0].id, from: 'home' }), true);
    assert.equal(track('faq_open', { index: 3 }), true);
    assert.equal(track('signup_handoff', { plan: site.plans[1].id }), true);
    assert.equal(track('contact_click', { channel: 'email' }), true);
  } finally { setSink(prev); }
  assert.equal(seen.length, 5);
  assert.deepEqual(seen[0], { event: 'page_view', props: { page: 'pricing' } });
  for (const [event, spec] of Object.entries(eventSpecs)) assert.ok(Object.keys(spec).length >= 1, event);
});

test('a throwing sink never breaks the page', () => {
  const prev = setSink(() => { throw new Error('provider down'); });
  try { assert.equal(track('page_view', { page: 'home' }), false); } finally { setSink(prev); }
  resetSink();
});

test('the default sink records in memory only: no fetch, no beacon, no XHR, no cookie', () => {
  const g = globalThis as Record<string, unknown>;
  const calls: string[] = [];
  const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket };
  g.fetch = () => { calls.push('fetch'); throw new Error('network'); };
  g.XMLHttpRequest = function () { calls.push('xhr'); };
  g.WebSocket = function () { calls.push('ws'); };
  const hadNav = 'navigator' in g;
  const savedNav = g.navigator;
  Object.defineProperty(g, 'navigator', { value: { sendBeacon: () => { calls.push('beacon'); return true; } }, configurable: true, writable: true });
  const doc = { get cookie() { calls.push('cookie-read'); return ''; }, set cookie(_v: string) { calls.push('cookie-write'); } };
  g.document = doc;
  resetSink();
  clearRecorded();
  try {
    assert.equal(track('page_view', { page: 'home' }), true);
    assert.equal(track('primary_cta_click', { placement: 'hero_primary', page: 'home' }), true);
  } finally {
    Object.assign(g, saved);
    delete g.document;
    if (hadNav) Object.defineProperty(g, 'navigator', { value: savedNav, configurable: true, writable: true });
    else delete g.navigator;
  }
  assert.deepEqual(calls, []);
  assert.equal(recorded().length, 2);
  clearRecorded();
});

test('legacy build-flow events map into the closed list and every mapped event validates', () => {
  const plan = site.plans[0].id;
  const cases: [string, Record<string, unknown>, string][] = [
    ['cta_click', { cta: 'hero_primary' }, 'primary_cta_click'],
    ['cta_click', { cta: 'header', page: 'faq' }, 'primary_cta_click'],
    ['cta_click', { cta: 'hero_secondary' }, 'secondary_cta_click'],
    ['cta_click', { cta: 'pricing', plan }, 'pricing_plan_click'],
    ['cta_click', { cta: 'pricing_page', plan }, 'pricing_plan_click'],
    ['model_select', { model: 'digital-products' }, 'model_selected'],
    ['preview_start', { model: 'digital-products', niche: 'planners' }, 'build_started'],
    ['preview_complete', { model: 'digital-products', niche: 'planners' }, 'build_preview_completed'],
    ['launch_view', {}, 'build_step_reached'],
    ['signup_click', { plan }, 'signup_handoff'],
  ];
  for (const [name, props, expected] of cases) {
    const out = fromLegacy(name, props, 'home');
    assert.ok(out.length >= 1, name);
    assert.equal(out[0][0], expected, name);
    for (const [e, p] of out) assert.equal(validate(e, p).ok, true, `${name} -> ${e} ${JSON.stringify(p)}`);
  }
  const exact = (name: string, props: Record<string, unknown>, page: 'home' | 'pricing' | null = 'home') => fromLegacy(name, props, page);
  assert.deepEqual(exact('cta_click', { cta: 'hero_primary', href: '/plant-lab/build?model=x&plan=y' }), [['primary_cta_click', { placement: 'hero_primary', page: 'home' }]]);
  assert.deepEqual(exact('cta_click', { cta: 'pricing_page', plan }, 'pricing'), [['pricing_plan_click', { plan, from: 'pricing_page' }]]);
  assert.deepEqual(exact('preview_start', { model: 'digital-products', niche: 'planners' }), [
    ['build_started', { model: 'digital-products', niche: 'planners' }], ['build_step_reached', { step: 'preview' }],
  ]);
  assert.deepEqual(exact('model_select', { model: 'digital-products', via: 'recommendation' }), [['model_selected', { model: 'digital-products', via: 'recommendation' }]]);
  assert.deepEqual(exact('launch_view', {}), [['build_step_reached', { step: 'launch' }]]);
  assert.deepEqual(exact('signup_click', { plan }), [['signup_handoff', { plan }]]);
  assert.deepEqual(fromLegacy('story_stage_view', { stage: 'seed' }), []);
  assert.deepEqual(fromLegacy('recommend_request', { budget: 'low', hours: '5', interest: 'x' }), []);
  assert.deepEqual(fromLegacy('preview_start', { source: 'watch_demo' }), []);
  assert.deepEqual(fromLegacy('cta_click', { cta: 'something-new' }), []);
});

test('analytics.track forwards into the measure sink, validated, with no href, query, budget, hours or interest', () => {
  const seen: MeasureRecord[] = [];
  const prev = setSink((r) => { seen.push(r); });
  try {
    legacyTrack('cta_click', { cta: 'hero_primary', href: '/plant-lab/build?model=digital-products&plan=launch' });
    legacyTrack('cta_click', { cta: 'model_card', model: 'digital-products', href: '/plant-lab/build?model=digital-products' });
    legacyTrack('recommend_request', { budget: 'under-500', hours: '5-10', interest: 'writing' });
    legacyTrack('model_select', { model: 'digital-products', via: 'recommendation' });
    legacyTrack('launch_view');
    legacyTrack('story_stage_view', { stage: 'tree' });
    legacyTrack('cta_click', { cta: 'unknown-thing', href: '/x?email=a@b.co' });
  } finally { setSink(prev); }
  assert.deepEqual(seen.map((r) => r.event), ['primary_cta_click', 'model_selected', 'model_selected', 'build_step_reached']);
  assert.deepEqual(seen[0].props, { placement: 'hero_primary' });
  assert.deepEqual(seen[3].props, { step: 'launch' });
  for (const r of seen) {
    assert.equal(validate(r.event, r.props).ok, true);
    const text = JSON.stringify(r);
    for (const leak of ['href', '?model', 'plan=', 'budget', 'hours', 'interest', 'under-500', 'writing', '@']) assert.ok(!text.includes(leak), `${leak} leaked in ${text}`);
  }
});

test('analytics.track never creates or touches globalThis.dataLayer and dispatches no aimp:track event', () => {
  const g = globalThis as Record<string, unknown>;
  assert.equal('dataLayer' in g, false);
  const touched: string[] = [];
  const events: string[] = [];
  g.window = {
    get dataLayer() { touched.push('get'); return undefined; },
    set dataLayer(_v: unknown) { touched.push('set'); },
    dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; },
    location: { pathname: '/plant-lab' },
    innerWidth: 1200,
  };
  const prev = setSink(() => {});
  try {
    legacyTrack('cta_click', { cta: 'header' });
    legacyTrack('preview_start', { model: 'digital-products', niche: 'planners' });
  } finally { setSink(prev); delete g.window; }
  assert.deepEqual(touched, []);
  assert.deepEqual(events, []);
  assert.equal('dataLayer' in g, false);
  const src = readFileSync(fileURLToPath(new URL('../lib/aimp/analytics.ts', import.meta.url)), 'utf8');
  assert.ok(!/dataLayer\s*\?\?=|dataLayer\)?\.push|dispatchEvent|aimp:track/.test(src));
});

test('assignVariant is stable for empty and odd keys', () => {
  for (const key of ['', ' ', '0', 'null', 'undefined', 'ünïcödé', '🌱🌱', 'a'.repeat(5000), '\u0000', '__proto__']) {
    const a = assignVariant(key);
    assert.ok(a === 'control' || a === 'variant', JSON.stringify(key));
    for (let i = 0; i < 3; i++) assert.equal(assignVariant(key), a);
  }
});

test('page ids come from the path', () => {
  assert.equal(pageForPath('/plant-lab'), 'home');
  assert.equal(pageForPath('/plant-lab/'), 'home');
  assert.equal(pageForPath('/plant-lab/build'), 'build');
  assert.equal(pageForPath('/plant-lab/how-it-works'), 'how-it-works');
  assert.equal(pageForPath('/plant-lab/unknown'), null);
  assert.equal(pageForPath('/start'), null);
});

test('variant assignment is deterministic and about 50/50 over 10,000 keys', () => {
  let variant = 0;
  for (let i = 0; i < 10000; i++) {
    const key = `visitor-${i}`;
    const a = assignVariant(key);
    assert.equal(assignVariant(key), a);
    if (a === 'variant') variant++;
  }
  assert.ok(variant > 4700 && variant < 5300, `variant share ${variant}/10000`);
  let rnd = 12345;
  const lcg = () => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd / 4294967296; };
  let v2 = 0;
  for (let i = 0; i < 10000; i++) if (assignVariant(newVisitorKey(lcg)) === 'variant') v2++;
  assert.ok(v2 > 4700 && v2 < 5300, `random-key variant share ${v2}/10000`);
  assert.notEqual(
    Array.from({ length: 200 }, (_, i) => assignVariant(`k${i}`, 'a')).join(),
    Array.from({ length: 200 }, (_, i) => assignVariant(`k${i}`, 'b')).join(),
    'different experiments should not share buckets',
  );
});

test('the visitor key is random and not personal data', () => {
  const k = newVisitorKey();
  assert.match(k, /^[a-z0-9]{16}$/);
  assert.notEqual(k, newVisitorKey());
});

test('the variant headline passes the claims rules and the control stays caller-supplied', () => {
  const banned = [/6[\s-]?figure/i, /six[\s-]?figure/i, /financial freedom/i, /guarantee/i, /passive income/i, /effortless/i, /limited (time|spots)/i, /\bnow\b/i, /today/i, /hurry/i, /last chance/i, /\d/, /[$£€]/, /\bearn/i, /\bmake money/i, /\bfast\b/i, /overnight/i];
  for (const re of banned) assert.ok(!re.test(HEADLINE_VARIANT_TEXT), `${re}`);
  assert.ok(HEADLINE_VARIANT_TEXT.length > 10 && HEADLINE_VARIANT_TEXT.length <= 80);
  assert.ok(!HEADLINE_VARIANT_TEXT.includes(site.name), 'no hard-coded brand');
  assert.equal(headlineFor('control', 'CONTROL'), 'CONTROL');
  assert.equal(headlineFor('variant', 'CONTROL'), HEADLINE_VARIANT_TEXT);
  assert.equal(HEADLINE_EXPERIMENT_ID, 'hero-headline-1');
});

test('the experiment is OFF by default and the page keeps the server render on the control', () => {
  assert.equal(HEADLINE_EXPERIMENT_ENABLED, false);
  const comp = readFileSync(join(labDir, 'hero-headline.tsx'), 'utf8');
  assert.match(comp, /useState<HeadlineVariant>\('control'\)/);
  assert.match(comp, /if \(!HEADLINE_EXPERIMENT_ENABLED\) return;/);
  assert.match(comp, /headline_variant_seen/);
  assert.ok(!/cookie/i.test(comp));
  const page = readFileSync(join(labDir, 'page.tsx'), 'utf8');
  assert.match(page, /<HeroHeadline control="/);
  assert.equal(page.match(/<h1/g), null, 'the h1 is rendered by HeroHeadline');
});

test('no third-party analytics host, script tag, cookie or network call under app/plant-lab', () => {
  const files = walk(labDir).filter((f) => /\.(tsx?|css)$/.test(f));
  assert.ok(files.length > 15);
  const hosts = /google-analytics|googletagmanager|gtag\(|\bgtm\.js|analytics\.google|segment\.(io|com)|mixpanel|amplitude|posthog|plausible|fathom|hotjar|clarity\.ms|fullstory|heap(analytics)?\.io|facebook\.net|connect\.facebook|fbq\(|ads-twitter|snap\.licdn|tiktok\.com\/i18n|sentry\.io|datadog|vercel-insights|_vercel\/insights|@vercel\/analytics|next\/script/i;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = f.slice(labDir.length);
    assert.ok(!hosts.test(src), `${rel} references a third-party analytics provider`);
    assert.ok(!/<script/i.test(src), `${rel} has a script tag`);
    assert.ok(!/\bfetch\(|sendBeacon|XMLHttpRequest|document\.cookie/.test(src), `${rel} makes a network call or sets a cookie`);
  }
  for (const rel of ['plant/measure.ts', 'plant/experiment.ts']) {
    const src = readFileSync(fileURLToPath(new URL(`../lib/aimp/${rel}`, import.meta.url)), 'utf8');
    assert.ok(!/\bfetch\(|sendBeacon|XMLHttpRequest|document\.cookie|<script|https?:\/\//.test(src), `${rel} must stay network-free`);
  }
});

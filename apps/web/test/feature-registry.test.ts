import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { features, isOpenable, statusLabel } from '../lib/feature-registry.ts';

const md = readFileSync(new URL('../../../docs/agents/FEATURES.md', import.meta.url), 'utf8');
const rows = new Map<string, string>();
for (const line of md.split('\n')) {
  const c = line.split('|').map(s => s.trim());
  if (c.length >= 8 && /^\d$/.test(c[1])) rows.set(c[3], c[4].toLowerCase());
}
const toStatus: Record<string, string> = { working: 'working', 'local draft': 'local-draft', blocked: 'blocked', 'not started': 'not-started' };

test('every registry entry names a real FEATURES.md row and has the same status (FEATURES.md wins)', () => {
  assert.ok(rows.size > 60);
  for (const x of features) {
    assert.ok(rows.has(x.row), `no FEATURES.md row: ${x.row}`);
    assert.equal(toStatus[rows.get(x.row)!], x.status, `${x.id} status differs from FEATURES.md`);
  }
});
test('ids are unique and every entry explains its availability', () => {
  assert.equal(new Set(features.map(x => x.id)).size, features.length);
  for (const x of features) assert.ok(x.availability.length > 8 && x.description && x.requires && x.permissions, x.id);
});
test('blocked and not-started entries are never openable and carry no route', () => {
  for (const x of features.filter(y => y.status === 'blocked' || y.status === 'not-started')) { assert.equal(x.route, null, x.id); assert.equal(isOpenable(x), false); }
  assert.equal(statusLabel('blocked'), 'Needs setup');
  assert.equal(statusLabel('not-started'), 'Coming soon');
});
test('customer routes never point at developer /tools pages', () => {
  assert.deepEqual(features.filter(x => x.route?.startsWith('/tools')).map(x => x.id), []);
});

test('customer-facing source never links to /tools (developer verification pages)', () => {
  const files = [
    'app/ui/ventra-pages.tsx', 'app/ui/ventra-home.tsx', 'app/ui/ventra-context.tsx', 'app/ui/ventra-hubs.tsx', 'app/ui/ventra-shell.tsx',
    'app/ui/ventra-services.tsx', 'app/ui/ventra-grow.tsx', 'app/ui/ventra-insights.tsx', 'app/ui/ventra-onboarding.tsx', 'app/ui/start-business.tsx',
    'app/ui/home-progress.tsx', 'app/ui/today-view.tsx', 'app/ui/draft-search.tsx', 'app/ui/notifications-centre.tsx', 'app/ui/business-overview.tsx',
    'app/ui/overview-dashboard.tsx', 'lib/draft-registry.ts', 'lib/today-view.ts', 'lib/ventra-navigation.ts', 'lib/notifications.ts',
  ];
  for (const f of files) {
    let src: string;
    try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { continue; }
    assert.doesNotMatch(src, /["'`]\/tools[/"'`?#]/, `${f} links to /tools`);
  }
});

test('every openable tile with an anchor lands on a section that exists in the page source', () => {
  const read = (f: string) => readFileSync(new URL('../app/ui/' + f, import.meta.url), 'utf8');
  const pages = [read('ventra-pages.tsx'), read('offer-extras.tsx'), read('ventra-insights.tsx')].join('\n');
  const launcher = read('business-launcher.tsx');
  for (const x of features.filter(y => isOpenable(y) && y.route!.includes('#'))) {
    const [path, hash] = [x.route!.split('#')[0].split('?')[0], x.route!.split('#')[1]];
    const src = path === '/create/start' ? launcher : pages;
    const found = new RegExp(`<Anchor id="${hash}"|<details id="${hash}"|<Section id="${hash}"`).test(src);
    assert.ok(found, `${x.id}: no anchor #${hash} for ${path}`);
  }
});

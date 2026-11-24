// G08 / AMP-044 acceptance: "Changing a software plan updates product entitlements independently of merchant sales and buyer orders."
// Behavioural: the real billing service runs a full lifecycle next to the real seller store and order store.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMemoryOrderStore } from '../lib/aimp/orders/store.ts';
import { FIXTURE_SELLERS, createInMemorySellerStore, platformSubscriptionTotal, sellerCharge, sellerRevenueTotals } from '../lib/aimp/sellers/index.ts';
import type { PlatformSubscriptionCharge } from '../lib/aimp/sellers/index.ts';
import { DAY_MS, createBillingService, createFixtureBillingProvider, createMemoryBillingStore } from '../lib/aimp/billing/index.ts';

const T0 = 1_800_000_000_000;
const WS = 'ws-a';

async function world() {
  const clock = { t: T0 };
  const sellers = createInMemorySellerStore();
  const orders = createMemoryOrderStore();
  const ready = FIXTURE_SELLERS.find((s) => s.key === 'ready')!.snapshot!;
  sellers.register({ workspaceId: WS, businessId: 'biz-1', stripeAccountId: ready.id, snapshot: ready, lastEventCreated: 100 });
  const { order } = await orders.createPending({
    id: 'ord-1', workspaceId: WS, businessId: 'biz-1', storeSlug: 'shop', listingId: 'lst-1', listingVersion: 1, productId: 'prod-1', productVersion: 1,
    title: 'Planner', amountMinor: 1500, currency: 'AUD', sellerAccountId: ready.id, buyerEmail: 'buyer@example.test', idempotencyKey: 'k-ord', createdAt: '2026-11-14T09:00:00Z',
  });
  await orders.attachSession(order.id, { id: 'cs_1', url: 'https://pay.example.test/s' });
  await orders.applyPaid({ eventId: 'evt_ord_1', sessionId: 'cs_1', amountMinor: 1500, currency: 'AUD', at: '2026-11-14T09:00:00Z' });
  const store = createMemoryBillingStore();
  const provider = createFixtureBillingProvider({ now: () => clock.t });
  const billing = createBillingService({ store, provider, now: () => clock.t });
  let n = 0;
  const ctx = () => ({ workspaceId: WS, actorUserId: 'u1', idempotencyKey: `k${++n}` });
  return { clock, sellers, orders, store, provider, billing, ctx };
}

// ---- import graph (AMP-166) ---------------------------------------------------------------------------------------------
// The old two "independence" tests ran a lifecycle next to a seller store and checked it was unchanged; billing never held a
// reference to that store, so they could not fail. These read the real source and walk it, so an import that couples billing to
// sellers or orders fails them.
const BILLING_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'aimp', 'billing');
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:([\w*{}\s,$]+?)\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

interface Edge { from: string; spec: string; names: string }
function walk(entries: string[]): { files: Set<string>; edges: Edge[] } {
  const files = new Set<string>();
  const edges: Edge[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = (m[2] ?? m[3]) as string;
      edges.push({ from: file, spec, names: (m[1] ?? '').trim() });
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        assert.ok(existsSync(target), `${file} imports ${spec}, which does not resolve to a file (the walker only follows explicit .ts paths)`);
        queue.push(target);
      }
    }
  }
  return { files, edges };
}
const rel = (f: string) => relative(join(BILLING_DIR, '..'), f).split(sep).join('/');

test('G08 independence: billing source reaches no seller or order module, except the one platform money type', () => {
  const entries = readdirSync(BILLING_DIR).filter((f) => f.endsWith('.ts')).map((f) => join(BILLING_DIR, f));
  assert.ok(entries.length >= 6, 'the billing files were found');
  const { files, edges } = walk(entries);
  const reached = [...files].map(rel).sort();
  assert.ok(reached.includes('billing/service.ts') && reached.includes('sellers/money.ts'), `the walker followed the real imports: ${reached.join(', ')}`);
  const coupled = reached.filter((f) => /^(sellers|orders)\//.test(f) && f !== 'sellers/money.ts');
  assert.deepEqual(coupled, [], 'billing (transitively) imports a seller or order module');
  // The allowed module must itself stay a leaf: it may not pull in anything that reaches sellers or orders.
  const moneyEdges = edges.filter((e) => rel(e.from) === 'sellers/money.ts');
  assert.deepEqual(moneyEdges.map((e) => e.spec), [], 'sellers/money.ts must import nothing');
  // No dynamic or bare-package route around it either.
  for (const e of edges) assert.ok(e.spec.startsWith('.') || e.spec.startsWith('node:'), `${rel(e.from)} imports the package "${e.spec}"`);
});

test('G08 independence: the only thing billing takes from sellers is the platform subscription charge', () => {
  const entries = readdirSync(BILLING_DIR).filter((f) => f.endsWith('.ts')).map((f) => join(BILLING_DIR, f));
  const { edges } = walk(entries);
  const fromSellers = edges.filter((e) => rel(resolve(dirname(e.from), e.spec) + '').startsWith('sellers/') && e.spec.startsWith('.'));
  assert.ok(fromSellers.length >= 2, 'billing does import the money type (so this check can see it)');
  for (const e of fromSellers) {
    assert.match(e.spec, /sellers\/money\.ts$/, `${rel(e.from)} imports ${e.spec}`);
    const names = e.names.replace(/[{}]/g, '').split(',').map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean);
    assert.ok(names.length > 0 && names.every((n) => ['platformSubscriptionCharge', 'PlatformSubscriptionCharge'].includes(n)), `${rel(e.from)} imports ${names.join(', ')}`);
  }
  // And billing owns its prices: it does not read the public site config.
  const { files } = walk(entries);
  assert.ok(![...files].some((f) => rel(f) === 'site-config.ts'), 'billing must not import the public pricing config');
});

test('G08: software billing money and seller revenue stay separate types and totals', async () => {
  const w = await world();
  await w.billing.startPlan(w.ctx(), { planId: 'autopilot' });
  const software = await w.store.listCharges(WS);
  assert.equal(software.length, 1);
  assert.equal(software[0].flow, 'platform_subscription');
  assert.equal(platformSubscriptionTotal(software), 14900);
  // Software charges are refused by the seller revenue total, and the other way round.
  assert.throws(() => sellerRevenueTotals(software as never));
  const sale = sellerCharge({ kind: 'direct', stripeAccountId: 'acct_demo_ready', businessId: 'biz-1', workspaceId: WS, amountMinor: 1500, applicationFeeMinor: 0, currency: 'AUD' });
  assert.throws(() => platformSubscriptionTotal([sale] as unknown as PlatformSubscriptionCharge[]));
  // A software charge cannot be filed under a different workspace.
  await assert.rejects(() => w.store.recordCharge('ws-other', 'x', software[0]));
});

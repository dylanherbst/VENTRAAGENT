// AMP-147: a labelled TEST purchase from the public store page of a store published by the /start runtime. Server-only; no screen code.
// It maps the public store address to the business that published it (from the runtime's own slug list, never from the browser) and
// runs the existing fixture purchase (`runTestPurchase`: real checkout + paid event + fulfilment, FIXTURE payment and email, no Stripe,
// no network). The order lands in the runtime's order store under that business, so only that business's Orders page shows it.
// Uses `.ts` import paths so node tests can load it.
import { TEST_PURCHASE_LABEL, testPurchaseState } from '../../../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../../../lib/aimp/storefront/schema.ts';
import type { Order } from '../../../lib/aimp/orders/index.ts';
import type { PublicResolution } from '../../../lib/aimp/site-versions/index.ts';
import { storedTestFlag } from '../../../lib/aimp/orders/types.ts';
import { SAMPLE_SELLER_PREFIX, runTestPurchase } from './orders-runtime.ts';
import type { SampleSource, StartOrders, TestPurchaseSummary } from './orders-runtime.ts';

/** The business that published this store address in the /start runtime, or null (unknown, or two businesses claim it). */
export function businessForStoreSlug(slugs: Map<string, string>, storeSlug: string): string | null {
  const hits = [...slugs].filter(([, slug]) => slug === storeSlug).map(([businessId]) => businessId);
  return hits.length === 1 ? hits[0] : null;
}

/** Older marker: true when the order was bought through the fixture seller account. Only the fallback of `orderIsTest` uses it. */
export const isTestOrder = (o: Pick<Order, 'sellerAccountId'>): boolean => typeof o.sellerAccountId === 'string' && o.sellerAccountId.startsWith(SAMPLE_SELLER_PREFIX);

/**
 * Is this stored order a test order? Reads the flag stored ON THE ORDER when it was created (AMP-162). Used by the Orders label and the cap.
 * RULE FOR A RECORD WITHOUT THE FLAG (a store or row from before the field existed): the flag is UNKNOWN, and the only other evidence is the
 * seller account, which is decisive in one direction only. A sample (fixture) seller id can never take real money, so it reads as a test
 * order; any other seller account reads as a REAL order. So a real paid order is never labelled test (its seller is a real connected
 * account) and a sample/test order is not shown as real. A stored `false` or `true` always wins over the seller id.
 */
export function orderIsTest(order: Pick<Order, 'test' | 'sellerAccountId'>): boolean {
  const stored = storedTestFlag(order);
  return stored !== null ? stored : isTestOrder(order);
}

export type StorefrontTestPurchase =
  | { ok: true; test: true; label: string; businessId: string; summary: TestPurchaseSummary }
  | { ok: false; message: string };

/**
 * Where the store being bought from must come from. `primary` is the registry that holds the built-in demo stores (it must NOT
 * hold the address); `sites` is the /start runtime's own site-version store (it must serve the address as live, published).
 */
export interface StoreOrigin {
  primary: { resolve(slug: string): Promise<{ status: string }> };
  sites: { resolvePublished(slug: string): Promise<PublicResolution> };
}

/**
 * `store` must be the PUBLISHED config the public page loaded (`loadPublishedStore`). Refuses real (non-demo) stores, stores
 * the /start runtime did not publish, addresses a built-in (fixture) store already holds, paused or unpublished stores, and
 * businesses whose seller account is not the sample account. The demo/published decision uses the runtime's own snapshot,
 * not the caller's object. Never throws.
 */
export async function runStorefrontTestPurchase(so: StartOrders, src: SampleSource, origin: StoreOrigin, store: StoreConfig, buyerEmail: unknown): Promise<StorefrontTestPurchase> {
  try {
    const slug = store?.slug;
    const businessId = typeof slug === 'string' ? businessForStoreSlug(src.slugs, slug) : null;
    if (businessId === null) return { ok: false, message: 'Unknown store.' };
    // One test purchase at a time per business, so the cap below cannot be passed by parallel requests.
    const turns = chains.get(so) ?? new Map<string, Promise<unknown>>();
    chains.set(so, turns);
    const run = (turns.get(businessId) ?? Promise.resolve()).then(async (): Promise<StorefrontTestPurchase> => {
      const no = await testPurchaseRefusal(so, src, origin, store);
      if (no) return { ok: false, message: no };
      const r = await runTestPurchase(so, src, businessId, buyerEmail);
      if (!r.ok) return r;
      return { ok: true, test: true, label: TEST_PURCHASE_LABEL, businessId, summary: r.summary };
    });
    const tail = run.catch(() => undefined);
    turns.set(businessId, tail);
    void tail.then(() => { if (turns.get(businessId) === tail) turns.delete(businessId); });
    return await run;
  } catch { return { ok: false, message: 'The test purchase could not be completed.' }; }
}

/** Most test orders (fixture-seller orders) one business can hold. A plain refusal after that. */
export const MAX_TEST_ORDERS_PER_BUSINESS = 20;
const chains = new WeakMap<StartOrders, Map<string, Promise<unknown>>>();

/**
 * The server-side answer to "can this store take a test purchase right now": null when yes, else the plain reason. Same rules
 * `runStorefrontTestPurchase` applies (it calls this), plus the per-business cap. The public page uses it to decide whether to show the
 * form; it reads only the runtime's own state and the loaded published config, never anything the browser sent. Never throws.
 */
export async function testPurchaseRefusal(so: StartOrders, src: SampleSource, origin: StoreOrigin, store: StoreConfig): Promise<string | null> {
  try {
    const slug = store?.slug;
    const businessId = typeof slug === 'string' ? businessForStoreSlug(src.slugs, slug) : null;
    if (businessId === null) return 'Unknown store.';
    // A built-in demo/fixture store (or anything else the primary registry knows, even paused) can never be bought from here.
    if ((await origin.primary.resolve(slug)).status !== 'none') return 'Test purchases are only for stores made in guided setup.';
    // The runtime itself must serve this address as live and published; that snapshot, not the caller's object, decides.
    const live = await origin.sites.resolvePublished(slug);
    if (live.status !== 'live' || live.config.slug !== slug || live.config.status !== 'published') return 'This store is not published.';
    const state = testPurchaseState(live.config, true);
    if (!state.canTest) return state.reason;
    const given = testPurchaseState(store, true);
    if (!given.canTest) return given.reason;
    if (store.status !== 'published') return 'This store is not published.';
    // A fixture purchase needs the sample seller account: refuse when the business already has any other (real) seller account.
    const seller = so.sellers.get(so.workspaceId, businessId);
    if (seller && !seller.stripeAccountId.startsWith(SAMPLE_SELLER_PREFIX)) return 'This business already has a seller account, so a test purchase is not allowed.';
    // Test orders are counted by the flag stored on the order when it was created (AMP-162), not by the seller id alone.
    const held = (await so.orders.list(so.workspaceId)).filter((o) => o.businessId === businessId && orderIsTest(o));
    // DECISION (AMP-162): at the cap the answer is the SAME for every email. It used to return the existing order for an email that
    // already had a test order, which told a visitor whether that address had made a test purchase here (an oracle on other people's
    // addresses). Now it never looks at the email, so the reply reveals nothing about which addresses exist. Cost: a repeat of an
    // existing email at the cap is refused instead of returning its old order (nothing is lost; the order is still in Orders).
    if (held.length >= MAX_TEST_ORDERS_PER_BUSINESS) return `This business already has ${MAX_TEST_ORDERS_PER_BUSINESS} test orders, which is the most allowed.`;
    return null;
  } catch { return 'The test purchase could not be completed.'; }
}

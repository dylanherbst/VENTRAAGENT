// Publish smoke test (AMP-035, D03). Pure and dependency-injected: no network, no server, no live provider.
// For the version that was just published it proves (a) the public pages load and (b) checkout can start for what is for sale.
// Everything is read through injected functions, so a check for business A can only ever see what A's deps return.
import { CatalogueError } from '../catalogue/types.ts';
import type { CatalogueService } from '../catalogue/service.ts';
import { checkoutGate } from '../sellers/gate.ts';
import type { SellerAccountStore } from '../sellers/store.ts';
import type { PaymentsAdapter, ProviderStatus } from '../providers/types.ts';
import type { StoreDirectory } from '../checkout/service.ts';
import { purchaseState, policyPages, checkoutBuilt, type PolicyPage } from '../storefront/load.ts';
import type { StoreConfig } from '../storefront/schema.ts';

export type PageRef =
  | { page: 'home' }
  | { page: 'product'; productSlug: string }
  | { page: 'policy'; policy: PolicyPage }
  | { page: 'contact' };
export type PageLoadResult = { ok: true } | { ok: false; reason: string };
export type CheckoutProbeResult = { ok: true } | { ok: false; reason: string };

/** What the live resolver says about a store address. Same shape as the site-versions public resolution. */
export type LiveResolution =
  | { status: 'live'; version: number; config: StoreConfig }
  | { status: 'paused' }
  | { status: 'none' };

export interface CheckoutProbeInput { workspaceId: string; businessId: string; storeSlug: string; productSlug: string }
export interface CheckoutProbe {
  canStart(input: CheckoutProbeInput): Promise<CheckoutProbeResult>;
  /**
   * Does this store address belong to this workspace and business (checkout's own store directory)? Run on every publish,
   * also when checkout is not built or the store is a demo, so the business is always checked (AMP-098). Optional: a probe
   * without it makes the check report "business" as skipped, never as passed.
   */
  checkStore?(input: { workspaceId: string; businessId: string; storeSlug: string }): Promise<CheckoutProbeResult>;
}

export interface PublishCheckDeps {
  /** The public resolver (site-versions `resolvePublished`). Takes no actor, so it can only see what the public sees. */
  resolveLive(storeSlug: string): Promise<LiveResolution>;
  /** Loads one public page the way the storefront does. Production: the storefront loader; tests: a fake. */
  loadPage(storeSlug: string, ref: PageRef): Promise<PageLoadResult>;
  checkout: CheckoutProbe;
  /** Whether the checkout route exists. Defaults to the storefront flag (`checkoutBuilt`). */
  checkoutAvailable?: boolean;
  /**
   * What a passing page check says it proved, after the page label (default "loads"). An in-process loader that only resolves
   * the published snapshot and its content, without a request to the public URL, sets an honest phrase here (AMP-146).
   */
  pageProof?: string;
}

export interface PublishCheckInput { workspaceId: string; businessId: string; storeSlug: string; versionId: number }
export interface CheckPass { check: string; detail: string }
export interface CheckFail { check: string; reason: string }
export type PublishCheckResult =
  | { ok: true; checks: CheckPass[]; skipped: CheckPass[] }
  | { ok: false; failed: CheckFail[]; checks: CheckPass[]; skipped: CheckPass[] };

const POLICIES = Object.keys(policyPages) as PolicyPage[];

export async function runPublishCheck(deps: PublishCheckDeps, input: PublishCheckInput): Promise<PublishCheckResult> {
  const checks: CheckPass[] = [];
  const skipped: CheckPass[] = [];
  const failed: CheckFail[] = [];
  const pass = (check: string, detail: string) => { checks.push({ check, detail }); };
  const fail = (check: string, reason: string) => { failed.push({ check, reason }); };
  const done = (): PublishCheckResult => (failed.length ? { ok: false, failed, checks, skipped } : { ok: true, checks, skipped });

  const { workspaceId, businessId, storeSlug, versionId } = input;
  if (!workspaceId || !businessId || typeof storeSlug !== 'string' || !storeSlug || !Number.isInteger(versionId)) {
    fail('input', 'The check was not given a store, business and version to look at.');
    return done();
  }

  // (a) the public resolver serves exactly the version we just published, for this store.
  let live: LiveResolution;
  try { live = await deps.resolveLive(storeSlug); } catch { live = { status: 'none' }; }
  if (live.status === 'paused') { fail('live-version', 'The store is paused, so visitors cannot see it.'); return done(); }
  if (live.status !== 'live') { fail('live-version', 'The store is not live: visitors would see nothing at this address.'); return done(); }
  if (live.config.slug !== storeSlug) { fail('live-version', 'The live store does not match this address.'); return done(); }
  if (live.version !== versionId) { fail('live-version', `Version ${live.version} is live instead of version ${versionId}.`); return done(); }
  pass('live-version', `Version ${versionId} is live.`);
  const config = live.config;

  const refs: { id: string; label: string; ref: PageRef }[] = [
    { id: 'page:home', label: 'the home page', ref: { page: 'home' } },
    ...config.products.map((p) => ({ id: `page:product:${p.slug}`, label: `the "${p.title}" product page`, ref: { page: 'product', productSlug: p.slug } as PageRef })),
    ...POLICIES.map((p) => ({ id: `page:policy:${p}`, label: `the ${policyPages[p].toLowerCase()} page`, ref: { page: 'policy', policy: p } as PageRef })),
    { id: 'page:contact', label: 'the contact page', ref: { page: 'contact' } },
  ];
  for (const r of refs) {
    let res: PageLoadResult;
    try { res = await deps.loadPage(storeSlug, r.ref); } catch { res = { ok: false, reason: 'it could not be loaded' }; }
    if (res.ok) pass(r.id, `${r.label} ${deps.pageProof ?? 'loads'}.`);
    else fail(r.id, `${capital(r.label)} did not load: ${res.reason}`);
  }

  // (b) checkout, for every product the storefront would show a buy button for. Same rule as the buy button.
  const state = purchaseState(config, deps.checkoutAvailable ?? checkoutBuilt);
  if (!state.canBuy) {
    skipped.push({ check: 'checkout', detail: `Checkout was not tested: ${state.reason}` });
  } else if (config.products.length === 0) {
    skipped.push({ check: 'checkout', detail: 'Checkout was not tested: the store has no products for sale.' });
  } else if (!deps.checkout || typeof deps.checkout.canStart !== 'function') {
    // Checkout is meant to be tested but nothing can test it: that is a failure, never a pass.
    fail('checkout', 'Checkout could not be tested because no checkout test is connected.');
  } else {
    for (const p of config.products) {
      let res: CheckoutProbeResult;
      try { res = await deps.checkout.canStart({ workspaceId, businessId, storeSlug, productSlug: p.slug }); } catch { res = { ok: false, reason: 'the check could not run' }; }
      if (res.ok) pass(`checkout:${p.slug}`, `Checkout can start for "${p.title}".`);
      else fail(`checkout:${p.slug}`, `Checkout cannot start for "${p.title}": ${res.reason}`);
    }
  }

  // The business is checked on every publish, whether or not checkout was tested (AMP-098).
  if (typeof deps.checkout?.checkStore === 'function') {
    let res: CheckoutProbeResult;
    try { res = await deps.checkout.checkStore({ workspaceId, businessId, storeSlug }); } catch { res = { ok: false, reason: 'the check could not run' }; }
    if (res.ok) pass('business', 'This store address belongs to your business.');
    else fail('business', `The store address could not be matched to your business: ${res.reason}`);
  } else {
    skipped.push({ check: 'business', detail: 'The business was not checked: no store directory is connected to the check.' });
  }
  return done();
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain-English sentence for the owner, built from the failures. */
export function describeFailures(failed: CheckFail[]): string {
  return failed.map((f) => f.reason).join(' ');
}

/** Page loader built from the storefront loader: the page must come from the PUBLISHED snapshot and have what it needs to render. */
export function createPageLoader(loadStore: (storeSlug: string) => Promise<StoreConfig | null>): PublishCheckDeps['loadPage'] {
  return async (storeSlug, ref) => {
    const store = await loadStore(storeSlug);
    if (!store) return { ok: false, reason: 'the published store could not be loaded.' };
    if (store.slug !== storeSlug) return { ok: false, reason: 'the store at this address does not match.' };
    switch (ref.page) {
      case 'home': return store.hero.heading.trim() && store.brand.name.trim() ? { ok: true } : { ok: false, reason: 'it has no heading.' };
      case 'product': return store.products.some((p) => p.slug === ref.productSlug) ? { ok: true } : { ok: false, reason: 'the product is missing from the store.' };
      case 'policy': return store.policies[ref.policy]?.length ? { ok: true } : { ok: false, reason: 'the policy text is empty.' };
      case 'contact': return store.contact.email.trim() ? { ok: true } : { ok: false, reason: 'there is no contact email.' };
    }
  };
}

export interface CheckoutProbeDeps {
  stores: StoreDirectory;
  catalogue: Pick<CatalogueService, 'getApprovedListing' | 'getCheckoutPrice'>;
  sellers: SellerAccountStore;
  payments: () => { status: Pick<ProviderStatus, 'status' | 'label'>; adapter: PaymentsAdapter | null };
  /** Which approved listing a storefront product sells. Return null when there is none. Must read only this business. */
  listingIdFor(ids: { workspaceId: string; businessId: string }, productSlug: string): Promise<string | null>;
}

/**
 * The checkout service's preconditions, without its side effects: same store directory, approved listing, stored price,
 * sellers gate and provider adapter checks, in the same order. It never creates an order or a payment session and never
 * calls the provider, so it is safe against a live provider too. (startCheckout itself writes a pending order.)
 */
export function createCheckoutProbe(deps: CheckoutProbeDeps): CheckoutProbe {
  const checkStore: NonNullable<CheckoutProbe['checkStore']> = async ({ workspaceId, businessId, storeSlug }) => {
    const store = await deps.stores.resolve(storeSlug);
    if (!store) return { ok: false, reason: 'the store address is not known to checkout.' };
    if (store.workspaceId !== workspaceId || store.businessId !== businessId) return { ok: false, reason: 'the store address belongs to a different business.' };
    return { ok: true };
  };
  return {
    checkStore,
    async canStart({ workspaceId, businessId, storeSlug, productSlug }) {
      const own = await checkStore({ workspaceId, businessId, storeSlug });
      if (!own.ok) return own;
      const ctx = { workspaceId, businessId, actorUserId: 'publish-check', idempotencyKey: 'publish-check' };
      const listingId = await deps.listingIdFor({ workspaceId, businessId }, productSlug);
      if (!listingId) return { ok: false, reason: 'the product has no approved listing.' };
      const listing = await deps.catalogue.getApprovedListing(ctx, listingId);
      if (!listing || listing.workspaceId !== workspaceId || listing.businessId !== businessId) return { ok: false, reason: 'the product is not approved for sale.' };
      try {
        const price = await deps.catalogue.getCheckoutPrice(ctx, listingId);
        if (!Number.isInteger(price.priceMinor) || price.priceMinor <= 0) return { ok: false, reason: 'the product has no valid price.' };
      } catch (e) {
        if (e instanceof CatalogueError) return { ok: false, reason: 'the product has no readable price.' };
        throw e;
      }
      const pay = deps.payments();
      const gate = checkoutGate({ workspaceId, businessId, accounts: deps.sellers, payments: pay.status });
      if (!gate.enabled) return { ok: false, reason: gate.reason };
      if (!pay.adapter || !deps.sellers.get(workspaceId, businessId)) return { ok: false, reason: 'payments are not available right now.' };
      return { ok: true };
    },
  };
}

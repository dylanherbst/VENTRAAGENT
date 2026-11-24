// AMP-150: the public-store Test purchase, as plain functions with their dependencies passed in, so the node tests can run the same
// code the server action and the page run (actions.ts and wiring.ts import Next-only modules). It decides nothing from the browser:
// the browser sends a store address and an email; the store is loaded here from the published registry, and which business it
// belongs to comes from the /start runtime's own slug list inside `runStorefrontTestPurchase`. FIXTURE payment and email only.
import { runStorefrontTestPurchase, testPurchaseRefusal } from '../../../start/_server/checkout-runtime.ts';
import type { StoreOrigin } from '../../../start/_server/checkout-runtime.ts';
import type { SampleSource, StartOrders } from '../../../start/_server/orders-runtime.ts';
import { TEST_PURCHASE_LABEL } from '../../../../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../../../../lib/aimp/storefront/schema.ts';

export type TestPurchaseReply =
  | { ok: true; label: string; orderId: string }
  | { ok: false; message: string };

export interface TestPurchaseWorld { so: StartOrders; src: SampleSource; origin: StoreOrigin }
export interface TestPurchaseDeps {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: () => { available: boolean; reason: string };
  /** The published store for this address (`loadPublishedStore`), or null. */
  load: (slug: string) => Promise<StoreConfig | null>;
  /** The /start runtime pieces, or null when none exists yet. Read only after demo storage has passed. */
  world: () => Promise<TestPurchaseWorld | null>;
}

const SLUG = /^[A-Za-z0-9._:-]{1,120}$/;
export const NOT_FOUND = 'We could not find that store.';
const NOT_ALLOWED = 'Test purchases are not available for this store.';

/** For the page: the label to show when a test purchase is allowed for this published store right now, else null (no form). */
export async function offerTestPurchase(d: TestPurchaseDeps, store: StoreConfig): Promise<{ label: string } | null> {
  try {
    if (!store.demo || !d.availability().available) return null;
    const w = await d.world();
    if (!w) return null;
    return (await testPurchaseRefusal(w.so, w.src, w.origin, store)) === null ? { label: TEST_PURCHASE_LABEL } : null;
  } catch { return null; }
}

/** For the server action. Never throws. */
export async function submitTestPurchase(d: TestPurchaseDeps, storeAddress: unknown, email: unknown): Promise<TestPurchaseReply> {
  try {
    const a = d.availability();
    if (!a.available) return { ok: false, message: a.reason };
    if (typeof storeAddress !== 'string' || !SLUG.test(storeAddress)) return { ok: false, message: NOT_FOUND };
    const store = await d.load(storeAddress);
    if (!store) return { ok: false, message: NOT_FOUND };
    const w = await d.world();
    if (!w) return { ok: false, message: NOT_ALLOWED };
    const r = await runStorefrontTestPurchase(w.so, w.src, w.origin, store, email);
    return r.ok ? { ok: true, label: r.label, orderId: r.summary.orderId } : { ok: false, message: r.message };
  } catch { return { ok: false, message: 'The test purchase could not be completed.' }; }
}

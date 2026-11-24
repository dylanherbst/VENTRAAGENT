'use server';
import { notFound, redirect } from 'next/navigation';
import { blueprintRegistry } from '../../../lib/aimp/blueprints/index.ts';
import { DEMO_BUSINESS, demoCtx, seedApprovedBrand, seedApprovedProduct } from '../../../lib/aimp/catalogue/demo.ts';
import { CatalogueError, formatAud } from '../../../lib/aimp/catalogue/index.ts';
import type { ListingEdits } from '../../../lib/aimp/catalogue/index.ts';
import { toolsEnabled } from '../../../lib/aimp/files/demo.ts';
import { MAX_DEMO_PRODUCTS, pageState } from './state.ts';

const back = (msg?: string): never => redirect(msg ? `/tools/catalogue?msg=${encodeURIComponent(msg)}` : '/tools/catalogue');
const field = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? String(f.get(k)) : '');
const errText = (e: unknown): string => {
  if (e instanceof CatalogueError) return e.issues.length ? `Refused (${e.code}): ${e.issues.map((i) => i.message).join(' ')}` : `Refused (${e.code}): ${e.message}`;
  return e instanceof Error ? e.message : 'Something went wrong.';
};
/** Every action runs this first: 404 in production unless AIMP_TOOLS_ENABLED=1. */
const guard = () => { if (!toolsEnabled()) notFound(); return pageState(); };

export async function startListing(f: FormData): Promise<void> {
  const s = guard();
  let msg = '';
  try {
    if (s.seeded.length >= MAX_DEMO_PRODUCTS) throw new Error(`The demo is limited to ${MAX_DEMO_PRODUCTS} products. Restart the server to reset it.`);
    const id = field(f, 'blueprint') || 'printable-planner';
    if (!blueprintRegistry.find(id)) throw new Error('That blueprint does not exist.');
    const seeded = await seedApprovedProduct(s.d, demoCtx, DEMO_BUSINESS, id);
    if (!s.brandDone) { await seedApprovedBrand(s.d, demoCtx, DEMO_BUSINESS, seeded.title); s.brandDone = true; }
    const comparables = field(f, 'comparables').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
    await s.d.catalogue.createDraft(demoCtx, { businessId: DEMO_BUSINESS, productId: seeded.productId, comparablePricesMinor: comparables });
    s.seeded.push(seeded); // only once the draft exists, so the page never lists a product without a listing
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function saveEdits(f: FormData): Promise<void> {
  const s = guard();
  let msg: string;
  try {
    const edits: ListingEdits = {
      title: field(f, 'title'), shortDescription: field(f, 'shortDescription'), longDescription: field(f, 'longDescription'),
      priceMinor: Number(field(f, 'priceMinor')),
    };
    const cover = field(f, 'coverAssetId');
    if (cover) edits.coverAssetId = cover === 'none' ? null : cover;
    const saved = await s.d.catalogue.editListing(demoCtx, field(f, 'listingId'), edits, { expectedVersion: Number(field(f, 'version')) });
    msg = `Saved as ${saved.status} version ${saved.version}.`;
  } catch (e) { msg = errText(e); }
  back(msg);
}

export async function approve(f: FormData): Promise<void> {
  const s = guard();
  let msg: string;
  try {
    const a = await s.d.catalogue.approveListing(demoCtx, field(f, 'listingId'), { expectedVersion: Number(field(f, 'version')) });
    msg = `Version ${a.version} approved. Checkout now charges ${formatAud(a.priceMinor)}.`;
  } catch (e) { msg = errText(e); }
  back(msg);
}

/** Simulates checkout: any price the "browser" sends is ignored; the stored approved price is used. */
export async function simulateCheckout(f: FormData): Promise<void> {
  const s = guard();
  try {
    const price = await s.d.catalogue.getCheckoutPrice(demoCtx, field(f, 'listingId'));
    const sent = field(f, 'clientPriceMinor');
    s.lastCheckout = `Checkout would charge ${formatAud(price.priceMinor)} (listing version ${price.listingVersion})${sent ? `; the browser sent ${sent} cents and it was ignored` : ''}.`;
  } catch (e) { s.lastCheckout = errText(e); }
  back();
}

/** Proves the tenant wall: another workspace asks for this workspace's listing and price. */
export async function tryOtherTenant(f: FormData): Promise<void> {
  const s = guard();
  const other = { workspaceId: 'other-workspace', actorUserId: 'other-merchant', idempotencyKey: 'other' };
  let msg: string;
  try {
    const seen = await s.d.catalogue.getListing(other, field(f, 'listingId'));
    await s.d.catalogue.getCheckoutPrice(other, field(f, 'listingId'));
    msg = seen ? 'Unexpected: the other workspace saw the listing.' : 'Unexpected: the other workspace got a price.';
  } catch (e) { msg = `Other workspace: ${errText(e)}`; }
  back(msg);
}

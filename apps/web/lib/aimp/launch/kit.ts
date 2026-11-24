// Launch kit check (rework brief 03-04: "the launch kit uses the correct product and live shop link"). The kit is the saved
// campaign plan plus its creative assets and export; this re-derives what every item SHOULD say and link to, from the live
// brand, listings and store, and reports each difference in plain English. Pure: it reads, never writes or publishes.
import { lookupListing, productUrlFor, storeIssues, storeOwnershipIssues } from '../campaigns/links.ts';
import type { CampaignContext, LaunchCampaignPlan } from '../campaigns/types.ts';

export interface KitCheck { ok: boolean; problems: string[]; items: number; products: string[] }

export function checkLaunchKit(plan: LaunchCampaignPlan, ctx: CampaignContext): KitCheck {
  const problems: string[] = [];
  for (const i of [...storeIssues(ctx.store), ...storeOwnershipIssues(ctx)]) problems.push(i.message);
  if (plan.store.slug !== ctx.store.slug) problems.push('The kit points at a different shop than the one you published.');
  if (plan.items.length === 0) problems.push('The kit has no posts in it.');
  const products = new Set<string>();
  for (const item of plan.items) {
    const found = lookupListing(ctx, item.listingId);
    if (!found.ok) { problems.push(`Post ${item.id}: ${found.message}`); continue; }
    products.add(found.listing.title);
    if (item.productTitle !== found.listing.title) problems.push(`Post ${item.id} names "${item.productTitle}", but your listing is "${found.listing.title}".`);
    if (item.targetUrl !== productUrlFor(ctx.store, found.listing)) problems.push(`Post ${item.id} links to ${item.targetUrl}, not to your live product page.`);
    if (item.priceMinor !== found.listing.priceMinor) problems.push(`Post ${item.id} shows an old price.`);
  }
  return { ok: problems.length === 0, problems, items: plan.items.length, products: [...products] };
}

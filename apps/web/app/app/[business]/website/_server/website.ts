// Server read for Website Studio (screen 16, AMP-087). A plain function that takes the /start runtime as an argument, so it runs in
// the node tests without Next. Everything comes from the AMP-031 site-version store (lib/aimp/site-versions): the draft, the version
// history and what the public would be served. The store's address for a business is looked up on the server (`rt.slugs`), never
// taken from the request, so one business can not read another's site.
import type { Actor, SiteVersionStore } from '../../../../../lib/aimp/site-versions/store.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { buildWebsiteModel } from '../view-model.ts';
import type { WebsiteModel } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type WebsiteRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
  sites: Pick<SiteVersionStore, 'getDraft' | 'history' | 'resolvePublished'>;
};

export type WebsiteLookup =
  | { found: false }
  /** The business exists but has no store draft yet (guided set-up creates it). */
  | { found: true; state: 'no_site' }
  /** The store refused the read (for example the site belongs to another workspace). Nothing is shown from it. */
  | { found: true; state: 'unreadable'; errors: string[] }
  | { found: true; state: 'ready'; model: WebsiteModel };

export async function loadWebsite(rt: WebsiteRuntime, actor: Actor, businessId: string): Promise<WebsiteLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const slug = rt.slugs.get(businessId);
  if (!slug) return { found: true, state: 'no_site' };
  const draft = await rt.sites.getDraft(actor, slug);
  if (!draft.ok) return { found: true, state: 'unreadable', errors: draft.errors };
  const history = await rt.sites.history(actor, slug);
  if (!history.ok) return { found: true, state: 'unreadable', errors: history.errors };
  const publicView = await rt.sites.resolvePublished(slug);
  return { found: true, state: 'ready', model: buildWebsiteModel({ slug, draft: draft.value, history: history.value, publicView, currentUserId: actor.userId }) };
}

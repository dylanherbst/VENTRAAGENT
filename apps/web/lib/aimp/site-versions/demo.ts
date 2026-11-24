// Demo seeding: puts the two DEMO stores into a site-version store, each owned by its own demo workspace and
// published once as version 1. DEMO data only; no database is involved.
import { demoStore } from '../storefront/demo-store.ts';
import { demoStoreB } from '../storefront/demo-store-b.ts';
import type { Actor, SiteVersionStore } from './store.ts';

export const demoActorA: Actor = { workspaceId: 'demo-workspace-a', userId: 'demo-user-a' };
export const demoActorB: Actor = { workspaceId: 'demo-workspace-b', userId: 'demo-user-b' };

export async function seedDemoSites(store: SiteVersionStore): Promise<void> {
  for (const [actor, config] of [[demoActorA, demoStore], [demoActorB, demoStoreB]] as const) {
    const created = await store.createSite(actor, config);
    if (!created.ok) throw new Error(`Could not seed ${config.slug}: ${created.errors.join(' ')}`);
    const pub = await store.publish(actor, config.slug, { note: 'Demo starting version' });
    if (!pub.ok) throw new Error(`Could not publish ${config.slug}: ${pub.errors.join(' ')}`);
  }
}

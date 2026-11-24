// Turns the in-memory agent stores into plain JSON and back, so the studio can save a brand after every action and work the same on
// your Mac and on serverless hosting (each request loads the brand, acts, saves). Media bytes are saved under their own keys.
import { newTeamStore, type Asset, type TeamStore } from '../agents/team.ts';
import { newStore, type EngineStore } from '../marketing-engine/engine.ts';
import type { SetterSnapshot } from '../setter/store.ts';

export interface BrandSnapshot {
  v: 1;
  team: {
    profiles: TeamStore extends { profiles: Map<string, infer P> } ? P[] : never;
    configs: [string, unknown][]; runs: TeamStore['runs']; plans: unknown[]; posts: unknown[]; assets: (Omit<Asset, 'bytes'> & { hasBytes: boolean })[];
    renders: unknown[]; accounts: unknown[]; zernioProfiles: [string, string][]; audit: TeamStore['audit']; providerEvents: string[]; metrics: TeamStore['metrics']; usage: TeamStore['usage'];
  };
  marketing: { campaigns: unknown[]; usage: EngineStore['usage'] };
  setter: SetterSnapshot | null;
}

const MAX_RUNS = 300, MAX_AUDIT = 1000, MAX_EVENTS = 5000;

export function snapshotOf(team: TeamStore, marketing: EngineStore, setter: SetterSnapshot | null): { snap: BrandSnapshot; media: Map<string, { mime: string; b64: string }> } {
  const media = new Map<string, { mime: string; b64: string }>();
  for (const a of team.assets.values()) if (a.bytes) media.set(a.id, { mime: a.mime, b64: Buffer.from(a.bytes).toString('base64') });
  const snap: BrandSnapshot = {
    v: 1,
    team: {
      profiles: [...team.profiles.values()], configs: [...team.configs.entries()], runs: team.runs.slice(-MAX_RUNS), plans: [...team.plans.values()], posts: [...team.posts.values()],
      assets: [...team.assets.values()].map(({ bytes, ...a }) => ({ ...a, hasBytes: !!bytes })), renders: [...team.renders.values()], accounts: [...team.accounts.values()],
      zernioProfiles: [...team.zernioProfiles.entries()], audit: team.audit.slice(-MAX_AUDIT), providerEvents: [...team.providerEvents].slice(-MAX_EVENTS), metrics: team.metrics, usage: team.usage,
    },
    marketing: { campaigns: [...marketing.campaigns.values()], usage: marketing.usage },
    setter,
  };
  return { snap, media };
}

/** Rebuilds the stores. `bytesFor` returns saved media lazily (only assets that had bytes are asked for). */
export async function restore(snap: BrandSnapshot | null, bytesFor: (assetId: string) => Promise<{ mime: string; b64: string } | null>): Promise<{ team: TeamStore; marketing: EngineStore; setter: SetterSnapshot | null }> {
  const team = newTeamStore(), marketing = newStore();
  if (!snap || snap.v !== 1) return { team, marketing, setter: null };
  const t = snap.team;
  for (const p of t.profiles) team.profiles.set(p.workspaceId, p);
  for (const [k, c] of t.configs) team.configs.set(k, c as never);
  team.runs.push(...t.runs);
  for (const p of t.plans as { id: string }[]) team.plans.set(p.id, p as never);
  for (const p of t.posts as { id: string }[]) team.posts.set(p.id, p as never);
  for (const a of t.assets) {
    const { hasBytes, ...rest } = a;
    const m = hasBytes ? await bytesFor(a.id) : null;
    team.assets.set(a.id, { ...rest, bytes: m ? Uint8Array.from(Buffer.from(m.b64, 'base64')) : null });
  }
  for (const r of t.renders as { id: string }[]) team.renders.set(r.id, r as never);
  for (const a of t.accounts as { id: string }[]) team.accounts.set(a.id, a as never);
  for (const [k, v] of t.zernioProfiles) team.zernioProfiles.set(k, v);
  team.audit.push(...t.audit); for (const e of t.providerEvents) team.providerEvents.add(e); team.metrics.push(...t.metrics); team.usage.push(...t.usage);
  for (const c of snap.marketing.campaigns as { id: string }[]) marketing.campaigns.set(c.id, c as never);
  marketing.usage.push(...snap.marketing.usage);
  return { team, marketing, setter: snap.setter };
}

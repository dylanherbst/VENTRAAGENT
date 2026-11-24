// Opens one studio brand: loads its saved state, builds the SAME agents the customer app uses (Marketing, Social, AI Setter) on top of
// it, and saves everything back after the action. Workspace id = brand id, so every agent is scoped to that brand alone.
import { createHash } from 'node:crypto';
import { createAgentTeam, type AgentTeam, type TeamDeps } from '../agents/team.ts';
import { createEngine, type Engine, type StrategyWriter } from '../marketing-engine/index.ts';
import { createFakeSender, createMemorySetterStore, createSetter, defaultConfig, seal, type DmSender, type Setter, type SetterAgent, type SetterStore } from '../setter/index.ts';
import { brandKey, listBrands, mediaKey, type StudioBrand } from './brands.ts';
import { restore, snapshotOf, type BrandSnapshot } from './state.ts';
import type { Vault } from './vault.ts';

export interface StudioProviders {
  writer: StrategyWriter;
  team: Omit<TeamDeps, 'store' | 'marketing' | 'assetUrl'> & { assetUrl?: TeamDeps['assetUrl'] };
  setterAgent: (store: SetterStore) => SetterAgent;
  setterSender?: DmSender;
  /** Server secret used to derive this brand's sandbox keys. */
  secret: string;
}

export interface OpenBrand { brand: StudioBrand; ws: string; team: AgentTeam; engine: Engine; setter: Setter; setterStore: SetterStore; igAccountId: string; save(): Promise<void> }

const SANDBOX_APP_SECRET = 'studio-sandbox-app-secret';
export const sandboxAppSecret = () => SANDBOX_APP_SECRET;

export async function openBrand(vault: Vault, brandId: string, p: StudioProviders): Promise<OpenBrand | null> {
  const brand = (await listBrands(vault)).find((b) => b.id === brandId && !b.archived);
  if (!brand) return null;
  const ws = brand.id;
  const snap = (await vault.get(brandKey(ws))) as BrandSnapshot | null;
  const restored = await restore(snap, async (assetId) => (await vault.get(mediaKey(ws, assetId))) as { mime: string; b64: string } | null);
  const engine = createEngine({ store: restored.marketing, writer: p.writer });
  const team = createAgentTeam({ ...p.team, store: restored.team, marketing: engine, assetUrl: p.team.assetUrl ?? (() => null) });

  // AI Setter. Keys are derived per brand from the server secret, so they are stable across requests and never stored.
  const keyHex = createHash('sha256').update(`${p.secret}|setter-key|${ws}`).digest('hex');
  const setterStore = createMemorySetterStore(undefined, restored.setter);
  const igAccountId = `1784${BigInt(`0x${createHash('sha256').update(`acct|${ws}`).digest('hex').slice(0, 12)}`).toString().padStart(13, '0').slice(0, 13)}`;
  if (!setterStore.connectionFor(ws)) {
    setterStore.saveConnection({ workspaceId: ws, igAccountId, username: `${ws.replace(/^studio-/, '')}_test`, tokenSealed: seal(Buffer.from(keyHex, 'hex'), 'SANDBOX-TOKEN'),
      tokenExpiresAt: new Date(Date.now() + 3650 * 864e5).toISOString(), scopes: ['instagram_business_basic', 'instagram_business_manage_messages'], status: 'active', threadOwnershipConfirmed: true, connectedAt: new Date().toISOString() });
  }
  if (!setterStore.config(ws)) {
    const c = defaultConfig(ws, new Date());
    setterStore.saveConfig({ ...c, businessName: brand.businessName, about: brand.offer, idealCustomer: brand.audience, timezone: brand.timezone, bookingUrl: brand.website });
  }
  // Serverless-safe: no timers. Replies with a human delay are released by flushDue when the brand is next opened.
  const setter = createSetter({ store: setterStore, agent: p.setterAgent(setterStore), sender: p.setterSender ?? createFakeSender(), appSecret: SANDBOX_APP_SECRET, tokenKeyHex: keyHex,
    clickSecret: createHash('sha256').update(`${p.secret}|click|${ws}`).digest('hex'), schedule: () => {}, sleep: async () => {} });
  if (!team.profile(ws)) team.saveProfile(ws, { businessName: brand.businessName, industry: brand.industry, offer: brand.offer, audience: brand.audience, timezone: brand.timezone, website: brand.website, region: 'Australia', facts: [] }, 'owner');

  async function save() {
    const { snap: next, media } = snapshotOf(restored.team, restored.marketing, setterStore.snapshot());
    const had = new Set((snap?.team.assets ?? []).filter((a) => a.hasBytes).map((a) => a.id));
    for (const [id, m] of media) if (!had.has(id)) await vault.put(mediaKey(ws, id), m); // media is write-once
    await vault.put(brandKey(ws), next);
  }
  return { brand, ws, team, engine, setter, setterStore, igAccountId, save };
}

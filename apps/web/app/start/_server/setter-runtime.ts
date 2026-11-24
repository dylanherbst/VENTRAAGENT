// Server wiring for the AI Sales Setter.
//  - live(): the real webhook pipeline. Needs META_APP_SECRET, SETTER_TOKEN_KEY, SETTER_CLICK_SECRET. Outbound to Instagram happens ONLY
//    when SETTER_LIVE_SEND=1; otherwise sends are recorded by a fake sender, so nothing reaches anyone. Store is in memory (lost on
//    restart) until the database migration is applied.
//  - sandbox(business): the per-business test lab, fully simulated.
import { claudeAgent, costMicroUsd, createFakeSender, createInstagramSender, createMemorySetterStore, createSandbox, createSetter, grantTrial, ruleAgent, type Setter, type SetterAgent, type SetterStore } from '../../../lib/aimp/setter/index';
import { createStripe } from '../../../lib/aimp/payments/stripe';

/** Claude when ANTHROPIC_API_KEY is set (model from SETTER_MODEL, default claude-haiku-5-5); otherwise the keyword rules. */
export function setterAgent(store: SetterStore): SetterAgent {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return ruleAgent;
  // Every Claude call's real token usage is recorded against the customer's workspace (pay-per-chat billing).
  return claudeAgent({ apiKey: key, fetch: (u, i) => fetch(u, i), model: process.env.SETTER_MODEL,
    onUsage: (u) => store.addUsage({ ...u, costMicroUsd: costMicroUsd(u.model, u), at: new Date().toISOString() }) });
}

/** Stripe for credit packs, only when STRIPE_SECRET_KEY is set. */
export function setterStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const s = createStripe({ secretKey: key, fetch: (u, i) => fetch(u, i) });
  return s.mode ? s : null;
}

type Live = { setter: Setter; store: SetterStore; liveSend: boolean };
type G = typeof globalThis & { __aimpSetterLive?: Live | null; __aimpSetterSandboxesV7?: Map<string, ReturnType<typeof createSandbox>> };
const g = globalThis as G;

export const SETTER_ENV = ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'SETTER_TOKEN_KEY', 'SETTER_CLICK_SECRET'] as const;
export const missingSetterEnv = (): string[] => SETTER_ENV.filter((k) => !process.env[k]);

export function live(): Live | null {
  if (g.__aimpSetterLive !== undefined) return g.__aimpSetterLive;
  if (missingSetterEnv().length) return null;
  const liveSend = process.env.SETTER_LIVE_SEND === '1';
  const store = createMemorySetterStore();
  const sender = liveSend ? createInstagramSender({ fetch: (u, i) => fetch(u, i), graphVersion: process.env.META_GRAPH_VERSION }) : createFakeSender();
  const setter = createSetter({ store, agent: setterAgent(store), sender, schedule: (task, ms) => { setTimeout(task, ms); }, appSecret: process.env.META_APP_SECRET!, tokenKeyHex: process.env.SETTER_TOKEN_KEY!, clickSecret: process.env.SETTER_CLICK_SECRET! });
  g.__aimpSetterLive = { setter, store, liveSend };
  return g.__aimpSetterLive;
}

const MAX_SANDBOXES = 200;
/** Clears the test conversations, leads, results and activity for one business. Its setup (offers, FAQs, mode) is kept. */
export function resetSandbox(business: string): ReturnType<typeof createSandbox> | null {
  const m = (g.__aimpSetterSandboxesV7 ??= new Map());
  const old = m.get(business);
  const cfg = old?.store.config(old.ws) ?? null;
  m.delete(business);
  const fresh = sandbox(business);
  if (fresh && cfg) fresh.store.saveConfig(cfg);
  return fresh;
}

export function sandbox(business: string): ReturnType<typeof createSandbox> | null {
  const m = (g.__aimpSetterSandboxesV7 ??= new Map());
  const cur = m.get(business);
  if (cur) return cur;
  if (m.size >= MAX_SANDBOXES) return null;
  const store = createMemorySetterStore();
  const sb = createSandbox({ workspaceId: business, agent: setterAgent(store), store, schedule: (task, ms) => { setTimeout(task, ms); } });
  grantTrial(store, business, new Date().toISOString());
  m.set(business, sb);
  return sb;
}

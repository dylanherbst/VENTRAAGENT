// Per-customer AI usage billing for the setter (owner decision, 22 Nov 2026: one platform Anthropic key, each customer pays for their
// own chats with prepaid reply credits). 1 credit = 1 AI-written reply (sent or draft). Credits are granted ONLY by a verified Stripe
// payment (or the owner's free trial / test-lab button). When a customer has no credits, the AI stops writing and chats go to them.
// Every Claude call's real token usage is recorded so the platform's own cost per customer is known.

/** Credit packs. PLACEHOLDER prices: the owner sets these before launch. */
export const CREDIT_PACKS = [
  { id: 'pack-500', replies: 500, priceMinor: 900, currency: 'aud', label: '500 AI replies' },
  { id: 'pack-2000', replies: 2000, priceMinor: 2900, currency: 'aud', label: '2,000 AI replies' },
  { id: 'pack-10000', replies: 10000, priceMinor: 9900, currency: 'aud', label: '10,000 AI replies' },
] as const;
export type PackId = (typeof CREDIT_PACKS)[number]['id'];
export const packById = (id: unknown) => CREDIT_PACKS.find((p) => p.id === id) ?? null;

/** Free replies every new customer starts with. */
export const TRIAL_CREDITS = 50;
export const LOW_CREDIT_WARNING = 25;

/** Anthropic list prices in USD per million tokens (platform.claude.com, checked 22 Nov 2026, prompts up to 100k tokens). */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

export interface TokenUsage { inputTokens: number; outputTokens: number }
/** Cost in millionths of a US dollar. Unknown models are priced as Sonnet so cost is never understated. */
export function costMicroUsd(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES_USD_PER_MTOK[model] ?? MODEL_PRICES_USD_PER_MTOK['claude-sonnet-5-5']!;
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output);
}

export interface UsageRecord { workspaceId: string; conversationId: string | null; model: string; inputTokens: number; outputTokens: number; costMicroUsd: number; at: string }
export type CreditEntry = { workspaceId: string; delta: number; reason: 'trial' | 'purchase' | 'test_credit' | 'reply' | 'adjustment'; ref: string; at: string };
export interface CreditPurchase { id: string; workspaceId: string; packId: PackId; replies: number; priceMinor: number; currency: string; status: 'pending' | 'paid'; stripeSessionId: string | null; createdAt: string; paidAt: string | null }

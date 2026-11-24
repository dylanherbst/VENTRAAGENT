// Buying reply credits with Stripe. Credits are granted ONLY after (1) a correctly signed Stripe webhook for a known pending purchase
// and (2) a direct check with Stripe that the session is paid for exactly the pack price. Each purchase grants once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CREDIT_PACKS, packById, TRIAL_CREDITS, costMicroUsd, LOW_CREDIT_WARNING } from './credits.ts';
import type { SetterStore } from './store.ts';

export interface StripeLike {
  createSession(i: { amountCents: number; currency: string; productName: string; successUrl: string; cancelUrl: string; buyerEmail: string; orderId: string; idempotencyKey: string }): Promise<{ ok: true; sessionId: string; url: string } | { ok: false; message: string }>;
  verifyPaid(sessionId: string, expect: { amountCents: number; currency: string; orderId: string }): Promise<{ paid: boolean; reason: string }>;
}

export function grantTrial(s: SetterStore, ws: string, at: string): void {
  s.addCredit({ workspaceId: ws, delta: TRIAL_CREDITS, reason: 'trial', ref: 'trial', at });
}

export async function startCreditPurchase(
  d: { store: SetterStore; stripe: StripeLike; newId: () => string; now: () => Date },
  i: { workspaceId: string; packId: unknown; email: string; returnBase: string },
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const pack = packById(i.packId);
  if (!pack) return { ok: false, message: 'Pick one of the credit packs.' };
  const id = `cred_${d.newId()}`.replace(/[^A-Za-z0-9._:-]/g, '');
  d.store.savePurchase({ id, workspaceId: i.workspaceId, packId: pack.id, replies: pack.replies, priceMinor: pack.priceMinor, currency: pack.currency, status: 'pending', stripeSessionId: null, createdAt: d.now().toISOString(), paidAt: null });
  const r = await d.stripe.createSession({
    amountCents: pack.priceMinor, currency: pack.currency, productName: `AIMoneyPrinter AI Setter: ${pack.label}`, buyerEmail: i.email, orderId: id, idempotencyKey: `credits:${id}`,
    successUrl: `${i.returnBase}?credits=thanks`, cancelUrl: `${i.returnBase}?credits=cancelled`,
  });
  if (!r.ok) return { ok: false, message: r.message };
  d.store.savePurchase({ ...d.store.purchase(id)!, stripeSessionId: r.sessionId });
  return { ok: true, url: r.url };
}

/** Stripe signature scheme: `t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">`. */
export function verifyStripeSignature(raw: string, header: string | null, secret: string, nowS: number, toleranceS = 300): boolean {
  if (!secret || !header || header.length > 2000) return false;
  let t: number | null = null; const sigs: string[] = [];
  for (const part of header.split(',')) { const [k, v] = part.split('=', 2) as [string, string | undefined]; if (k === 't' && v && /^\d{1,12}$/.test(v)) t = Number(v); if (k === 'v1' && v && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase()); }
  if (t === null || !sigs.length || Math.abs(nowS - t) > toleranceS) return false;
  const want = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return sigs.some((s) => { const b = Buffer.from(s, 'hex'); return b.length === want.length && timingSafeEqual(b, want); });
}

export async function handleCreditWebhook(
  d: { store: SetterStore; stripe: StripeLike; webhookSecret: string; now: () => Date },
  raw: string, signature: string | null,
): Promise<{ status: number; outcome: string }> {
  if (!verifyStripeSignature(raw, signature, d.webhookSecret, Math.floor(d.now().getTime() / 1000))) return { status: 400, outcome: 'bad_signature' };
  let ev: { type?: unknown; data?: { object?: { id?: unknown; client_reference_id?: unknown } } };
  try { ev = JSON.parse(raw); } catch { return { status: 400, outcome: 'bad_json' }; }
  if (ev.type !== 'checkout.session.completed') return { status: 200, outcome: 'ignored' };
  const sessionId = ev.data?.object?.id, purchaseId = ev.data?.object?.client_reference_id;
  if (typeof sessionId !== 'string' || typeof purchaseId !== 'string') return { status: 200, outcome: 'ignored' };
  const p = d.store.purchase(purchaseId);
  if (!p || p.stripeSessionId !== sessionId) return { status: 200, outcome: 'unknown_purchase' };
  if (p.status === 'paid') return { status: 200, outcome: 'already_granted' };
  const check = await d.stripe.verifyPaid(sessionId, { amountCents: p.priceMinor, currency: p.currency, orderId: p.id });
  if (!check.paid) return { status: 200, outcome: `not_paid:${check.reason}` };
  const at = d.now().toISOString();
  d.store.addCredit({ workspaceId: p.workspaceId, delta: p.replies, reason: 'purchase', ref: `purchase:${p.id}`, at });
  d.store.savePurchase({ ...p, status: 'paid', paidAt: at });
  d.store.audit({ workspaceId: p.workspaceId, at, kind: 'credits_purchased', detail: `${p.replies} AI replies added.` });
  return { status: 200, outcome: 'granted' };
}

/** What the customer (and you) see about AI usage. */
export function usageSummary(s: SetterStore, ws: string) {
  const u = s.usage(ws);
  const balance = s.creditBalance(ws);
  const replies = s.creditEntries(ws).filter((e) => e.reason === 'reply').length;
  const cost = u.reduce((n, r) => n + r.costMicroUsd, 0);
  const convs = new Set(u.map((r) => r.conversationId).filter(Boolean)).size;
  return {
    creditsLeft: balance, low: balance <= LOW_CREDIT_WARNING, aiReplies: replies, modelCalls: u.length,
    inputTokens: u.reduce((n, r) => n + r.inputTokens, 0), outputTokens: u.reduce((n, r) => n + r.outputTokens, 0),
    platformCostUsd: cost / 1e6, costPerConversationUsd: convs ? cost / 1e6 / convs : null, packs: CREDIT_PACKS,
  };
}

export { costMicroUsd };

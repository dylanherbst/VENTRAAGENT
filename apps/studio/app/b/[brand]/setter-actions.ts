'use server';
// AI Setter for one brand: the same agent, rules and safety gates as the customer app. Instagram is simulated here (a test inbox per
// brand) until a Meta app is approved; replies are drafts unless you switch on automatic replies.
import { withBrand } from '../../../lib/server';
import { cleanDelay, profileGaps, setterMetrics, signForTest, simulatedPayload, usageSummary, type AgentConfig, type KnowledgeItem, type ObjectionAnswer, type Offer } from '../../../../web/lib/aimp/setter/index';
import { sandboxAppSecret, type OpenBrand } from '../../../../web/lib/aimp/studio/workspace';
import type { SetterView } from '../../../lib/views';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const https = (v: unknown) => { const u = str(v, 500); try { return u && new URL(u).protocol === 'https:' ? u : ''; } catch { return ''; } };

function view(b: OpenBrand): SetterView {
  const st = b.setterStore, ws = b.ws, cfg = st.config(ws)!;
  return {
    config: cfg, agentName: process.env.ANTHROPIC_API_KEY ? (process.env.SETTER_MODEL || 'claude-haiku-5-5') : 'rules', gaps: profileGaps(cfg), metered: !!process.env.ANTHROPIC_API_KEY,
    usage: usageSummary(st, ws), canBuy: false, killSwitch: st.killSwitch(ws),
    conversations: st.conversations(ws).map((c) => ({ ...c, lead: st.lead(ws, c.id), messages: st.messages(ws, c.id).map((m) => ({ id: m.id, direction: m.direction, author: m.author, text: m.text, status: m.status, sendAt: m.sendAt ?? null, error: m.error, notes: m.policyNotes ?? [], intent: m.decision?.intent ?? null, confidence: m.decision?.confidence ?? null })) })),
    metrics: setterMetrics(st, ws), audit: st.audits(ws).slice(-15).reverse(),
  };
}

export async function loadSetterAction(brand: string): Promise<SetterView | null> { return withBrand(brand, (b) => view(b)); }

export async function saveConfigAction(brand: string, raw: unknown): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const r = await withBrand(brand, (b) => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const cur = b.setterStore.config(b.ws)!;
  const offers: Offer[] = (Array.isArray(o.offers) ? o.offers : []).slice(0, 10).map((x, i) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { id: `offer-${i + 1}`, name: str(r.name, 80), description: str(r.description, 300), details: str(r.details, 3000), bestFor: str(r.bestFor, 400), priceMinor: Math.round(Number(r.price) * 100), currency: 'AUD', ctaUrl: https(r.ctaUrl), ctaKind: 'checkout' as const };
  }).filter((x) => x.name && Number.isInteger(x.priceMinor) && x.priceMinor > 0);
  const knowledge: KnowledgeItem[] = (Array.isArray(o.knowledge) ? o.knowledge : []).slice(0, 30).map((x, i) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { id: `faq-${i + 1}`, question: str(r.question, 200), answer: str(r.answer, 600) };
  }).filter((k) => k.question && k.answer);
  const objections: ObjectionAnswer[] = (Array.isArray(o.objections) ? o.objections : []).slice(0, 20).map((x, i) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return { id: `obj-${i + 1}`, objection: str(r.objection, 200), answer: str(r.answer, 600) };
  }).filter((x) => x.objection && x.answer);
  const lines = (v: unknown, n: number, len: number) => str(v, n * len).split('\n').map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, n);
  const mode = o.mode === 'auto' || o.mode === 'off' ? o.mode : 'draft_only';
  if (mode === 'auto' && o.confirmAuto !== true) return { ok: false, message: 'Tick the box to confirm automatic replies.', view: view(b) };
  const next: AgentConfig = {
    ...cur, mode, paused: o.paused === true, discloseAi: o.discloseAi === true, businessName: str(o.businessName, 80), idealCustomer: str(o.idealCustomer, 200), brandVoice: str(o.brandVoice, 120) || cur.brandVoice,
    qualifyingQuestion: str(o.qualifyingQuestion, 200), refundPolicy: str(o.refundPolicy, 400), bookingUrl: https(o.bookingUrl), offers, knowledge,
    about: str(o.about, 800), shipping: str(o.shipping, 500), returns: str(o.returns, 500), warranty: str(o.warranty, 500),
    sellingPoints: lines(o.sellingPoints, 10, 200), objections, testimonials: o.testimonialsConfirmed === true ? lines(o.testimonials, 10, 300) : [],
    replyDelay: cleanDelay({ enabled: o.delayEnabled !== false, minSeconds: Number(o.delayMin), maxSeconds: Number(o.delayMax) }),
    upsell: str(o.upsell, 300), botQuestion: o.botQuestion === 'handoff' ? 'handoff' : 'honest',
    prohibitedClaims: str(o.prohibitedClaims, 600).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20), updatedAt: new Date().toISOString(),
  };
    b.setterStore.saveConfig(next);
    return { ok: true, message: 'Saved.', view: view(b) };
  });
  return r ?? { ok: false, message: 'Brand not found.', view: null };
}

let mid = 0;
export async function simulateAction(brand: string, text: unknown, person: unknown): Promise<{ result: string; view: SetterView | null }> {
  const t = str(text, 1000);
  const r = await withBrand(brand, async (b) => {
    if (!t) return { result: 'Type a message first.', view: view(b) };
    const who = person === 'b' ? '900000000000002' : '900000000000001';
    const raw = simulatedPayload(b.igAccountId, [{ from: who, text: t, mid: `studio-${Date.now()}-${++mid}`, ts: Date.now() }]);
    const res = await b.setter.receive(raw, signForTest(raw, sandboxAppSecret()));
    await b.setter.flushDue(b.ws);
    return { result: res.results.join(', '), view: view(b) };
  });
  return r ?? { result: 'Brand not found.', view: null };
}

export async function inboxAction(brand: string, op: unknown): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const r = await withBrand(brand, async (b) => {
    const o = (typeof op === 'object' && op !== null ? op : {}) as Record<string, unknown>;
    const id = str(o.id, 100);
    let ok = false, message: string;
    if (o.kind === 'approve') { const x = await b.setter.approve(b.ws, id, typeof o.text === 'string' ? o.text : undefined); ok = x.ok; message = x.ok ? 'Sent (test inbox).' : `Not sent: ${x.reason}`; }
    else if (o.kind === 'reject') { ok = b.setter.reject(b.ws, id).ok; message = ok ? 'Draft discarded.' : 'Not a draft.'; }
    else if (o.kind === 'takeover' || o.kind === 'release') { ok = b.setter.takeover(b.ws, id, o.kind === 'takeover').ok; message = ok ? (o.kind === 'takeover' ? 'You have taken over. The AI will not reply here.' : 'The AI can reply here again.') : 'Not found.'; }
    else if (o.kind === 'reply') { const x = await b.setter.humanReply(b.ws, id, str(o.text, 1000)); ok = x.ok; message = x.ok ? 'Sent (test inbox).' : `Not sent: ${x.reason}`; }
    else if (o.kind === 'kill') { b.setterStore.setKillSwitch(b.ws, o.on === true); ok = true; message = o.on === true ? 'All sending stopped.' : 'Sending allowed again.'; }
    else if (o.kind === 'reset' || o.kind === 'test_credits') { message = o.kind === 'reset' ? 'Clearing test chats is not available here yet.' : 'Your own brands do not use credits.'; }
    else message = 'Unknown action.';
    return { ok, message, view: view(b) };
  });
  return r ?? { ok: false, message: 'Brand not found.', view: null };
}

/** Brings the brand's AI Team profile (what you sell, who for, website) into the setter. */
export async function importFromShopAction(brand: string): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const r = await withBrand(brand, (b) => {
    const p = b.team.profile(b.ws), cfg = b.setterStore.config(b.ws)!;
    if (!p) return { ok: false, message: 'Fill in the business on the AI Team page first.', view: view(b) };
    b.setterStore.saveConfig({ ...cfg, businessName: cfg.businessName || p.businessName, about: cfg.about || p.offer, idealCustomer: cfg.idealCustomer || p.audience, bookingUrl: cfg.bookingUrl || p.website, updatedAt: new Date().toISOString() });
    return { ok: true, message: 'Filled in from your business profile. Add your offers, prices and links.', view: view(b) };
  });
  return r ?? { ok: false, message: 'Brand not found.', view: null };
}

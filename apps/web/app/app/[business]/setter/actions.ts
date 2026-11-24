'use server';
// AI Setter test lab actions. Everything runs on the per-business SANDBOX: simulated Instagram, fake sender, nothing leaves the server.
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { resetSandbox, sandbox, setterStripe, live } from '../../../start/_server/setter-runtime';
import { cleanDelay, profileGaps, setterMetrics, usageSummary, type AgentConfig, type Offer, type KnowledgeItem, type ObjectionAnswer } from '../../../../lib/aimp/setter/index';
import { catalogueCtx, runtime } from '../../../start/_server/runtime';
import { getOfferState } from '../../../../lib/aimp/offers/store';
import { buyerGets } from '../../../../lib/aimp/offers/build';
import type { SetterView } from './view';

function sb(business: string) {
  if (!availability().available || !checkBusiness(business)) return null;
  return sandbox(business);
}

export async function loadSetterAction(business: string): Promise<SetterView | null> {
  const s = sb(business);
  if (s) await s.setter.flushDue(s.ws);
  return s ? view(s) : null;
}

function view(s: NonNullable<ReturnType<typeof sb>>): SetterView {
  const ws = s.ws;
  return {
    config: s.store.config(ws)!,
    agentName: s.agentName,
    gaps: profileGaps(s.store.config(ws)!),
    metered: s.metered,
    usage: usageSummary(s.store, ws),
    canBuy: !!setterStripe() && !!live(),
    killSwitch: s.store.killSwitch(ws),
    conversations: s.store.conversations(ws).map((c) => ({ ...c, lead: s.store.lead(ws, c.id), messages: s.store.messages(ws, c.id).map((m) => ({ id: m.id, direction: m.direction, author: m.author, text: m.text, status: m.status, sendAt: m.sendAt ?? null, error: m.error, notes: m.policyNotes ?? [], intent: m.decision?.intent ?? null, confidence: m.decision?.confidence ?? null })) })),
    metrics: setterMetrics(s.store, ws),
    audit: s.store.audits(ws).slice(-15).reverse(),
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const https = (v: unknown) => { const u = str(v, 500); try { return u && new URL(u).protocol === 'https:' ? u : ''; } catch { return ''; } };

export async function saveConfigAction(business: string, raw: unknown): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const s = sb(business);
  if (!s) return { ok: false, message: 'Not available here.', view: null };
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const cur = s.store.config(s.ws)!;
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
  if (mode === 'auto' && o.confirmAuto !== true) return { ok: false, message: 'Tick the box to confirm automatic replies.', view: view(s) };
  const next: AgentConfig = {
    ...cur, mode, paused: o.paused === true, discloseAi: o.discloseAi === true, businessName: str(o.businessName, 80), idealCustomer: str(o.idealCustomer, 200), brandVoice: str(o.brandVoice, 120) || cur.brandVoice,
    qualifyingQuestion: str(o.qualifyingQuestion, 200), refundPolicy: str(o.refundPolicy, 400), bookingUrl: https(o.bookingUrl), offers, knowledge,
    about: str(o.about, 800), shipping: str(o.shipping, 500), returns: str(o.returns, 500), warranty: str(o.warranty, 500),
    sellingPoints: lines(o.sellingPoints, 10, 200), objections, testimonials: o.testimonialsConfirmed === true ? lines(o.testimonials, 10, 300) : [],
    replyDelay: cleanDelay({ enabled: o.delayEnabled !== false, minSeconds: Number(o.delayMin), maxSeconds: Number(o.delayMax) }),
    upsell: str(o.upsell, 300), botQuestion: o.botQuestion === 'handoff' ? 'handoff' : 'honest',
    prohibitedClaims: str(o.prohibitedClaims, 600).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20), updatedAt: new Date().toISOString(),
  };
  s.store.saveConfig(next);
  return { ok: true, message: 'Saved.', view: view(s) };
}

export async function simulateAction(business: string, text: unknown, person: unknown): Promise<{ result: string; view: SetterView | null }> {
  const s = sb(business);
  const t = str(text, 1000);
  if (!s || !t) return { result: 'Type a message first.', view: s ? view(s) : null };
  const who = person === 'b' ? '900000000000002' : '900000000000001';
  const r = await s.inbound(t, who);
  return { result: r.results.join(', '), view: view(s) };
}

export async function inboxAction(business: string, op: unknown): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const s = sb(business);
  if (!s) return { ok: false, message: 'Not available here.', view: null };
  const o = (typeof op === 'object' && op !== null ? op : {}) as Record<string, unknown>;
  const id = str(o.id, 100);
  let ok = false;
  let message: string;
  if (o.kind === 'approve') { const r = await s.setter.approve(s.ws, id, typeof o.text === 'string' ? o.text : undefined); ok = r.ok; message = r.ok ? 'Sent (simulated).' : `Not sent: ${r.reason}`; }
  else if (o.kind === 'reject') { ok = s.setter.reject(s.ws, id).ok; message = ok ? 'Draft discarded.' : 'Not a draft.'; }
  else if (o.kind === 'takeover' || o.kind === 'release') { ok = s.setter.takeover(s.ws, id, o.kind === 'takeover').ok; message = ok ? (o.kind === 'takeover' ? 'You have taken over. The AI will not reply here.' : 'The AI can reply here again.') : 'Not found.'; }
  else if (o.kind === 'reply') { const r = await s.setter.humanReply(s.ws, id, str(o.text, 1000)); ok = r.ok; message = r.ok ? 'Sent (simulated).' : `Not sent: ${r.reason}`; }
  else if (o.kind === 'reset') { const f = resetSandbox(business); ok = !!f; return { ok, message: ok ? 'Test messages cleared. Your setup is kept.' : 'Could not reset.', view: f ? view(f) : null }; }
  else if (o.kind === 'test_credits') { ok = s.store.addCredit({ workspaceId: s.ws, delta: 500, reason: 'test_credit', ref: `test:${Date.now()}:${Math.random()}`, at: new Date().toISOString() }); message = ok ? '500 test credits added (no payment taken).' : 'Could not add credits.'; }
  else if (o.kind === 'kill') { s.store.setKillSwitch(s.ws, o.on === true); ok = true; message = o.on === true ? 'All sending stopped.' : 'Sending allowed again.'; }
  else message = 'Unknown action.';
  return { ok, message, view: view(s) };
}

/** Pull what AIMoneyPrinter already knows about this business (approved shop listings and the Offer builder product) into the setter.
 *  Existing setter entries are kept; imported products are added once (matched by name). Checkout links must be added by the owner. */
export async function importFromShopAction(business: string): Promise<{ ok: boolean; message: string; view: SetterView | null }> {
  const s = sb(business);
  if (!s) return { ok: false, message: 'Not available here.', view: null };
  const cfg = s.store.config(s.ws)!;
  const found: Offer[] = [];
  try {
    const rt = runtime();
    for (const l of await rt.catalogue.listApprovedForBusiness(catalogueCtx(business), business)) {
      found.push({ id: '', name: l.title, priceMinor: l.priceMinor, currency: l.currency, description: l.shortDescription, details: l.longDescription, ctaUrl: '', ctaKind: 'checkout' });
    }
  } catch { /* no catalogue for this business */ }
  const approved = getOfferState(business).approved;
  if (approved) found.push({ id: '', name: approved.spec.title, priceMinor: approved.priceMinor, currency: 'AUD', description: approved.spec.subtitle, details: `Digital PDF download. What you get: ${buyerGets(approved.spec).join('; ')}.`, ctaUrl: '', ctaKind: 'checkout' });
  const have = new Set(cfg.offers.map((o) => o.name.toLowerCase()));
  const add = found.filter((f) => !have.has(f.name.toLowerCase()));
  const offers = [...cfg.offers, ...add].slice(0, 10).map((o, i) => ({ ...o, id: o.id || `offer-${i + 1}` }));
  s.store.saveConfig({ ...cfg, offers, updatedAt: new Date().toISOString() });
  return { ok: true, message: add.length ? `Imported ${add.length} product${add.length === 1 ? '' : 's'} from your shop. Add a checkout link and details to each.` : 'Nothing new to import: your shop products are already here.', view: view(s) };
}

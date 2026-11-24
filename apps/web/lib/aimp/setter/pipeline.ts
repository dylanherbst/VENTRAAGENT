// Message processing: new_event -> verified -> tenant_resolved -> deduped -> eligibility_checked -> conversation_loaded -> agent_decision
// -> post_decision_policy_checked -> [draft | send | handoff | ignore] -> sent/failed -> audit_and_metrics.
// The model never sends. Only `deliver` sends, and it re-checks eligibility at that moment, under a per-conversation lock, with an
// idempotency key per message, so a duplicate webhook or a double click can never produce two replies.
import { parseKey, readSigned, signValue, unseal } from './crypto.ts';
import { validateDecision } from './decision.ts';
import { asksIfAutomated, checkEligibility, isOptOut, wantsHuman, type Block } from './eligibility.ts';
import { applyPolicy } from './policy.ts';
import type { SetterAgent } from './agent.ts';
import type { DmSender } from './sender.ts';
import type { SetterStore } from './store.ts';
import type { AgentConfig, DmConversation, DmMessage, LeadStage } from './types.ts';
import { parseInstagramPayload, verifySignature, type NormalizedEvent } from './webhook.ts';
import { DEFAULT_REPLY_DELAY, replyDelayMs } from './delay.ts';

export interface SetterDeps {
  store: SetterStore;
  agent: SetterAgent;
  sender: DmSender;
  appSecret: string;
  tokenKeyHex: string;
  clickSecret: string;
  now?: () => Date;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Runs a task later. Absent = replies go out immediately (tests). The server passes setTimeout; production needs a durable job queue. */
  schedule?: (task: () => void, ms: number) => void;
  random?: () => number;
}

export const defaultConfig = (workspaceId: string, now: Date): AgentConfig => ({
  workspaceId, mode: 'draft_only', paused: false, businessName: '', idealCustomer: '', brandVoice: 'friendly, short, natural', offers: [], knowledge: [],
  prohibitedClaims: [], refundPolicy: '', bookingUrl: '', qualifyingQuestion: '', timezone: 'Australia/Perth', minConfidence: 0.6, discloseAi: false,
  about: '', shipping: '', returns: '', warranty: '', sellingPoints: [], objections: [], testimonials: [], upsell: '', botQuestion: 'honest',
  replyDelay: { ...DEFAULT_REPLY_DELAY },
  promptVersion: '', updatedAt: now.toISOString(),
});

export const honestAnswer = (business: string): string =>
  `Fair question! I'm the automated assistant for ${business || 'the shop'}. Happy to keep helping, or I can get someone from the team to jump in. Just say the word.`;

export function createSetter(d: SetterDeps) {
  const now = d.now ?? (() => new Date());
  let n = 0;
  const newId = d.newId ?? (() => `${Date.now().toString(36)}-${(++n).toString(36)}`);
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = d.maxAttempts ?? 3;
  const s = d.store;
  const locks = new Map<string, Promise<unknown>>();
  const iso = () => now().toISOString();
  const audit = (ws: string, kind: string, detail: string) => s.audit({ workspaceId: ws, at: iso(), kind, detail });

  /** Runs one task at a time per conversation key. */
  function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    locks.set(key, next);
    return next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  }

  function setLead(ws: string, conv: DmConversation, stage: LeadStage, reason: string) {
    const cur = s.lead(ws, conv.id);
    s.saveLead({ workspaceId: ws, conversationId: conv.id, igsid: conv.igsid, stage, reason: reason.slice(0, 200), source: 'instagram_dm', lastInteractionAt: iso(), owner: cur?.owner ?? null, optedOut: stage === 'opt_out' || (cur?.optedOut ?? false) });
  }

  function eligibility(ws: string, conv: DmConversation) {
    return checkEligibility({ now: now(), killSwitch: s.killSwitch(ws), config: s.config(ws), connection: s.connectionFor(ws), conversation: conv, optedOut: s.isOptedOut(ws, conv.igsid) });
  }

  async function handleEvent(ev: NormalizedEvent): Promise<string> {
    const conn = s.connectionByAccount(ev.igAccountId);
    if (!conn || conn.status !== 'active') return 'no_tenant';
    const ws = conn.workspaceId;
    if (!s.claimEvent(ev.igAccountId, ev.eventId)) return 'duplicate';
    return serial(`${ws}|${ev.igsid}`, async () => {
      let conv = s.conversationFor(ws, ev.igAccountId, ev.igsid);
      if (!conv) {
        conv = { id: `conv-${newId()}`, workspaceId: ws, igAccountId: ev.igAccountId, igsid: ev.igsid, state: 'open', humanTakeover: false, lastInboundAt: null, lastActivityAt: ev.at, unread: 0, aiDisclosed: false, pitchesDeclined: 0 };
      }
      if (ev.kind === 'echo') {
        const ours = s.messages(ws, conv.id).some((m) => m.mid === ev.eventId);
        if (ours) return 'own_echo';
        // Someone replied from the Instagram app: a person is handling it, so the AI steps back.
        s.saveMessage({ id: `msg-${newId()}`, workspaceId: ws, conversationId: conv.id, direction: 'out', author: 'human', text: ev.text, status: 'sent', mid: ev.eventId, error: null, createdAt: ev.at });
        s.saveConversation({ ...conv, humanTakeover: true, state: 'human', lastActivityAt: ev.at });
        audit(ws, 'human_reply_seen', `Owner replied in Instagram; automation paused for ${conv.id}.`);
        return 'human_echo';
      }
      // A new message makes any reply still waiting to go out stale: cancel it and answer with the full context instead.
      for (const m of s.messages(ws, conv.id)) if (m.direction === 'out' && m.status === 'queued' && m.sendAt) s.saveMessage({ ...m, status: 'rejected', error: 'Replaced: the person sent another message before this went out.' });
      conv = { ...conv, lastInboundAt: ev.at, lastActivityAt: ev.at, unread: conv.unread + 1 };
      s.saveConversation(conv);
      s.saveMessage({ id: `msg-${newId()}`, workspaceId: ws, conversationId: conv.id, direction: 'in', author: 'person', text: ev.text, status: 'received', mid: ev.eventId, error: null, createdAt: ev.at });
      if (isOptOut(ev.text)) {
        s.optOut(ws, conv.igsid);
        setLead(ws, conv, 'opt_out', ev.text);
        s.saveConversation({ ...conv, state: 'closed' });
        audit(ws, 'opt_out', `${conv.id} opted out.`);
        return 'opted_out';
      }
      if (wantsHuman(ev.text)) {
        setLead(ws, conv, 'human_requested', ev.text);
        s.saveConversation({ ...conv, humanTakeover: true, state: 'human' });
        audit(ws, 'handoff', `${conv.id} asked for a person.`);
        return 'handoff';
      }
      const el = eligibility(ws, conv);
      if (!el.canDraft) { audit(ws, 'not_eligible', `${conv.id}: ${el.blocks.join(', ')}`); return `blocked:${el.blocks.join(',')}`; }
      const cfg = s.config(ws)!;
      // Asked directly whether this is automated: answer honestly, never deny it (owner decision: only say so when asked).
      if (asksIfAutomated(ev.text) && cfg.botQuestion === 'handoff') {
        setLead(ws, conv, 'human_requested', ev.text);
        s.saveConversation({ ...conv, humanTakeover: true, state: 'human' });
        audit(ws, 'handoff', `${conv.id} asked if they are talking to a bot; handed to you.`);
        return 'handoff';
      }
      if (asksIfAutomated(ev.text)) {
        const send = cfg.mode === 'auto' && el.canSend;
        const m: DmMessage = { id: `msg-${newId()}`, workspaceId: ws, conversationId: conv.id, direction: 'out', author: 'ai', text: honestAnswer(cfg.businessName), status: send ? 'queued' : 'draft', mid: null, error: null, createdAt: iso(), policyNotes: ['Asked if this is automated: answered honestly.'] };
        s.saveMessage(m);
        s.saveConversation({ ...conv, state: send ? 'open' : 'awaiting_approval' });
        if (!send) return 'draft';
        return sendLater(ws, m, cfg);
      }
      // Pay-per-chat: a metered (real AI) agent needs a credit first. Out of credits = the AI stops and the owner answers.
      if (d.agent.metered && s.creditBalance(ws) <= 0) {
        s.saveConversation({ ...conv, humanTakeover: true, state: 'human' });
        audit(ws, 'out_of_credits', `${conv.id}: no AI reply credits left; handed to you.`);
        return 'out_of_credits';
      }
      let raw: unknown;
      try { raw = await d.agent.decide({ config: cfg, history: s.messages(ws, conv.id).slice(0, -1).filter((m) => m.direction === 'in' || m.status === 'sent'), latest: ev.text, conversationId: conv.id }); }
      catch { s.saveConversation({ ...conv, humanTakeover: true, state: 'human' }); audit(ws, 'model_error', `${conv.id}: the AI did not answer; handed to a person.`); return 'model_error'; }
      if (d.agent.metered) s.addCredit({ workspaceId: ws, delta: -1, reason: 'reply', ref: `reply:${ev.eventId}`, at: iso() });
      const v = validateDecision(raw);
      if (!v.ok) { s.saveConversation({ ...conv, humanTakeover: true, state: 'human' }); audit(ws, 'invalid_model_output', `${conv.id}: ${v.errors.join(' ')}`); return 'invalid_output'; }
      const dec = v.decision;
      setLead(ws, conv, dec.lead_stage, ev.text);
      if (dec.intent === 'not_a_fit') conv = { ...conv, pitchesDeclined: conv.pitchesDeclined + 1 };
      const out = applyPolicy(dec, cfg, conv, el, { askedIfBot: asksIfAutomated(ev.text) });
      if (out.action === 'ignore') { s.saveConversation(conv); return 'ignored'; }
      if (out.action === 'handoff') {
        s.saveConversation({ ...conv, humanTakeover: true, state: 'human' });
        audit(ws, 'handoff', `${conv.id}: ${out.notes.join(' ')}`);
        return 'handoff';
      }
      const msg: DmMessage = { id: `msg-${newId()}`, workspaceId: ws, conversationId: conv.id, direction: 'out', author: 'ai', text: out.text, status: out.action === 'send' ? 'queued' : 'draft', mid: null, error: null, createdAt: iso(), decision: dec, policyNotes: out.notes };
      s.saveMessage(msg);
      s.saveConversation({ ...conv, state: out.action === 'send' ? 'open' : 'awaiting_approval' });
      if (out.action === 'draft') return 'draft';
      return sendLater(ws, msg, cfg);
    });
  }

  /** Automatic replies wait a random, human-like time (max 7 min). Eligibility is re-checked when the time comes. */
  async function sendLater(ws: string, msg: DmMessage, cfg: AgentConfig): Promise<string> {
    const ms = d.schedule ? replyDelayMs(msg.text, cfg.replyDelay ?? DEFAULT_REPLY_DELAY, d.random) : 0;
    if (ms <= 0) { const r = await deliverLocked(ws, msg.id, 'ai'); return r.ok ? 'sent' : `send_failed:${r.reason}`; }
    s.saveMessage({ ...msg, sendAt: new Date(now().getTime() + ms).toISOString() });
    const conv = s.conversation(ws, msg.conversationId)!;
    d.schedule!(() => { void serial(`${ws}|${conv.igsid}`, () => sendIfDue(ws, msg.id)); }, ms);
    return 'scheduled';
  }
  async function sendIfDue(ws: string, id: string) {
    const m = s.message(ws, id);
    if (!m || m.status !== 'queued') return; // cancelled, replaced or already sent
    await deliverLocked(ws, id, 'ai');
  }

  const HUMAN_MAY_IGNORE: Block[] = ['mode_off', 'paused', 'human_takeover'];

  async function deliverLocked(ws: string, messageId: string, by: 'ai' | 'human'): Promise<{ ok: boolean; reason: string }> {
    const key = `send:${messageId}`;
    const prior = s.attempt(ws, key);
    if (prior?.status === 'sent') return { ok: true, reason: 'already_sent' };
    if (prior?.status === 'dead_letter') return { ok: false, reason: 'dead_letter' };
    const msg = s.message(ws, messageId);
    if (!msg || msg.direction !== 'out') return { ok: false, reason: 'not_found' };
    const conv = s.conversation(ws, msg.conversationId);
    if (!conv) return { ok: false, reason: 'not_found' };
    const el = eligibility(ws, conv); // re-checked at the moment of sending
    const blocks = by === 'human' ? el.blocks.filter((b) => !HUMAN_MAY_IGNORE.includes(b)) : el.blocks;
    if (blocks.length) {
      s.saveMessage({ ...msg, status: msg.status === 'queued' ? 'draft' : msg.status, error: `Not sent: ${blocks.join(', ')}` });
      s.saveAttempt({ workspaceId: ws, idempotencyKey: key, conversationId: conv.id, messageId, status: 'blocked', attempts: prior?.attempts ?? 0, lastError: blocks.join(','), at: iso() });
      audit(ws, 'send_blocked', `${conv.id}: ${blocks.join(', ')}`);
      return { ok: false, reason: blocks.join(',') };
    }
    const conn = s.connectionFor(ws)!;
    const keyBuf = parseKey(d.tokenKeyHex);
    const token = keyBuf ? unseal(keyBuf, conn.tokenSealed) : null;
    if (!token) { audit(ws, 'token_unreadable', 'Stored token could not be read; reconnect needed.'); return { ok: false, reason: 'token' }; }
    let attempts = prior?.attempts ?? 0;
    for (;;) {
      attempts++;
      const r = await d.sender.send({ igAccountId: conn.igAccountId, igsid: conv.igsid, text: msg.text, accessToken: token });
      if (r.ok) {
        s.saveMessage({ ...msg, status: 'sent', mid: r.messageId, error: null, author: by === 'human' && msg.author === 'ai' ? 'ai' : msg.author });
        s.saveAttempt({ workspaceId: ws, idempotencyKey: key, conversationId: conv.id, messageId, status: 'sent', attempts, lastError: null, at: iso() });
        const fresh = s.conversation(ws, conv.id)!;
        s.saveConversation({ ...fresh, aiDisclosed: fresh.aiDisclosed || msg.author === 'ai', state: fresh.humanTakeover ? 'human' : 'open', lastActivityAt: iso(), unread: 0 });
        audit(ws, 'sent', `${conv.id} (${by})`);
        return { ok: true, reason: 'sent' };
      }
      if (!r.retryable || attempts >= maxAttempts) {
        const status = r.retryable ? 'dead_letter' : 'failed';
        s.saveMessage({ ...msg, status: 'failed', error: `${r.code}: ${r.message}` });
        s.saveAttempt({ workspaceId: ws, idempotencyKey: key, conversationId: conv.id, messageId, status, attempts, lastError: r.code, at: iso() });
        audit(ws, status, `${conv.id}: ${r.code}`);
        return { ok: false, reason: r.code };
      }
      s.saveAttempt({ workspaceId: ws, idempotencyKey: key, conversationId: conv.id, messageId, status: 'retrying', attempts, lastError: r.code, at: iso() });
      await sleep(1000 * 4 ** (attempts - 1));
    }
  }

  return {
    /** Verified Meta POST. Returns the HTTP status to answer with. Signature is checked before the body is read. */
    async receive(rawBody: string, signature: string | null): Promise<{ status: number; results: string[] }> {
      if (!verifySignature(rawBody, signature, d.appSecret)) return { status: 401, results: ['bad_signature'] };
      const p = parseInstagramPayload(rawBody);
      if (!p.ok) return { status: 200, results: [p.reason] };
      const results: string[] = [];
      for (const ev of p.events) results.push(await handleEvent(ev));
      return { status: 200, results };
    },

    /** Sends queued replies whose time has passed (call on a timer and after a restart; in-process timers are lost on restart). */
    async flushDue(ws: string): Promise<number> {
      let n = 0;
      for (const c of s.conversations(ws)) for (const m of s.messages(ws, c.id)) {
        if (m.direction === 'out' && m.status === 'queued' && m.sendAt && Date.parse(m.sendAt) <= now().getTime()) { await serial(`${ws}|${c.igsid}`, () => sendIfDue(ws, m.id)); n++; }
      }
      return n;
    },

    /** Owner actions from the inbox. All scoped by the workspace the server resolved from the session. */
    async approve(ws: string, messageId: string, editedText?: string) {
      const m = s.message(ws, messageId);
      if (!m || m.status !== 'draft') return { ok: false, reason: 'not_a_draft' };
      return serial(`${ws}|${s.conversation(ws, m.conversationId)?.igsid ?? ''}`, async () => {
        if (editedText !== undefined) {
          const t = editedText.trim();
          if (!t || Buffer.byteLength(t, 'utf8') > 1000) return { ok: false, reason: 'text_length' };
          s.saveMessage({ ...m, text: t, author: 'human' });
        }
        return deliverLocked(ws, messageId, 'human');
      });
    },
    reject(ws: string, messageId: string) {
      const m = s.message(ws, messageId);
      if (!m || m.status !== 'draft') return { ok: false };
      s.saveMessage({ ...m, status: 'rejected' });
      return { ok: true };
    },
    async humanReply(ws: string, conversationId: string, text: string) {
      const conv = s.conversation(ws, conversationId);
      const t = text.trim();
      if (!conv || !t || Buffer.byteLength(t, 'utf8') > 1000) return { ok: false, reason: 'invalid' };
      const id = `msg-${newId()}`;
      s.saveMessage({ id, workspaceId: ws, conversationId, direction: 'out', author: 'human', text: t, status: 'draft', mid: null, error: null, createdAt: iso() });
      return serial(`${ws}|${conv.igsid}`, () => deliverLocked(ws, id, 'human'));
    },
    takeover(ws: string, conversationId: string, on: boolean) {
      const c = s.conversation(ws, conversationId);
      if (!c) return { ok: false };
      s.saveConversation({ ...c, humanTakeover: on, state: on ? 'human' : 'open' });
      audit(ws, on ? 'takeover' : 'release', conversationId);
      return { ok: true };
    },

    /** Signed first-party click link for a CTA in a reply. A click is a click, never a purchase. */
    clickLink(base: string, ws: string, conversationId: string, url: string): string {
      const t = signValue(d.clickSecret, JSON.stringify({ ws, c: conversationId, u: url }), now().getTime() + 30 * 864e5);
      return `${base}?t=${encodeURIComponent(t)}`;
    },
    recordClick(token: string): string | null {
      const raw = readSigned(d.clickSecret, token, now().getTime());
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as { ws: string; c: string; u: string };
        const cfg = s.config(v.ws);
        const allowed = cfg && [...cfg.offers.map((o) => o.ctaUrl), cfg.bookingUrl].includes(v.u);
        if (!allowed) return null;
        s.addConversion({ workspaceId: v.ws, conversationId: v.c, kind: 'checkout_click', source: 'redirect', amountMinor: null, at: iso() });
        return v.u;
      } catch { return null; }
    },
    /** Call ONLY from a verified Stripe or booking webhook handler. */
    recordVerifiedOutcome(ws: string, e: { kind: 'purchase' | 'booking'; source: 'stripe_verified' | 'booking_verified'; conversationId: string | null; amountMinor: number | null }) {
      s.addConversion({ workspaceId: ws, conversationId: e.conversationId, kind: e.kind, source: e.source, amountMinor: e.amountMinor, at: iso() });
    },
  };
}

export type Setter = ReturnType<typeof createSetter>;

// The owner approval queue (task A-2) and the one gate every Setter and Receptionist action goes through.
//
// - gate(): asks permissions.ts decide() and acts on the answer: perform now (through the injected executor), hold the
//   action for the owner, or refuse. Products call this; they never call an executor directly.
// - approvePendingAction(): the owner approves; the store moves the item out of 'pending' exactly once, then the same
//   injected executor performs the original action and the result is recorded. A second approve (or a concurrent one)
//   changes nothing and returns the item as it is. Rejected and expired items never reach the executor.
// - Two stores with one interface: Supabase (RPCs in migration 202611100001) and in-memory (tests and /tools labs).
// - Errors are PendingActionError with a safe code and a plain-English message; database text is never passed on.
//
// Known limit: if the process dies after approval and before the result is recorded, the item stays 'approved'. It is
// never performed a second time automatically; the owner sees it as approved and checks by hand.

import { decide } from './permissions';
import type { Permission, PermissionAction } from './permissions';
import { parsePendingAction } from './contracts';
import type { OperatingMode, OperatingModes, PendingAction, PendingActionPayload, PendingActionStatus, Product } from './contracts';
import type { Rpc } from './orchestrator';
import { inReplyWindow } from './meta';

/** Why gate() refused an automated Instagram or Messenger message. */
export const META_WINDOW_CLOSED = 'Meta’s 24-hour reply window has closed (or the contact has not messaged on Instagram or Messenger), so nothing was sent automatically. Reply from the Instagram or Facebook app.';

export type PendingActionErrorCode = 'invalid' | 'not_allowed' | 'not_found' | 'forbidden' | 'conflict' | 'unavailable';
export class PendingActionError extends Error {
  readonly code: PendingActionErrorCode;
  constructor(code: PendingActionErrorCode, message: string) { super(message); this.code = code; this.name = 'PendingActionError'; }
}

/** A queue item as stored: the contract shape plus what the executor and retries need. */
export type PendingActionRecord = PendingAction & {
  channelId: string | null;
  idempotencyKey: string;
  committedAt: string | null;
  /** True when the stored payload does not match the contract (only possible for rows not written through checkRequest).
   * Such an item is never performed: approving it closes it as failed. Routes should show its summary, not its payload. */
  invalid: boolean;
};

export type PendingActionRequest = {
  product: Product;
  payload: PendingActionPayload;
  /** Plain-English line for the owner, 1 to 300 characters. */
  summary: string;
  /** Unique per workspace for this one action (8 to 120 of A-Z a-z 0-9 : _ . -). A retry with the same key returns the same item. */
  idempotencyKey: string;
  contactId?: string | null;
  callId?: string | null;
  /** 5 minutes to 30 days. Default 24 hours. */
  ttlMinutes?: number;
};

/** What performing an action produced. note: plain English for the owner, at most 500 characters, no secrets. */
export type ExecutionResult = { ok: boolean; note?: string | null };
/** Performs one action for real (calendar, send, transfer). Injected so every path goes through the same check. */
/** payload is null only for take_message (performed through gate(), never held). */
export type ActionExecutor = (action: { product: Product; payload: PendingActionPayload | null; contactId: string | null; callId: string | null; channelId: string | null; pendingActionId: string | null }) => Promise<ExecutionResult>;

export type Decision = 'approve' | 'reject';
export type StoreDecision = { item: PendingActionRecord; changed: boolean };

export interface PendingActionStore {
  /** The mode in force for one product of this business. */
  mode(product: Product): Promise<OperatingMode>;
  /** Holds one action. Refused (not_allowed) unless the product is in owner_approval mode. */
  request(input: PendingActionRequest): Promise<{ item: PendingActionRecord; created: boolean }>;
  /** Newest first. Expires overdue items first. */
  list(filter?: { status?: PendingActionStatus; limit?: number }): Promise<PendingActionRecord[]>;
  /** Moves a pending item to approved or rejected, once. Past its expiry: becomes expired, changed false. */
  decide(id: string, decision: Decision, by: string, note: string | null): Promise<StoreDecision>;
  /** Records the executor's result on an approved item, once. */
  finish(id: string, ok: boolean, note: string | null): Promise<StoreDecision>;
  /** Pending items past their expiry become expired. Returns how many. */
  expire(): Promise<number>;
}

export const DEFAULT_TTL_MINUTES = 24 * 60;
const KEY = /^[A-Za-z0-9:_.-]{8,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const FAILED_NOTE = 'The action could not be completed. Nothing else was changed.';
const INVALID_NOTE = 'The held action was not valid, so it was not performed.';

const clip = (s: string | null | undefined, n: number): string | null => {
  const t = (s ?? '').trim();
  return t ? t.slice(0, n) : null;
};

/** Checks a request with the shared contract validators. Returns the cleaned request or throws PendingActionError('invalid'). */
export function checkRequest(input: unknown): Required<PendingActionRequest> {
  if (!input || typeof input !== 'object') throw new PendingActionError('invalid', 'Pending action must be an object.');
  const r = input as Record<string, unknown>;
  const ttl = r.ttlMinutes === undefined ? DEFAULT_TTL_MINUTES : r.ttlMinutes;
  if (!Number.isSafeInteger(ttl) || (ttl as number) < 5 || (ttl as number) > 43200) throw new PendingActionError('invalid', 'Expiry must be 5 minutes to 30 days.');
  if (typeof r.idempotencyKey !== 'string' || !KEY.test(r.idempotencyKey)) throw new PendingActionError('invalid', 'Idempotency key must be 8 to 120 letters, digits or : _ . -');
  // Reuse the contract's own validator (payload, product, ids, summary) on a probe item rather than repeating its rules.
  const now = Date.now();
  const probe = parsePendingAction({
    id: ZERO, workspaceId: ZERO, product: r.product, contactId: r.contactId ?? null, callId: r.callId ?? null, mode: 'owner_approval',
    payload: r.payload, summary: typeof r.summary === 'string' ? r.summary.trim() : r.summary, status: 'pending',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), decidedAt: null, decidedBy: null, note: null,
  });
  if (!probe.ok) throw new PendingActionError('invalid', probe.error.replace(/^Pending action /, ''));
  const v = probe.value;
  return { product: v.product, payload: v.payload, summary: v.summary, idempotencyKey: r.idempotencyKey, contactId: v.contactId, callId: v.callId, ttlMinutes: ttl as number };
}

// ---------------------------------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------------------------------

export type GateResult =
  | { decision: 'perform'; permission: Permission; result: ExecutionResult }
  | { decision: 'hold_for_approval'; permission: Permission; item: PendingActionRecord; created: boolean }
  | { decision: 'refuse'; permission: Permission };

/** The one way a product performs an action. take_message has no payload of its own: pass action 'take_message' and an
 * executor that records the message; it is always performed. */
export async function gate(input: {
  store: PendingActionStore;
  product: Product;
  action: PermissionAction;
  /** Required for every kind except take_message. */
  request?: Omit<PendingActionRequest, 'product'>;
  execute: ActionExecutor;
  channelId?: string | null;
  /** Meta's 24-hour reply window (task A-29): for a send or follow-up on Instagram or Messenger, when the contact last
   * messaged the business. Missing or older than 24 hours: refused, never held or performed. Automation never uses the
   * HUMAN_AGENT tag to get past the window; outside it a person replies from the Instagram or Facebook app. */
  replyWindow?: { lastInbound: string | number | null; now?: number };
}): Promise<GateResult> {
  let permission = decide(await input.store.mode(input.product), input.action);
  if (permission.decision === 'refuse') return { decision: 'refuse', permission };
  if (isMetaMessage(input.request?.payload) && !inReplyWindow(input.replyWindow?.lastInbound ?? null, input.replyWindow?.now ?? Date.now())) {
    return { decision: 'refuse', permission: { decision: 'refuse', mode: permission.mode, reason: META_WINDOW_CLOSED, say: decide('enquiry_only', input.action).say } };
  }
  if (input.action !== 'take_message') {
    if (!input.request || input.request.payload?.kind !== input.action) throw new PendingActionError('invalid', 'Action and payload kind must match.');
    checkRequest({ ...input.request, product: input.product });
  }
  if (permission.decision === 'hold_for_approval') {
    const hold = async () => {
      try {
        const held = await input.store.request({ ...input.request!, product: input.product });
        return { item: held.item, created: held.created };
      } catch (e) {
        if (e instanceof PendingActionError && e.code === 'not_allowed') return null;
        throw e;
      }
    };
    let held = await hold();
    if (!held) {
      // The mode changed between reading it and holding the action: read it once more and follow the new answer.
      permission = decide(await input.store.mode(input.product), input.action);
      if (permission.decision === 'refuse') return { decision: 'refuse', permission };
      if (permission.decision === 'hold_for_approval') {
        held = await hold();
        if (!held) {
          return { decision: 'refuse', permission: { decision: 'refuse', mode: permission.mode, reason: 'The operating mode changed while this was being held. Nothing was done.', say: decide('enquiry_only', input.action).say } };
        }
      }
    }
    if (held) return { decision: 'hold_for_approval', permission, item: held.item, created: held.created };
  }
  const r = input.request;
  const result = await runExecutor(input.execute, {
    product: input.product, payload: input.action === 'take_message' ? null : r!.payload, contactId: r?.contactId ?? null, callId: r?.callId ?? null,
    channelId: input.channelId ?? null, pendingActionId: null,
  });
  return { decision: 'perform', permission, result };
}

async function runExecutor(execute: ActionExecutor, action: Parameters<ActionExecutor>[0]): Promise<ExecutionResult> {
  try {
    const r = await execute(action);
    return { ok: r?.ok === true, note: clip(r?.note, 500) ?? (r?.ok === true ? null : FAILED_NOTE) };
  } catch {
    // The executor's error can carry provider detail; the owner gets a safe line instead.
    return { ok: false, note: FAILED_NOTE };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------------------------------------------------

export function listPendingActions(store: PendingActionStore, filter: { status?: PendingActionStatus; limit?: number } = {}) {
  return store.list(filter);
}

export type ApproveOutcome = 'performed' | 'failed' | 'rejected' | 'expired' | 'already_decided';
export type DecideResult = { outcome: ApproveOutcome; item: PendingActionRecord };

function outcomeOf(item: PendingActionRecord, changed: boolean): DecideResult {
  if (!changed) return { outcome: item.status === 'expired' ? 'expired' : 'already_decided', item };
  return { outcome: item.status === 'rejected' ? 'rejected' : item.status === 'performed' ? 'performed' : 'failed', item };
}

/** Why an approved Instagram or Messenger item was closed without sending (A-32). */
export const META_WINDOW_CLOSED_AT_APPROVAL = 'Meta’s 24-hour reply window had closed by the time this was approved (or it could not be confirmed), so nothing was sent. Reply from the Instagram or Facebook app.';
/** Added to META_WINDOW_CLOSED_AT_APPROVAL when the owner task for a closed window could not be saved (A-37). */
export const META_OWNER_TASK_FAILED = 'The reminder to reply could not be saved either.';
/** Why an approved Instagram or Messenger item for an opted-out contact was closed without sending (A-43). */
export const META_OPTED_OUT_AT_APPROVAL = 'Not sent: this contact opted out of messages. Do not contact them unless they message you again.';

/** True for an automated send or follow-up on Instagram or Messenger: these are bound by Meta's 24-hour reply window. */
export function isMetaMessage(p: PendingActionPayload | null | undefined): boolean {
  return !!p && (p.kind === 'send' || p.kind === 'follow_up') && (p.channel === 'instagram' || p.channel === 'messenger');
}

export type ApproveOptions = {
  /** Meta's 24-hour reply window, checked again when the owner approves (A-32). lastInbound: when the contact last
   * messaged the business on Instagram or Messenger (jobs.ts socialWindowCheck reads fo_social_window). Without it, or
   * when it fails, an Instagram or Messenger item is treated as outside the window: closed as failed, never performed.
   * onClosed: the owner task for a closed window (for example fo_queue_outbound); if it fails, the item still closes as failed and
   * the note adds META_OWNER_TASK_FAILED (no error details are stored).
   * optedOut (A-43): true when the contact opted out. The item then closes as failed with META_OPTED_OUT_AT_APPROVAL,
   * before the window is read and without an owner task; if it fails, the window check above decides as before. */
  replyWindow?: { lastInbound: (item: PendingActionRecord) => Promise<string | number | null>; now?: () => number; onClosed?: (item: PendingActionRecord) => Promise<void>; optedOut?: (item: PendingActionRecord) => Promise<boolean> };
};

/** Owner approves: performs the original action exactly once. A repeat returns 'already_decided' (or 'expired') with the
 * item as it is, and does not call the executor. An Instagram or Messenger item outside Meta's 24-hour window at this
 * moment is closed as failed with META_WINDOW_CLOSED_AT_APPROVAL and never reaches the executor. */
export async function approvePendingAction(store: PendingActionStore, id: string, by: string, execute: ActionExecutor, note: string | null = null, options: ApproveOptions = {}): Promise<DecideResult> {
  if (!UUID.test(id)) throw new PendingActionError('invalid', 'Pending action id must be an id.');
  const d = await store.decide(id, 'approve', by, clip(note, 500));
  if (!d.changed) return outcomeOf(d.item, false);
  const a = d.item;
  // Never perform something that does not match the contract; close it as failed so it cannot stay 'approved'.
  if (a.invalid || !parsePendingAction(a).ok) return outcomeOf((await store.finish(a.id, false, INVALID_NOTE)).item, true);
  if (isMetaMessage(a.payload)) {
    const w = options.replyWindow;
    // An opted-out contact is never messaged and gets no owner task; the note says why (A-43).
    let optedOut = false;
    if (w?.optedOut) { try { optedOut = (await w.optedOut(a)) === true; } catch { optedOut = false; } }
    if (optedOut) return outcomeOf((await store.finish(a.id, false, META_OPTED_OUT_AT_APPROVAL)).item, true);
    let last: string | number | null;
    try { last = w ? await w.lastInbound(a) : null; } catch { last = null; }
    if (!inReplyWindow(last, w?.now ? w.now() : Date.now())) {
      // The owner task may fail (storage down); the item still closes as failed, and the note says so (A-37). The
      // error itself is never stored: it could carry database details.
      let taskFailed = false;
      if (w?.onClosed) { try { await w.onClosed(a); } catch { taskFailed = true; } }
      return outcomeOf((await store.finish(a.id, false, taskFailed ? `${META_WINDOW_CLOSED_AT_APPROVAL} ${META_OWNER_TASK_FAILED}` : META_WINDOW_CLOSED_AT_APPROVAL)).item, true);
    }
  }
  const result = await runExecutor(execute, { product: a.product, payload: a.payload, contactId: a.contactId, callId: a.callId, channelId: a.channelId, pendingActionId: a.id });
  const f = await store.finish(a.id, result.ok, result.note ?? null);
  return outcomeOf(f.item, true);
}

/** Owner rejects: the action is discarded and never performed. */
export async function rejectPendingAction(store: PendingActionStore, id: string, by: string, note: string | null = null): Promise<DecideResult> {
  if (!UUID.test(id)) throw new PendingActionError('invalid', 'Pending action id must be an id.');
  const d = await store.decide(id, 'reject', by, clip(note, 500));
  return outcomeOf(d.item, d.changed);
}

export function expirePendingActions(store: PendingActionStore) {
  return store.expire();
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory store (tests and /tools labs). Same rules as the database functions.
// ---------------------------------------------------------------------------------------------------------------------

export function createMemoryPendingActionStore(options: {
  workspaceId: string;
  modes?: OperatingModes | (() => OperatingModes);
  /** User ids allowed to approve and reject. Omitted: anyone (labs). */
  owners?: string[];
  now?: () => number;
  newId?: () => string;
}): PendingActionStore & { items: PendingActionRecord[] } {
  const items: PendingActionRecord[] = [];
  const now = options.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const modes = () => (typeof options.modes === 'function' ? options.modes() : options.modes) ?? { setter: 'enquiry_only', receptionist: 'enquiry_only' };
  const newId = options.newId ?? (() => crypto.randomUUID());
  const find = (id: string) => {
    const a = items.find(x => x.id === id);
    if (!a) throw new PendingActionError('not_found', 'Action not found.');
    return a;
  };
  const expireOne = (a: PendingActionRecord) => {
    if (a.status === 'pending' && Date.parse(a.expiresAt) <= now()) { a.status = 'expired'; a.decidedAt = iso(); a.note = 'Expired before a decision.'; return true; }
    return false;
  };
  const copy = (a: PendingActionRecord): PendingActionRecord => structuredClone(a);
  return {
    items,
    async mode(product) { return modes()[product]; },
    async request(input) {
      const r = checkRequest(input);
      if (modes()[r.product] !== 'owner_approval') throw new PendingActionError('not_allowed', 'Not in owner approval mode.');
      const existing = items.find(x => x.idempotencyKey === r.idempotencyKey);
      if (existing) return { item: copy(existing), created: false };
      const t = now();
      const a: PendingActionRecord = {
        id: newId(), workspaceId: options.workspaceId, product: r.product, contactId: r.contactId, callId: r.callId, mode: 'owner_approval',
        payload: r.payload, summary: r.summary, status: 'pending', createdAt: new Date(t).toISOString(), expiresAt: new Date(t + r.ttlMinutes * 60_000).toISOString(),
        decidedAt: null, decidedBy: null, note: null, channelId: null, idempotencyKey: r.idempotencyKey, committedAt: null, invalid: false,
      };
      items.push(a);
      return { item: copy(a), created: true };
    },
    async list(filter = {}) {
      items.forEach(expireOne);
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
      return items.filter(a => !filter.status || a.status === filter.status).slice().reverse().slice(0, limit).map(copy);
    },
    // No await between the status check and the change, so two concurrent approvals cannot both change it.
    async decide(id, decision, by, note) {
      const a = find(id);
      if (options.owners && !options.owners.includes(by)) throw new PendingActionError('forbidden', 'Owner access required.');
      if (expireOne(a) || a.status !== 'pending') return { item: copy(a), changed: false };
      a.status = decision === 'approve' ? 'approved' : 'rejected';
      a.decidedAt = iso(); a.decidedBy = by; a.note = clip(note, 500);
      return { item: copy(a), changed: true };
    },
    async finish(id, ok, note) {
      const a = find(id);
      if (a.status === 'performed' || a.status === 'failed') return { item: copy(a), changed: false };
      if (a.status !== 'approved') throw new PendingActionError('conflict', 'Action is not approved.');
      a.status = ok ? 'performed' : 'failed';
      a.committedAt = ok ? iso() : null; a.note = clip(note, 500);
      return { item: copy(a), changed: true };
    },
    async expire() { return items.filter(expireOne).length; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase store. Two sessions use it: webhooks (channel key; request and mode) and the signed-in owner or member
// (list, decide, finish, expire). rpc throws Error(message) on a database error, like the other front-office modules.
// ---------------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Maps a fo_pending_actions row (to_jsonb) to the record shape, checked against the contract. A row whose only problem
 * is its payload maps with invalid: true (so it can be closed, never performed); any other problem throws 'unavailable'. */
export function rowToPendingAction(row: unknown): PendingActionRecord {
  const r = (row ?? {}) as Row;
  const t = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const ms = Date.parse(String(v));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : 'invalid';
  };
  const base = {
    id: r.id, workspaceId: r.workspace_id, product: r.product, contactId: r.contact_id ?? null, callId: r.call_id ?? null, mode: r.mode,
    payload: r.payload, summary: r.summary, status: r.status, createdAt: t(r.created_at), expiresAt: t(r.expires_at),
    decidedAt: t(r.decided_at), decidedBy: r.decided_by ?? null, note: r.note ?? null,
  };
  const extras = { channelId: typeof r.channel_id === 'string' ? r.channel_id : null, idempotencyKey: String(r.idempotency_key ?? ''), committedAt: t(r.committed_at) };
  if (extras.committedAt === 'invalid') throw new PendingActionError('unavailable', 'The approval queue returned an unexpected item.');
  const parsed = parsePendingAction(base);
  if (parsed.ok) return { ...parsed.value, ...extras, invalid: false };
  // Is the payload the only problem? Check the rest with a stand-in payload that is known to be valid.
  const rest = parsePendingAction({ ...base, payload: { kind: 'transfer', reason: '' } });
  if (!rest.ok) throw new PendingActionError('unavailable', 'The approval queue returned an unexpected item.');
  const raw = r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? r.payload : {};
  return { ...rest.value, payload: raw as PendingActionPayload, ...extras, invalid: true };
}

// Database messages that are safe to pass on, and their codes. Anything else becomes 'unavailable'.
const known: [RegExp, PendingActionErrorCode, string][] = [
  [/Not in owner approval mode/, 'not_allowed', 'Not in owner approval mode.'],
  [/Action not found|Contact not found|Call not found/, 'not_found', 'Not found.'],
  [/Owner access required|Workspace access required|Channel not recognised|permission denied/, 'forbidden', 'You do not have access to this.'],
  [/Action is not approved/, 'conflict', 'Action is not approved.'],
  [/Unknown product|Unknown action|Expiry must be|Decision must be|violates check constraint|invalid input syntax/, 'invalid', 'The action is not valid.'],
];
function safe(e: unknown): PendingActionError {
  if (e instanceof PendingActionError) return e;
  const m = e instanceof Error ? e.message : '';
  for (const [re, code, message] of known) if (re.test(m)) return new PendingActionError(code, message);
  return new PendingActionError('unavailable', 'The approval queue is not available right now.');
}
async function call<T>(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<T> {
  try { return await rpc(fn, args) as T; } catch (e) { throw safe(e); }
}

export function createSupabasePendingActionStore(options: {
  rpc: Rpc;
  /** The workspace the signed-in user works in (list, decide, finish, expire). */
  workspaceId?: string;
  /** The channel and its key (webhooks: mode, request). */
  channel?: { id: string; key: string };
}): PendingActionStore {
  const { rpc } = options;
  const ws = () => {
    if (!options.workspaceId) throw new PendingActionError('forbidden', 'You do not have access to this.');
    return options.workspaceId;
  };
  const ch = () => {
    if (!options.channel) throw new PendingActionError('forbidden', 'You do not have access to this.');
    return { channel: options.channel.id, channel_key: options.channel.key };
  };
  const decided = (r: unknown): StoreDecision => {
    const o = (r ?? {}) as Row;
    return { item: rowToPendingAction(o.item), changed: o.changed === true };
  };
  return {
    async mode(product) {
      const modes = options.channel
        ? await call<Row>(rpc, 'fo_channel_modes', ch())
        : ((await call<Row>(rpc, 'fo_get_operating_modes', { w: ws() }))?.modes as Row);
      const m = modes?.[product];
      return m === 'automatic' || m === 'owner_approval' || m === 'enquiry_only' ? m : 'enquiry_only';
    },
    async request(input) {
      const r = checkRequest(input);
      const out = await call<Row>(rpc, 'fo_request_action', {
        ...ch(), product_name: r.product, contact: r.contactId, call: r.callId, action_payload: r.payload,
        action_summary: r.summary, idem_key: r.idempotencyKey, ttl_minutes: r.ttlMinutes,
      });
      return { item: rowToPendingAction(out?.item), created: out?.created === true };
    },
    async list(filter = {}) {
      const w = ws();
      await call(rpc, 'fo_expire_actions', { w });
      const rows = await call<unknown[]>(rpc, 'fo_list_actions', { w, status_filter: filter.status ?? null, max_items: filter.limit ?? 100 });
      return (Array.isArray(rows) ? rows : []).map(rowToPendingAction);
    },
    async decide(id, decision, _by, note) {
      // decided_by is auth.uid() of the session; the by argument is only used by the in-memory store.
      const out = await call<Row>(rpc, 'fo_decide_action', { action: id, decision, decision_note: note });
      try {
        return decided(out);
      } catch (e) {
        // Approved but unreadable: close it as failed so it never stays 'approved' and is never performed.
        if (out?.changed === true && decision === 'approve') await call(rpc, 'fo_finish_action', { action: id, succeeded: false, result_note: INVALID_NOTE }).catch(() => undefined);
        throw e;
      }
    },
    async finish(id, ok, note) {
      return decided(await call(rpc, 'fo_finish_action', { action: id, succeeded: ok, result_note: note }));
    },
    async expire() {
      return Number(await call(rpc, 'fo_expire_actions', { w: ws() })) || 0;
    },
  };
}

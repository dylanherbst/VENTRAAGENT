// Lab sandbox (task A-25): the Setter Lab and the Receptionist Lab write into one sandbox workspace per signed-in user
// through the real fo_* tables (migration supabase/migrations/202611110001_front_office_lab.sql). This file is the
// typed, validated wrapper around the fo_lab_* RPCs. It never reads env and never logs: the caller passes an RPC
// function (signed-in user's Supabase client, see rpcFromClient) and, for the channel key, a server-side secret.
//
// The sandbox rule (enforced by the database, not by this file; hardened in 202611110002_front_office_lab_hardening.sql):
// a sandbox is workspaces.kind = 'lab', its only member is its owner, its only channels are kind sms/voice on
// 'lab:sms:<id>' and 'lab:voice:<id>' (no provider can deliver to them), it can never hold fo_connections, its contacts
// only take test email domains and never come from an import, reset / scenario load refuse every workspace that is not
// the caller's own sandbox, and deleting the user deletes the sandbox.
//
// What the channel key does NOT guarantee: fo_lab_ensure_sandbox accepts any 32 to 200 character key from any signed-in
// user, so a user can pick their own key (instead of labChannelKey) and write any phone numbers into THEIR OWN sandbox.
// The key never opens another workspace; the blast radius is the caller's own sandbox. Phone numbers in a sandbox are
// therefore not proven to be test numbers.
import { createHmac } from 'node:crypto';

/** Same shape as lib/front-office/orchestrator.ts Rpc: resolves with data, throws on an error. */
export type LabRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export const labProducts = ['setter', 'receptionist'] as const;
export type LabProduct = (typeof labProducts)[number];

export type LabChannel = { id: string; address: string };
export type LabSandbox = {
  workspaceId: string;
  /** true on the call that made the sandbox. */
  created: boolean;
  /** The Setter Lab uses sms, the Receptionist Lab voice. Use with the same key as ChannelAuth { channel: id, key }. */
  channels: { sms: LabChannel; voice: LabChannel };
};
/** Rows deleted (reset) or restored (load), per table. */
export type LabRowCounts = Partial<Record<'contacts' | 'calls' | 'messages' | 'events' | 'handoffs' | 'appointments' | 'jobs' | 'outbox' | 'pendingActions', number>>;
export type LabScenarioSummary = {
  id: string; product: LabProduct; name: string; revision: number; updatedAt: string;
  /** Rows in the saved snapshot. */
  contacts: number; appointments: number;
};
export type LabScenario = LabScenarioSummary & { state: Record<string, unknown>; cleared: LabRowCounts; restored: LabRowCounts };

export const LAB_SCENARIO_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.,()-]{0,79}$/;
export const LAB_STATE_MAX_BYTES = 512_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LabSandboxError extends Error {}
const fail = (message: string): never => { throw new LabSandboxError(message); };

function uuid(v: unknown, what: string): string {
  return typeof v === 'string' && UUID.test(v) ? v : fail(`${what} is not valid.`);
}
function product(v: unknown): LabProduct {
  return typeof v === 'string' && (labProducts as readonly string[]).includes(v) ? v as LabProduct : fail('Unknown lab.');
}
function scenarioName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  return LAB_SCENARIO_NAME.test(name) ? name : fail('Scenario name must be 1 to 80 letters, numbers or spaces.');
}
function revision(v: unknown): number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2_147_483_647 ? v as number : fail('Revision is not valid.');
}
function plainObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('Lab state must be an object.');
  let text = '';
  try { text = JSON.stringify(v); } catch { fail('Lab state is not plain data.'); }
  if (Buffer.byteLength(text, 'utf8') > LAB_STATE_MAX_BYTES) fail('Lab state is too large.');
  return JSON.parse(text) as Record<string, unknown>;
}
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail('Unexpected reply from the lab sandbox.');
}
function counts(v: unknown): LabRowCounts {
  const out: LabRowCounts = {};
  for (const [k, n] of Object.entries(record(v))) if (Number.isInteger(n)) (out as Record<string, number>)[k] = n as number;
  return out;
}
function summary(v: unknown): LabScenarioSummary {
  const o = record(v);
  return {
    id: uuid(o.id, 'Scenario id'), product: product(o.product), name: String(o.name), revision: revision(o.revision),
    updatedAt: String(o.updatedAt), contacts: Number(o.contacts) || 0, appointments: Number(o.appointments) || 0,
  };
}

/**
 * The lab channel key for one user: HMAC-SHA256 of the user id under a server-only secret, so every request of that
 * user derives the same key and the stored hash never churns. secret: at least 32 characters, from server env (the
 * caller reads env; this file does not). Never send the key to the browser.
 */
export function labChannelKey(secret: string, userId: string): string {
  if (typeof secret !== 'string' || secret.length < 32) fail('Lab key secret is not configured.');
  return createHmac('sha256', secret).update(`ventra-lab:${uuid(userId, 'User id')}`).digest('hex');
}

/** Make (first call) or fetch the signed-in user's sandbox. */
export async function ensureLabSandbox(rpc: LabRpc, channelKey: string): Promise<LabSandbox> {
  if (typeof channelKey !== 'string' || channelKey.length < 32 || channelKey.length > 200) fail('Channel key must be 32 to 200 characters.');
  const o = record(await rpc('fo_lab_ensure_sandbox', { channel_key: channelKey }));
  const ch = record(o.channels);
  const channel = (v: unknown): LabChannel => { const c = record(v); return { id: uuid(c.id, 'Channel id'), address: String(c.address) }; };
  return { workspaceId: uuid(o.workspace, 'Workspace id'), created: o.created === true, channels: { sms: channel(ch.sms), voice: channel(ch.voice) } };
}

/** Delete every conversation row of the sandbox (contacts, messages, events, bookings, jobs, calls, held actions). */
export async function resetLabSandbox(rpc: LabRpc, workspaceId: string): Promise<LabRowCounts> {
  return counts(await rpc('fo_lab_reset', { w: uuid(workspaceId, 'Workspace id') }));
}

/** At most this many saved scenarios per lab (enforced by fo_lab_save_scenario). */
export const LAB_SCENARIO_MAX = 20;

/** Save the lab state with a snapshot of the sandbox rows. expectedRevision 0 creates; otherwise it must match (at most LAB_SCENARIO_MAX per lab). */
export async function saveLabScenario(rpc: LabRpc, workspaceId: string, input: { product: LabProduct; name: string; state: unknown; expectedRevision: number }): Promise<LabScenarioSummary> {
  return summary(await rpc('fo_lab_save_scenario', {
    w: uuid(workspaceId, 'Workspace id'), product_name: product(input.product), scenario_name: scenarioName(input.name),
    lab_state: plainObject(input.state), expected_revision: revision(input.expectedRevision),
  }));
}

export async function listLabScenarios(rpc: LabRpc, workspaceId: string, lab: LabProduct): Promise<LabScenarioSummary[]> {
  const v = await rpc('fo_lab_list_scenarios', { w: uuid(workspaceId, 'Workspace id'), product_name: product(lab) });
  return Array.isArray(v) ? v.map(summary) : fail('Unexpected reply from the lab sandbox.');
}

/** Reset the sandbox and restore the saved rows (one transaction); returns the saved lab state. */
export async function loadLabScenario(rpc: LabRpc, workspaceId: string, lab: LabProduct, name: string): Promise<LabScenario> {
  const o = record(await rpc('fo_lab_load_scenario', { w: uuid(workspaceId, 'Workspace id'), product_name: product(lab), scenario_name: scenarioName(name) }));
  return { ...summary(o), state: record(o.state), cleared: counts(o.cleared), restored: counts(o.restored) };
}

export async function deleteLabScenario(rpc: LabRpc, workspaceId: string, lab: LabProduct, name: string, expectedRevision: number): Promise<void> {
  await rpc('fo_lab_delete_scenario', { w: uuid(workspaceId, 'Workspace id'), product_name: product(lab), scenario_name: scenarioName(name), expected_revision: revision(expectedRevision) });
}

/** The lab's operating modes, set without a revision check (sandbox only; lab settings must be saved first). */
export async function setLabModes(rpc: LabRpc, workspaceId: string, modes: { setter: string; receptionist: string }): Promise<{ setter: string; receptionist: string; revision: number }> {
  const ok = ['automatic', 'owner_approval', 'enquiry_only'];
  if (!ok.includes(modes.setter) || !ok.includes(modes.receptionist)) fail('Unknown operating mode.');
  const o = record(await rpc('fo_lab_set_modes', { w: uuid(workspaceId, 'Workspace id'), setter: modes.setter, receptionist: modes.receptionist }));
  const m = record(o.modes);
  return { setter: String(m.setter), receptionist: String(m.receptionist), revision: revision(o.revision) };
}

/** Database messages that are safe to show (raised by the fo_lab_* functions themselves). Anything else is generic. */
const SAFE = /^(Sign in required\.|Lab sandbox not found\.|Unknown lab\.|Scenario (not found|name must|was changed)|A scenario with this name|Too many saved scenarios|The sandbox holds too much|This scenario (could not|was saved)|Lab state is|Revision required\.|Unknown operating mode\.|Save the lab settings first\.|Channel key must be|The lab sandbox only accepts|Contacts cannot be imported)/;

/** Adapts a Supabase client (signed in as the lab user) to LabRpc with safe error messages. */
export function rpcFromClient(client: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> }): LabRpc {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new LabSandboxError(typeof error.message === 'string' && SAFE.test(error.message) ? error.message : 'The lab sandbox is unavailable. Please retry.');
    return data;
  };
}

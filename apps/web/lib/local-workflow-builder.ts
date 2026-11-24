import type { WorkspaceSnapshot } from './local-funnels.ts';

export const workflowStatuses = ['draft', 'ready', 'archived'] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];
export const nodeKinds = ['trigger', 'condition', 'action'] as const;
export type NodeKind = (typeof nodeKinds)[number];

/** Fixed catalogue. `phrase` completes a plain-English sentence. */
export const catalogue = {
  trigger: {
    'new-lead': { label: 'New lead captured', phrase: 'a new lead is captured' },
    'form-submitted': { label: 'Form submitted', phrase: 'a form is submitted' },
    'deal-won': { label: 'Deal moved to Won', phrase: 'a deal is moved to Won' },
    'booking-requested': { label: 'Booking requested', phrase: 'a booking is requested' },
    'payment-received': { label: 'Payment received', phrase: 'a payment is received' },
  },
  condition: {
    'lead-score-hot': { label: 'Lead score is hot', phrase: 'the lead score is hot' },
    'lead-score-warm': { label: 'Lead score is warm or hot', phrase: 'the lead score is warm or hot' },
    'consent-opted-in': { label: 'Consent is opted_in', phrase: 'consent is opted in' },
    'custom-check': { label: 'Custom check (describe in note)', phrase: 'your custom check is true' },
  },
  action: {
    'send-email': { label: 'Send email from campaign', phrase: 'send email' },
    'create-contact': { label: 'Create CRM contact', phrase: 'create a CRM contact' },
    'add-note': { label: 'Add note', phrase: 'add a note' },
    'notify-me': { label: 'Notify me', phrase: 'notify you' },
    wait: { label: 'Wait N days', phrase: 'wait' },
  },
} as const;
export const nodeTypes = (kind: NodeKind): string[] => Object.keys(catalogue[kind]);
export const isNodeType = (kind: unknown, type: unknown): boolean =>
  typeof kind === 'string' && (nodeKinds as readonly string[]).includes(kind) && typeof type === 'string' && Object.prototype.hasOwnProperty.call(catalogue[kind as NodeKind], type);
export const nodeLabel = (kind: NodeKind, type: string): string => (catalogue[kind] as Record<string, { label: string }>)[type]?.label ?? type;

export type WorkflowLinkType = 'email-campaign' | 'lead-form';
/** Which saved item type a node can point at. */
export const linkTypeForNode = (kind: NodeKind, type: string): WorkflowLinkType | null =>
  kind === 'action' && type === 'send-email' ? 'email-campaign' : kind === 'trigger' && type === 'form-submitted' ? 'lead-form' : null;
const isSendAction = (n: WorkflowNode) => n.kind === 'action' && n.type === 'send-email';

export const workflowLimit = 15;
export const nodeLimit = 20;
export const workflowNameLimit = 120;
export const nodeTitleLimit = 120;
export const nodeNoteLimit = 300;
export const waitDaysMax = 90;
const storageByteLimit = 300000;

export type Branch = 'next' | 'yes' | 'no';
export type NodeConfig = { note?: string; days?: number; linkedRef?: { type: WorkflowLinkType; id: string } };
export type WorkflowNode = { id: string; kind: NodeKind; type: string; title: string; config: NodeConfig; next?: string | null; yesNext?: string | null; noNext?: string | null };
export type Workflow = { id: string; name: string; status: WorkflowStatus; nodes: WorkflowNode[] };

export const workflowsStorageKey = (profileId: string) => `launchpad.workflow-builder.v1.${profileId}`;

function makeNode(id: string, kind: NodeKind, type: string): WorkflowNode {
  const n: WorkflowNode = { id, kind, type, title: nodeLabel(kind, type), config: {} };
  if (kind === 'condition') { n.yesNext = null; n.noNext = null; } else n.next = null;
  if (kind === 'action' && type === 'wait') n.config.days = 1;
  return n;
}
export function blankWorkflow(id: string, triggerId = `${id}-t1`): Workflow {
  return { id, name: '', status: 'draft', nodes: [makeNode(triggerId, 'trigger', 'new-lead')] };
}
export function addNode(wf: Workflow, id: string, kind: NodeKind, type: string): Workflow {
  if (!isNodeType(kind, type)) throw new Error('Choose a node from the list.');
  if (wf.nodes.length >= nodeLimit) throw new Error(`A workflow can have up to ${nodeLimit} nodes.`);
  if (wf.nodes.some(n => n.id === id)) throw new Error('Node id already exists.');
  return { ...wf, nodes: [...wf.nodes, makeNode(id, kind, type)] };
}
/** Removes a node. Links into it are rewired to what it led to (conditions: cleared) so nothing dangles. */
export function removeNode(wf: Workflow, id: string): Workflow {
  const gone = wf.nodes.find(n => n.id === id);
  if (!gone) return wf;
  const heir = gone.kind === 'condition' ? null : gone.next ?? null;
  const fix = (v: string | null | undefined) => (v === id ? (heir === id ? null : heir) : v);
  return { ...wf, nodes: wf.nodes.filter(n => n.id !== id).map(n => {
    const out = { ...n };
    if (n.kind === 'condition') { out.yesNext = fix(n.yesNext); out.noNext = fix(n.noNext); } else out.next = fix(n.next);
    return out;
  }) };
}
export function connect(wf: Workflow, fromId: string, branch: Branch, toId: string | null): Workflow {
  const from = wf.nodes.find(n => n.id === fromId);
  if (!from) throw new Error('Source node not found.');
  if ((from.kind === 'condition') !== (branch !== 'next')) throw new Error(from.kind === 'condition' ? 'A condition connects through its yes and no branches.' : 'This node has one next step.');
  if (toId !== null) {
    const to = wf.nodes.find(n => n.id === toId);
    if (!to) throw new Error('Target node not found.');
    if (to.kind === 'trigger') throw new Error('Nothing can lead into the trigger.');
    if (toId === fromId) throw new Error('A node cannot lead to itself.');
  }
  const key = branch === 'yes' ? 'yesNext' : branch === 'no' ? 'noNext' : 'next';
  return { ...wf, nodes: wf.nodes.map(n => (n.id === fromId ? { ...n, [key]: toId } : n)) };
}

const outgoing = (n: WorkflowNode): { branch: Branch; to: string }[] =>
  (n.kind === 'condition'
    ? [{ branch: 'yes' as Branch, to: n.yesNext }, { branch: 'no' as Branch, to: n.noNext }]
    : [{ branch: 'next' as Branch, to: n.next }]).filter((e): e is { branch: Branch; to: string } => typeof e.to === 'string' && e.to !== '');

export type WorkflowCheck = { problems: string[]; warnings: string[] };

function hasCycle(wf: Workflow): boolean {
  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const e of outgoing(byId.get(id)!)) if (byId.has(e.to) && visit(e.to)) return true;
    state.set(id, 2);
    return false;
  };
  return wf.nodes.some(n => visit(n.id));
}

export function validateWorkflow(wf: Workflow, snapshot?: WorkspaceSnapshot): WorkflowCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!wf || typeof wf !== 'object') return { problems: ['Workflow is not valid.'], warnings };
  if (typeof wf.id !== 'string' || !wf.id || wf.id.length > 80) problems.push('Workflow needs an id.');
  if (typeof wf.name !== 'string' || !wf.name.trim()) problems.push('Name is required.');
  else if (wf.name.length > workflowNameLimit) problems.push(`Name must be ${workflowNameLimit} characters or fewer.`);
  if (!(workflowStatuses as readonly string[]).includes(wf.status)) problems.push('Choose a status from the list.');
  if (!Array.isArray(wf.nodes)) return { problems: [...problems, 'Add a trigger.'], warnings };
  if (wf.nodes.length > nodeLimit) return { problems: [...problems, `A workflow can have up to ${nodeLimit} nodes.`], warnings };
  const ids = new Set<string>();
  let shapeOk = true;
  wf.nodes.forEach((n, i) => {
    const num = i + 1;
    if (!n || typeof n !== 'object') { problems.push(`Node ${num} is not valid.`); shapeOk = false; return; }
    if (typeof n.id !== 'string' || !n.id || n.id.length > 80) { problems.push(`Node ${num} needs an id.`); shapeOk = false; } else if (ids.has(n.id)) { problems.push('Nodes need unique ids.'); shapeOk = false; } else ids.add(n.id);
    if (!isNodeType(n.kind, n.type)) { problems.push(`Node ${num} needs a type from the list.`); shapeOk = false; return; }
    if (typeof n.title !== 'string' || !n.title.trim()) problems.push(`Node ${num} needs a title.`);
    else if (n.title.length > nodeTitleLimit) problems.push(`Node ${num} title must be ${nodeTitleLimit} characters or fewer.`);
    const c = n.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { problems.push(`Node ${num} settings are not valid.`); return; }
    if (c.note !== undefined && (typeof c.note !== 'string' || c.note.length > nodeNoteLimit)) problems.push(`Node ${num} note must be ${nodeNoteLimit} characters or fewer.`);
    const isWait = n.kind === 'action' && n.type === 'wait';
    if (c.days !== undefined && !isWait) problems.push(`Node ${num} cannot have wait days.`);
    if (isWait && (!Number.isInteger(c.days) || (c.days as number) < 0 || (c.days as number) > waitDaysMax)) problems.push(`Node ${num} wait must be a whole number of days from 0 to ${waitDaysMax}.`);
    if (c.linkedRef !== undefined) {
      const r = c.linkedRef;
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || r.id.length > 120) problems.push(`Node ${num} has an invalid link.`);
      else if (linkTypeForNode(n.kind, n.type) !== r.type) problems.push(`Node ${num} link does not match its type.`);
    }
    for (const key of ['next', 'yesNext', 'noNext'] as const) {
      const v = n[key];
      if (v !== undefined && v !== null && typeof v !== 'string') problems.push(`Node ${num} has an invalid connection.`);
      const allowed = n.kind === 'condition' ? key !== 'next' : key === 'next';
      if (!allowed && v !== undefined && v !== null) problems.push(`Node ${num} has a connection it cannot use.`);
    }
  });
  const triggers = wf.nodes.filter(n => n && n.kind === 'trigger');
  if (triggers.length === 0) problems.push('Add a trigger.');
  else if (triggers.length > 1) problems.push('A workflow can have only one trigger.');
  if (!shapeOk) return { problems, warnings };
  for (const n of wf.nodes) for (const e of outgoing(n)) {
    if (!ids.has(e.to)) problems.push(`"${n.title}" leads to a node that does not exist.`);
    else if (wf.nodes.find(x => x.id === e.to)?.kind === 'trigger') problems.push('Nothing can lead into the trigger.');
  }
  if (problems.length) return { problems, warnings };
  if (hasCycle(wf)) { problems.push('The flow loops back on itself. Remove one connection to break the loop.'); return { problems, warnings }; }

  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  const reached = new Set<string>();
  const unguarded = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string, guarded: boolean) => {
    const key = `${id}|${guarded}`;
    if (seen.has(key)) return;
    seen.add(key); reached.add(id);
    const n = byId.get(id)!;
    if (!guarded && isSendAction(n)) unguarded.add(id);
    for (const e of outgoing(n)) walk(e.to, guarded || (n.kind === 'condition' && n.type === 'consent-opted-in' && e.branch === 'yes'));
  };
  walk(triggers[0].id, false);
  for (const n of wf.nodes) {
    if (!reached.has(n.id)) warnings.push(`"${n.title}" is not connected to the trigger, so it would never be reached.`);
    if (n.kind === 'condition' && (!n.yesNext || !n.noNext)) warnings.push(`"${n.title}" is missing its ${!n.yesNext && !n.noNext ? 'yes and no branches' : !n.yesNext ? 'yes branch' : 'no branch'}.`);
    if (unguarded.has(n.id)) warnings.push(`"${n.title}" can send email without checking that consent is opted_in first.`);
    if (isSendAction(n) && !n.config.linkedRef) warnings.push(`"${n.title}" is not linked to an email campaign.`);
    if (snapshot && n.config.linkedRef) {
      const list = snapshot[n.config.linkedRef.type as keyof WorkspaceSnapshot];
      if (!list || !list.some(x => x.id === n.config.linkedRef?.id)) warnings.push(`"${n.title}" links to something that no longer exists or cannot be read.`);
    }
  }
  return { problems, warnings };
}

export type Layout = { layers: string[][]; positions: Record<string, { layer: number; column: number }> };
/** Deterministic: layer = longest distance from a start node (no incoming links); column = order in the nodes list. */
export function topologicalLayout(wf: Workflow): Layout {
  const ids = new Set(wf.nodes.map(n => n.id));
  const incoming = new Map<string, number>(wf.nodes.map(n => [n.id, 0]));
  for (const n of wf.nodes) for (const e of outgoing(n)) if (ids.has(e.to)) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  const queue = wf.nodes.filter(n => incoming.get(n.id) === 0).map(n => n.id);
  queue.forEach(id => depth.set(id, 0));
  const remaining = new Map(incoming);
  for (let i = 0; i < queue.length; i++) {
    const n = wf.nodes.find(x => x.id === queue[i])!;
    for (const e of outgoing(n)) {
      if (!ids.has(e.to)) continue;
      depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(queue[i]) ?? 0) + 1));
      remaining.set(e.to, (remaining.get(e.to) ?? 0) - 1);
      if (remaining.get(e.to) === 0) queue.push(e.to);
    }
  }
  const last = Math.max(-1, ...depth.values());
  for (const n of wf.nodes) if (!depth.has(n.id)) depth.set(n.id, last + 1); // nodes inside a loop
  const layers: string[][] = [];
  const positions: Layout['positions'] = {};
  for (const n of wf.nodes) {
    const layer = depth.get(n.id)!;
    while (layers.length <= layer) layers.push([]);
    positions[n.id] = { layer, column: layers[layer].length };
    layers[layer].push(n.id);
  }
  return { layers: layers.filter(l => l.length), positions };
}

const pathLimit = 50;
/** One plain-English sentence per path that ends in a finished step. Pass labelOf to name linked items. */
export function pathSummary(wf: Workflow, labelOf?: (ref: { type: string; id: string }) => string | undefined): string[] {
  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  const trigger = wf.nodes.find(n => n.kind === 'trigger');
  if (!trigger) return [];
  const phrase = (n: WorkflowNode, negate = false): string => {
    const base = (catalogue[n.kind] as Record<string, { phrase: string }>)[n.type].phrase;
    if (n.kind === 'condition') { const p = n.type === 'custom-check' && n.config.note?.trim() ? n.config.note.trim() : base; return negate ? `it is not true that ${p}` : p; }
    if (n.kind === 'action' && n.type === 'wait') return `wait ${n.config.days ?? 0} day${n.config.days === 1 ? '' : 's'}`;
    if (n.kind === 'action' && n.type === 'send-email') {
      const ref = n.config.linkedRef;
      return ref ? `send email from campaign ${labelOf?.(ref) ?? 'X'}` : 'send an email (no campaign linked yet)';
    }
    return n.config.note?.trim() && n.type === 'add-note' ? `add the note "${n.config.note.trim()}"` : base;
  };
  const out: string[] = [];
  const walk = (n: WorkflowNode, parts: string[], onPath: Set<string>) => {
    if (out.length >= pathLimit) return;
    const edges = outgoing(n).filter(e => byId.has(e.to) && !onPath.has(e.to));
    const complete = n.kind !== 'condition' && edges.length === 0;
    if (complete) { out.push(sentence(parts)); return; }
    for (const e of edges) {
      const to = byId.get(e.to)!;
      const step = to.kind === 'condition' ? `if ${phrase(to)}` : phrase(to);
      const nextOn = new Set(onPath).add(to.id);
      // The branch just taken decides the wording for the condition that precedes it.
      const taken = parts.slice();
      if (n.kind === 'condition' && e.branch === 'no') taken[taken.length - 1] = `if ${phrase(n, true)}`;
      walk(to, [...taken, step], nextOn);
    }
  };
  const sentence = (parts: string[]) => {
    const [first, ...rest] = parts;
    if (!rest.length) return `${first}, nothing else happens yet.`;
    return `${first}, ${rest.map(p => (p.startsWith('if ') ? p : `then ${p}`)).join(', ')}.`;
  };
  const start = `When ${phrase(trigger)}`;
  walk(trigger, [start], new Set([trigger.id]));
  return out;
}

function clean(w: Workflow): Workflow {
  return {
    id: w.id, name: w.name.trim(), status: w.status,
    nodes: w.nodes.map(n => {
      const config: NodeConfig = {};
      if (n.config.note) config.note = n.config.note;
      if (n.config.days !== undefined) config.days = n.config.days;
      if (n.config.linkedRef) config.linkedRef = { type: n.config.linkedRef.type, id: n.config.linkedRef.id };
      const out: WorkflowNode = { id: n.id, kind: n.kind, type: n.type, title: n.title.trim(), config };
      if (n.kind === 'condition') { out.yesNext = n.yesNext ?? null; out.noNext = n.noNext ?? null; } else out.next = n.next ?? null;
      return out;
    }),
  };
}

export function saveWorkflow(list: readonly Workflow[], wf: Workflow): Workflow[] {
  const { problems } = validateWorkflow(wf);
  if (problems.length) throw new Error(problems[0]);
  const next = clean(wf);
  const exists = list.some(w => w.id === next.id);
  if (!exists && list.length >= workflowLimit) throw new Error(`This browser supports up to ${workflowLimit} workflows.`);
  return exists ? list.map(w => (w.id === next.id ? next : w)) : [...list, next];
}
export const removeWorkflow = (list: readonly Workflow[], id: string): Workflow[] => list.filter(w => w.id !== id);

export function restoreWorkflows(raw: string | null, profileId: string): Workflow[] {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return [];
  if (raw.length > storageByteLimit) throw new Error('Saved workflows are too large. Nothing was overwritten.');
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('Saved workflows are not valid. Nothing was overwritten.'); }
  if (!Array.isArray(values) || values.length > workflowLimit) throw new Error('Invalid saved workflows. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const w = value as Workflow;
    if (!w || typeof w !== 'object' || Array.isArray(w) || validateWorkflow(w).problems.length) throw new Error('Invalid saved workflow. Nothing was overwritten.');
    if (ids.has(w.id)) throw new Error('Duplicate workflow IDs. Nothing was overwritten.');
    ids.add(w.id);
    return clean(w);
  });
}

/** Writes the full list only if browser storage still holds exactly what this editor last read. */
export function persistWorkflows(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, list: readonly Workflow[]): string {
  const key = workflowsStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Workflows changed in another tab. Your unsaved changes remain; copy them before reloading.');
  const raw = JSON.stringify(restoreWorkflows(JSON.stringify(list), profileId));
  if (raw.length > storageByteLimit) throw new Error('Workflow storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addNode, blankWorkflow, connect, linkTypeForNode, nodeLabel, nodeLimit, nodeNoteLimit, nodeTitleLimit, nodeTypes, pathSummary, persistWorkflows, removeNode, removeWorkflow, restoreWorkflows, saveWorkflow, topologicalLayout, validateWorkflow, waitDaysMax, workflowLimit, workflowNameLimit, workflowStatuses, workflowsStorageKey } from '../../lib/local-workflow-builder';
import type { Branch, NodeKind, Workflow, WorkflowNode, WorkflowStatus } from '../../lib/local-workflow-builder';
import { emptySnapshot, readWorkspaceSnapshot } from '../../lib/local-funnels';
import type { WorkspaceSnapshot } from '../../lib/local-funnels';
import type { Profile } from '../../lib/onboarding';

const statusLabel: Record<WorkflowStatus, string> = { draft: 'Draft', ready: 'Ready', archived: 'Archived' };
const kindLabel: Record<NodeKind, string> = { trigger: 'Trigger', condition: 'Condition', action: 'Action' };
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const box: React.CSSProperties = { border: '1px solid currentColor', borderRadius: 8, padding: '6px 10px', minWidth: 140, textAlign: 'center' };

function Diagram({ workflow }: { workflow: Workflow }) {
  const layout = topologicalLayout(workflow);
  const byId = new Map(workflow.nodes.map(n => [n.id, n]));
  const title = (id?: string | null) => (id ? byId.get(id)?.title || '(untitled)' : 'not connected');
  return <div data-testid="workflow-diagram" role="img" aria-label="Workflow diagram">
    {layout.layers.map((layer, i) => <div key={i}>
      {i > 0 && <p aria-hidden="true" style={{ textAlign: 'center', margin: '4px 0' }}>↓</p>}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {layer.map(id => { const n = byId.get(id)!; return <div key={id} style={box} data-testid="workflow-node-box">
          <span className="status-badge">{kindLabel[n.kind]}</span>
          <div><strong>{n.title || '(untitled)'}</strong></div>
          {n.kind === 'condition'
            ? <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}><small>Yes → {title(n.yesNext)}</small><small>No → {title(n.noNext)}</small></div>
            : <small>Then → {title(n.next)}</small>}
        </div>; })}
      </div>
    </div>)}
  </div>;
}

export default function WorkflowBuilder({ profile }: { profile: Pick<Profile, 'id'> }) {
  const profileId = profile.id;
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot());
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pick, setPick] = useState<Record<NodeKind, string>>({ trigger: 'new-lead', condition: 'lead-score-hot', action: 'send-email' });
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    setSnapshot(readWorkspaceSnapshot(window.localStorage, profileId));
    try {
      const raw = window.localStorage.getItem(workflowsStorageKey(profileId));
      setWorkflows(restoreWorkflows(raw, profileId));
      rawRef.current = raw; setWritable(true); setError('');
    } catch (e) {
      setWorkflows([]); setWritable(false);
      setError(e instanceof Error ? e.message : 'Saved workflows could not be read. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  const check = useMemo(() => (editing ? validateWorkflow(editing, snapshot) : { problems: [], warnings: [] }), [editing, snapshot]);
  const labelOf = (ref: { type: string; id: string }) => (snapshot[ref.type as keyof WorkspaceSnapshot] ?? []).find(x => x.id === ref.id)?.label;
  const summary = useMemo(() => (editing && !check.problems.length ? pathSummary(editing, labelOf) : []), [editing, check, snapshot]);

  function commit(next: Workflow[], message: string) {
    try { rawRef.current = persistWorkflows(window.localStorage, profileId, rawRef.current, next); setWorkflows(next); setError(''); setStatus(message); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); return false; }
  }
  function save() {
    if (!editing) return;
    try { if (commit(saveWorkflow(workflows, editing), 'Workflow saved in this browser.')) setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Workflow is not valid.'); }
  }
  function edit(fn: (w: Workflow) => Workflow) { if (!editing) return; try { setEditing(fn(editing)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'That change is not allowed.'); } }
  const patchNode = (id: string, patch: Partial<WorkflowNode>) => edit(w => ({ ...w, nodes: w.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) }));
  const patchConfig = (n: WorkflowNode, patch: Partial<WorkflowNode['config']>) => patchNode(n.id, { config: { ...n.config, ...patch } });

  function targetSelect(w: Workflow, n: WorkflowNode, branch: Branch, label: string) {
    const current = branch === 'yes' ? n.yesNext : branch === 'no' ? n.noNext : n.next;
    return <label>{label}<select value={current ?? ''} data-testid={`workflow-connect-${branch}`} onChange={e => edit(x => connect(x, n.id, branch, e.target.value || null))}>
      <option value="">(nothing)</option>
      {w.nodes.filter(o => o.id !== n.id && o.kind !== 'trigger').map(o => <option key={o.id} value={o.id}>{o.title || '(untitled)'}</option>)}
    </select></label>;
  }

  if (!ready) return <p role="status">Loading workflows…</p>;
  return <section aria-labelledby="workflow-title" data-testid="workflow-builder">
    <div className="section-heading">
      <h2 id="workflow-title">Workflow builder</h2>
      <span className="status-badge">Browser draft · design only · nothing runs</span>
    </div>
    <p className="panel-note">Design an automation as a trigger, conditions and actions. This is a plan only: no trigger is connected, nothing is sent and nothing executes.</p>
    {status && <p role="status" className="activity-status" data-testid="workflow-status">{status}</p>}
    {error && <p role="alert" className="error" data-testid="workflow-error">{error}</p>}
    <p data-testid="workflow-counts">{workflows.length} of {workflowLimit} workflows</p>
    {!editing && <button type="button" className="primary-button" disabled={!writable} data-testid="workflow-add" onClick={() => { setEditing(blankWorkflow(newId(), newId())); setStatus(''); }}>Add workflow</button>}
    {editing && <form data-testid="workflow-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <fieldset>
        <legend>{workflows.some(w => w.id === editing.id) ? 'Edit workflow' : 'New workflow'}</legend>
        <label>Name<input value={editing.name} maxLength={workflowNameLimit} data-testid="workflow-name" onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
        <label>Status<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as WorkflowStatus })}>{workflowStatuses.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
        <h3>Add a step ({editing.nodes.length} of {nodeLimit})</h3>
        {(['trigger', 'condition', 'action'] as NodeKind[]).map(kind => <span key={kind}>
          <label>{kindLabel[kind]}<select value={pick[kind]} data-testid={`workflow-pick-${kind}`} onChange={e => setPick({ ...pick, [kind]: e.target.value })}>{nodeTypes(kind).map(t => <option key={t} value={t}>{nodeLabel(kind, t)}</option>)}</select></label>
          <button type="button" disabled={editing.nodes.length >= nodeLimit} data-testid={`workflow-add-${kind}`} onClick={() => edit(w => addNode(w, newId(), kind, pick[kind]))}>Add {kind}</button>
        </span>)}
        {editing.nodes.map((n, i) => {
          const lt = linkTypeForNode(n.kind, n.type);
          const options = lt ? snapshot[lt] : [];
          const missing = !!n.config.linkedRef && !(options ?? []).some(o => o.id === n.config.linkedRef?.id);
          return <fieldset key={n.id} data-testid="workflow-node">
            <legend>{i + 1}. {kindLabel[n.kind]}: {nodeLabel(n.kind, n.type)}</legend>
            <label>Title<input value={n.title} maxLength={nodeTitleLimit} data-testid="workflow-node-title" onChange={e => patchNode(n.id, { title: e.target.value })} /></label>
            <label>Note<input value={n.config.note ?? ''} maxLength={nodeNoteLimit} onChange={e => patchConfig(n, { note: e.target.value || undefined })} /></label>
            {n.kind === 'action' && n.type === 'wait' && <label>Wait (days, 0 to {waitDaysMax})<input type="number" min={0} max={waitDaysMax} step={1} value={n.config.days ?? ''} data-testid="workflow-node-days" onChange={e => patchConfig(n, { days: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
            {lt && <>
              {options === null && <p className="panel-note">Saved items of this type could not be read.</p>}
              {options !== null && options.length === 0 && <p className="panel-note">Nothing saved of this type yet. You can still plan the step.</p>}
              <label>Link to a saved item<select value={n.config.linkedRef?.id ?? ''} data-testid="workflow-node-link" onChange={e => patchConfig(n, { linkedRef: e.target.value ? { type: lt, id: e.target.value } : undefined })}>
                <option value="">Not linked</option>
                {missing && n.config.linkedRef && <option value={n.config.linkedRef.id}>(missing item)</option>}
                {(options ?? []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select></label>
            </>}
            {n.kind === 'condition' ? <>{targetSelect(editing, n, 'yes', 'If yes, then go to…')}{targetSelect(editing, n, 'no', 'If no, then go to…')}</> : targetSelect(editing, n, 'next', 'Then go to…')}
            <button type="button" onClick={() => edit(w => removeNode(w, n.id))}>Delete step {i + 1}</button>
          </fieldset>;
        })}
        <h3>Flow</h3>
        <Diagram workflow={editing} />
        <h3>In plain English</h3>
        {summary.length ? <ul data-testid="workflow-summary">{summary.map(s => <li key={s}>{s}</li>)}</ul> : <p className="panel-note">{check.problems.length ? 'Fix the items below to see the summary.' : 'Nothing to summarise yet.'}</p>}
        {check.problems.length > 0 && <ul role="status" data-testid="workflow-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
        {check.warnings.length > 0 && <ul className="panel-note" data-testid="workflow-warnings">{check.warnings.map(w => <li key={w}>Note: {w}</li>)}</ul>}
        <button type="submit" className="primary-button" disabled={!writable || check.problems.length > 0} data-testid="workflow-save">Save workflow</button>
        <button type="button" onClick={() => setEditing(null)}>Cancel</button>
      </fieldset>
    </form>}
    {workflows.length === 0 && <p className="panel-note" data-testid="workflow-empty">No workflows yet. Add your first one above.</p>}
    <ul className="local-offer-list">{workflows.map(w => <li key={w.id} className="local-offer" data-testid="workflow-item">
      <strong>{w.name}</strong> <span className="status-badge">{statusLabel[w.status]}</span> <span className="panel-note">Browser draft · design only · nothing runs</span>
      <Diagram workflow={w} />
      <ul>{pathSummary(w, labelOf).map(s => <li key={s}>{s}</li>)}</ul>
      <button type="button" disabled={!writable} onClick={() => { setEditing(JSON.parse(JSON.stringify(w)) as Workflow); setStatus(''); }}>Edit</button>
      <button type="button" disabled={!writable} onClick={() => { if (window.confirm('Delete this workflow draft?')) commit(removeWorkflow(workflows, w.id), 'Workflow deleted.'); }}>Delete</button>
    </li>)}</ul>
  </section>;
}

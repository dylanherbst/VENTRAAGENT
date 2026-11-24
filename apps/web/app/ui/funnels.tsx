'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blankFunnel, blankStep, funnelLimit, funnelNameLimit, funnelStatuses, funnelsStorageKey, goalLimit, linkTypeForKind, moveStep, persistFunnels, readWorkspaceSnapshot, emptySnapshot, removeFunnel, resolveLinks, restoreFunnels, saveFunnel, stepKinds, stepLimit, stepNoteLimit, stepTitleLimit, validateFunnel } from '../../lib/local-funnels';
import type { Funnel, FunnelStatus, FunnelStep, StepKind, WorkspaceSnapshot } from '../../lib/local-funnels';
import type { Profile } from '../../lib/onboarding';

const statusLabel: Record<FunnelStatus, string> = { draft: 'Draft', ready: 'Ready', archived: 'Archived' };
const kindLabel: Record<StepKind, string> = { traffic: 'Traffic source', 'lead-form': 'Lead capture form', email: 'Email nurture', offer: 'Offer / checkout', storefront: 'Storefront', 'link-in-bio': 'Link in bio', page: 'Website page', 'thank-you': 'Thank you', other: 'Other' };
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function Flow({ funnel, snapshot }: { funnel: Funnel; snapshot: WorkspaceSnapshot }) {
  const links = resolveLinks(funnel, snapshot);
  return <ol data-testid="funnels-flow" aria-label="Funnel flow">{funnel.steps.map((s, i) => <li key={s.id}>
    <strong>{s.title || '(untitled)'}</strong> <span className="status-badge">{kindLabel[s.kind]}</span>
    {links[i].linked && <span className="panel-note"> {links[i].found ? `Linked: ${links[i].label}` : `Link problem: ${links[i].label}`}</span>}
    {s.note && <p className="panel-note">{s.note}</p>}
    {i < funnel.steps.length - 1 && <p aria-hidden="true">↓</p>}
  </li>)}</ol>;
}

export default function Funnels({ profile }: { profile: Pick<Profile, 'id'> }) {
  const profileId = profile.id;
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [editing, setEditing] = useState<Funnel | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot());
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    setSnapshot(readWorkspaceSnapshot(window.localStorage, profileId));
    try {
      const raw = window.localStorage.getItem(funnelsStorageKey(profileId));
      setFunnels(restoreFunnels(raw, profileId));
      rawRef.current = raw;
      setWritable(true);
      setError('');
    } catch (e) {
      setFunnels([]);
      setWritable(false);
      setError(e instanceof Error ? e.message : 'Saved funnels could not be read. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  const check = useMemo(() => (editing ? validateFunnel(editing, snapshot) : { problems: [], warnings: [] }), [editing, snapshot]);

  function commit(next: Funnel[], message: string) {
    try {
      rawRef.current = persistFunnels(window.localStorage, profileId, rawRef.current, next);
      setFunnels(next); setError(''); setStatus(message); return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); return false;
    }
  }
  function save() {
    if (!editing) return;
    try { if (commit(saveFunnel(funnels, editing), 'Funnel saved in this browser.')) setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Funnel is not valid.'); }
  }
  function remove(id: string) {
    if (!window.confirm('Delete this funnel draft?')) return;
    commit(removeFunnel(funnels, id), 'Funnel deleted.');
  }
  const patchStep = (id: string, patch: Partial<FunnelStep>) => editing && setEditing({ ...editing, steps: editing.steps.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  function changeKind(s: FunnelStep, kind: StepKind) {
    patchStep(s.id, { kind, linkedRef: undefined });
  }

  if (!ready) return <p role="status">Loading funnels…</p>;
  return <section aria-labelledby="funnels-title" data-testid="funnels">
    <div className="section-heading">
      <h2 id="funnels-title">Funnel drafts</h2>
      <span className="status-badge">Browser draft · planning only · nothing runs</span>
    </div>
    <p className="panel-note">Lay out the steps a customer might take and link each step to something you have already saved. Nothing is published, sent or tracked, and no numbers are measured.</p>
    {status && <p role="status" className="activity-status" data-testid="funnels-status">{status}</p>}
    {error && <p role="alert" className="error" data-testid="funnels-error">{error}</p>}
    <p data-testid="funnels-counts">{funnels.length} of {funnelLimit} funnels</p>
    {!editing && <button type="button" className="primary-button" disabled={!writable} data-testid="funnels-add" onClick={() => { setEditing(blankFunnel(newId(), newId())); setStatus(''); }}>Add funnel</button>}
    {editing && <form data-testid="funnels-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <fieldset>
        <legend>{funnels.some(f => f.id === editing.id) ? 'Edit funnel' : 'New funnel'}</legend>
        <label>Name<input value={editing.name} maxLength={funnelNameLimit} data-testid="funnels-name" onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
        <label>Goal<textarea rows={2} value={editing.goal} maxLength={goalLimit} data-testid="funnels-goal" onChange={e => setEditing({ ...editing, goal: e.target.value })} /></label>
        <label>Status<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as FunnelStatus })}>{funnelStatuses.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
        {editing.steps.map((s, i) => {
          const lt = linkTypeForKind(s.kind);
          const options = lt ? snapshot[lt] : [];
          const missing = !!s.linkedRef && !(options ?? []).some(o => o.id === s.linkedRef?.id);
          return <fieldset key={s.id} data-testid="funnels-step">
            <legend>Step {i + 1}</legend>
            <label>Type<select value={s.kind} data-testid="funnels-step-kind" onChange={e => changeKind(s, e.target.value as StepKind)}>{stepKinds.map(k => <option key={k} value={k}>{kindLabel[k]}</option>)}</select></label>
            <label>Title<input value={s.title} maxLength={stepTitleLimit} data-testid="funnels-step-title" onChange={e => patchStep(s.id, { title: e.target.value })} /></label>
            <label>Note<input value={s.note} maxLength={stepNoteLimit} onChange={e => patchStep(s.id, { note: e.target.value })} /></label>
            {lt && <>
              {options === null && <p className="panel-note">Saved items of this type could not be read.</p>}
              {options !== null && options.length === 0 && <p className="panel-note">Nothing saved of this type yet. You can still plan the step.</p>}
              <label>Link to a saved item<select value={s.linkedRef?.id ?? ''} data-testid="funnels-step-link" onChange={e => patchStep(s.id, { linkedRef: e.target.value ? { type: lt, id: e.target.value } : undefined })}>
                <option value="">Not linked</option>
                {missing && s.linkedRef && <option value={s.linkedRef.id}>(missing item)</option>}
                {(options ?? []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select></label>
            </>}
            <button type="button" disabled={i === 0} onClick={() => setEditing(moveStep(editing, s.id, -1))}>Move up</button>
            <button type="button" disabled={i === editing.steps.length - 1} onClick={() => setEditing(moveStep(editing, s.id, 1))}>Move down</button>
            {editing.steps.length > 1 && <button type="button" onClick={() => setEditing({ ...editing, steps: editing.steps.filter(x => x.id !== s.id) })}>Remove step {i + 1}</button>}
          </fieldset>;
        })}
        <button type="button" disabled={editing.steps.length >= stepLimit} data-testid="funnels-add-step" onClick={() => setEditing({ ...editing, steps: [...editing.steps, blankStep(newId())] })}>Add step ({editing.steps.length} of {stepLimit})</button>
        <h3>Preview</h3>
        <Flow funnel={editing} snapshot={snapshot} />
        {check.problems.length > 0 && <ul role="status" data-testid="funnels-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
        {check.warnings.length > 0 && <ul className="panel-note" data-testid="funnels-warnings">{check.warnings.map(w => <li key={w}>Note: {w}</li>)}</ul>}
        <button type="submit" className="primary-button" disabled={!writable || check.problems.length > 0} data-testid="funnels-save">Save funnel</button>
        <button type="button" onClick={() => setEditing(null)}>Cancel</button>
      </fieldset>
    </form>}
    {funnels.length === 0 && <p className="panel-note" data-testid="funnels-empty">No funnels yet. Add your first one above.</p>}
    <ul className="local-offer-list">{funnels.map(f => <li key={f.id} className="local-offer" data-testid="funnels-item">
      <strong>{f.name}</strong> <span className="status-badge">{statusLabel[f.status]}</span> <span className="panel-note">Browser draft · planning only · nothing runs</span>
      {f.goal && <p className="panel-note">Goal: {f.goal}</p>}
      <Flow funnel={f} snapshot={snapshot} />
      <button type="button" disabled={!writable} onClick={() => { setEditing({ ...f, steps: f.steps.map(s => ({ ...s })) }); setStatus(''); }}>Edit</button>
      <button type="button" disabled={!writable} onClick={() => remove(f.id)}>Delete</button>
    </li>)}</ul>
  </section>;
}

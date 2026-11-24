'use client';
import { useEffect, useState } from 'react';
import { auditBusiness, defaultAssumptions, opportunityKey, restoreSavedAudit, validateAnswers } from '../../../lib/growth-opportunity';
import type { AuditAnswers } from '../../../lib/growth-opportunity';
import { restoreProfile, storageKey } from '../../../lib/onboarding';
import { auditKey } from '../../../lib/ventra-workspace';
import { opportunitySnapshot, restoreOpportunity, saveOpportunityToWorkspace } from '../../../lib/audit-sync';
import type { OpportunitySnapshot } from '../../../lib/audit-sync';
import { auditToSetterConfig } from '../../../lib/audit-to-setter';

// Sample answers are used only when this browser has no finished Growth Audit; they are never saved.
const demoAnswers: AuditAnswers = { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day', bookingPct: 40, averageValue: 50, noShowPct: 20 };
const demoBusiness = { name: 'Sample Gym', industry: 'Fitness studio', location: 'Fremantle', audience: 'Busy parents', primary: 'business' };

type Loaded = { mode: 'LIVE' | 'DEMO'; snapshot: OpportunitySnapshot; workspaceRaw: string | null; saved: OpportunitySnapshot | null };

function load(): Loaded {
  const progress = restoreSavedAudit(localStorage.getItem(opportunityKey));
  const profile = restoreProfile(localStorage.getItem(storageKey));
  const workspaceRaw = localStorage.getItem(auditKey);
  const live = !!progress && !validateAnswers(progress.answers).length;
  const answers = live ? progress.answers : demoAnswers;
  const assumptions = live ? progress.assumptions : defaultAssumptions;
  const business = auditBusiness(live ? profile : demoBusiness);
  return { mode: live ? 'LIVE' : 'DEMO', snapshot: opportunitySnapshot(business, answers, assumptions), workspaceRaw, saved: restoreOpportunity(workspaceRaw) };
}

export function SetterHandoff({ onSaved }: { onSaved: () => void }) {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  function refresh() { try { setState(load()); setError(''); } catch (e) { setError(`Saved Growth Audit cannot be read: ${(e as Error).message}`); } }
  useEffect(() => {
    // Browser storage is only readable after mount; deferring keeps the first render identical on server and client.
    const id = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(id);
  }, []);

  function save() {
    if (!state || state.mode !== 'LIVE') return;
    try {
      saveOpportunityToWorkspace(localStorage, state.workspaceRaw, opportunitySnapshot(state.snapshot.business, state.snapshot.answers, state.snapshot.assumptions));
      setStatus('Saved to the workspace audit in this browser. Use "Account copy" below to save it to your account.');
      window.dispatchEvent(new Event('ventra:updated'));
      refresh(); onSaved();
    } catch (e) { setError((e as Error).message); }
  }

  if (error) return <section aria-labelledby="handoff-title"><h2 id="handoff-title">Setter hand-off</h2><p role="alert" data-testid="handoff-error">{error}</p></section>;
  if (!state) return <section aria-labelledby="handoff-title"><h2 id="handoff-title">Setter hand-off</h2><p role="status">Loading Growth Audit…</p></section>;
  const config = auditToSetterConfig(state.snapshot);
  return <section aria-labelledby="handoff-title">
    <h2 id="handoff-title">Setter hand-off</h2>
    <p><span className="v-status" data-testid="handoff-mode">{state.mode === 'LIVE' ? 'LIVE · Your saved Growth Audit answers' : 'DEMO · Sample answers (finish the Growth Audit to use yours)'}</span></p>
    <p data-testid="workspace-state">Workspace audit: {state.saved ? `saved ${new Date(state.saved.savedAt).toLocaleString()} (${state.saved.findings.length} findings)` : 'Growth Audit result not saved yet'}</p>
    {status && <p role="status">{status}</p>}
    <h3>Findings and evidence</h3>
    {state.snapshot.findings.length ? <ol data-testid="findings">{state.snapshot.findings.map(f => <li key={f.id}><strong>{f.title}</strong> · Evidence: {f.evidence}</li>)}</ol> : <p>No findings from these answers.</p>}
    <button type="button" className="v-button" onClick={save} disabled={state.mode !== 'LIVE'}>Save Growth Audit to workspace</button>
    {state.mode !== 'LIVE' && <p className="v-note">Sample answers are never saved.</p>}
    <h3>Setter config payload (auditToSetterConfig)</h3>
    <pre data-testid="setter-payload" style={{ whiteSpace: 'pre-wrap', maxHeight: '24rem', overflow: 'auto' }}>{JSON.stringify(config, null, 2)}</pre>
  </section>;
}

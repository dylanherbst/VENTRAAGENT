'use client';
// Free Growth Audit: one question at a time, then ranked opportunities with every assumption shown and adjustable.
// Deterministic maths in lib/growth-opportunity.ts. Saved only in this browser; nothing is sent or scanned.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { aud, auditBusiness, blankAnswers, calculate, defaultAssumptions, opportunityKey, rangeText, restoreSavedAudit, speedLabels, validateAnswers, validateAssumptions } from '../../lib/growth-opportunity';
import type { AuditAnswers, Assumptions, ReplySpeed } from '../../lib/growth-opportunity';
import { opportunitySnapshot, restoreOpportunity, saveOpportunityToWorkspace } from '../../lib/audit-sync';
import type { OpportunitySnapshot } from '../../lib/audit-sync';
import { restoreProfile, storageKey } from '../../lib/onboarding';
import { auditKey } from '../../lib/ventra-workspace';
import { Badge, GlassButton, GlassCard, Icon, IconTile, PageHead, TextField } from '../design-system/liquid-glass/components';

type Step = { key: keyof AuditAnswers; title: string; help: string; example: string; unit?: string; max?: number };
const steps: Step[] = [
  { key: 'enquiriesPerMonth', title: 'How many enquiries do you get in a normal month?', help: 'Calls, messages, DMs and form enquiries together. A rough number is fine.', example: 'A busy gym might get 80 to 150.', max: 100000 },
  { key: 'missedPct', title: 'Roughly what share never get answered or called back?', help: 'Missed calls with no call back, DMs left on read, forms nobody followed up.', example: 'Many owners guess 20 to 40%.', unit: '%', max: 100 },
  { key: 'replySpeed', title: 'When you do reply, how quickly is it usually?', help: 'Think about a normal weekday, not your best day.', example: '' },
  { key: 'bookingPct', title: 'Of the people you do answer, what share book or buy?', help: 'Trials, consults, appointments or sales.', example: 'Often 25 to 50%.', unit: '%', max: 100 },
  { key: 'averageValue', title: 'What is one booking or sale worth on average?', help: 'In Australian dollars. For memberships, use the first month or the joining value.', example: 'For example 60.', unit: '$', max: 1000000 },
  { key: 'noShowPct', title: 'What share of bookings do not turn up?', help: 'Leave it at 0 if you do not know.', example: 'Often 10 to 25%.', unit: '%', max: 100 },
];

function load() { try { return restoreSavedAudit(localStorage.getItem(opportunityKey)); } catch { return null; } }
function readWorkspace(): { raw: string | null; saved: OpportunitySnapshot | null } {
  try { const raw = localStorage.getItem(auditKey); return { raw, saved: restoreOpportunity(raw) }; } catch { return { raw: null, saved: null }; }
}
const sameResult = (s: OpportunitySnapshot | null, answers: AuditAnswers, assumptions: Assumptions) =>
  !!s && JSON.stringify(s.answers) === JSON.stringify(answers) && JSON.stringify(s.assumptions) === JSON.stringify(assumptions);

type SaveState = { kind: 'idle' | 'saved' | 'conflict' | 'error'; message?: string };

export default function GrowthOpportunity({ embedded = false }: { embedded?: boolean }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AuditAnswers>(blankAnswers);
  const [assumptions, setAssumptions] = useState<Assumptions>(defaultAssumptions);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState('');
  const [storageNote, setStorageNote] = useState('');
  // The workspace audit record in this browser (shared with the manual audit and the account copy panel).
  const [workspaceRaw, setWorkspaceRaw] = useState<string | null>(null);
  const [saved, setSaved] = useState<OpportunitySnapshot | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  useEffect(() => {
    const s = load(), w = readWorkspace();
    setWorkspaceRaw(w.raw); setSaved(w.saved);
    if (s) { setStep(s.step); setAnswers(s.answers); setAssumptions(s.assumptions); }
    else if (w.saved) { setAnswers(w.saved.answers); setAssumptions(w.saved.assumptions); setStep(steps.length); }
    setRestored(true);
  }, []);

  function saveToWorkspace() {
    try {
      // The manual audit in this tab may have saved the same record since page load. That is only a conflict if the
      // calculator result inside it changed (another tab saved a different one); otherwise save on top of the fresh copy.
      const fresh = localStorage.getItem(auditKey);
      if (fresh !== workspaceRaw && JSON.stringify(restoreOpportunity(fresh)) !== JSON.stringify(saved)) { setSaveState({ kind: 'conflict' }); return; }
      const business = auditBusiness(restoreProfile(localStorage.getItem(storageKey)));
      const raw = saveOpportunityToWorkspace(localStorage, fresh, opportunitySnapshot(business, answers, assumptions));
      setWorkspaceRaw(raw); setSaved(restoreOpportunity(raw)); setSaveState({ kind: 'saved' });
      window.dispatchEvent(new Event('ventra:updated'));
    } catch (e) {
      // Fallback: writeCompared still refuses if the record changed between the read above and the write.
      const message = (e as Error).message || 'Could not save.';
      setSaveState(/another tab/i.test(message) ? { kind: 'conflict' } : { kind: 'error', message });
    }
  }
  function showSaved() {
    if (!saved) return;
    setAnswers(saved.answers); setAssumptions(saved.assumptions); setStep(steps.length); setSaveState({ kind: 'idle' });
  }
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(opportunityKey, JSON.stringify({ version: 1, step, answers, assumptions, updatedAt: new Date().toISOString() })); setStorageNote(''); window.dispatchEvent(new Event('ventra:updated')); }
    catch { setStorageNote('This browser is not saving, so your answers last for this visit only.'); }
  }, [restored, step, answers, assumptions]);

  const done = step >= steps.length;
  const current = steps[Math.min(step, steps.length - 1)];
  const set = (k: keyof AuditAnswers, v: string) => setAnswers(a => ({ ...a, [k]: k === 'replySpeed' ? v as ReplySpeed : Number(v.replace(/[^0-9.]/g, '')) || 0 }));
  function next() {
    const issue = validateAnswers(answers).find(m => m.toLowerCase().includes(current.key === 'enquiriesPerMonth' ? 'enquiries' : current.key === 'averageValue' ? 'average value' : current.key === 'missedPct' ? 'missed' : current.key === 'bookingPct' ? 'booking rate' : current.key === 'noShowPct' ? 'no-shows' : 'reply'));
    if (issue) { setError(issue); return; }
    setError(''); setStep(s => s + 1);
  }

  const head = <PageHead eyebrow="Free" title="Growth Audit" sub="Six quick questions. You will see where customers are slipping through and what it could be worth, with the maths shown." />;

  if (!done) {
    const value = answers[current.key];
    return <>
      {!embedded && head}
      <GlassCard aria-labelledby="audit-q">
        <div className="vg-card-head"><span className="vg-sample">Question {step + 1} of {steps.length}</span></div>
        <div className="vg-progress" aria-hidden="true"><span style={{ width: `${(step / steps.length) * 100}%` }} /></div>
        <h2 className="vg-q" id="audit-q">{current.title}</h2>
        <p className="vg-card-text">{current.help}</p>
        <form className="vg-q-form" onSubmit={e => { e.preventDefault(); next(); }}>
          {current.key === 'replySpeed'
            ? <div className="vg-choices" role="radiogroup" aria-labelledby="audit-q">{(Object.keys(speedLabels) as ReplySpeed[]).map(k => <button key={k} type="button" role="radio" aria-checked={answers.replySpeed === k} className="vg-choice vg-bead" onClick={() => set('replySpeed', k)}><span className="vg-choice-dot" aria-hidden="true" />{speedLabels[k]}</button>)}</div>
            : <TextField label={current.unit === '%' ? 'Percent' : current.unit === '$' ? 'Dollars (AUD)' : 'Number'} inputMode="decimal" autoFocus value={value ? String(value) : ''} placeholder="0" onChange={e => set(current.key, e.target.value)} hint={error || current.example} state={error ? 'invalid' : undefined} />}
          <div className="vg-card-actions">
            <GlassButton variant="primary" type="submit" iconRight="arrow">{step === steps.length - 1 ? 'See my results' : 'Continue'}</GlassButton>
            {step > 0 && <GlassButton type="button" icon="back" onClick={() => { setError(''); setStep(s => s - 1); }}>Back</GlassButton>}
            {current.key === 'noShowPct' && <GlassButton type="button" variant="ghost" onClick={() => { set('noShowPct', '0'); setError(''); setStep(steps.length); }}>Skip</GlassButton>}
          </div>
        </form>
        <p className="vg-footnote">Saved on this device as you go. Nothing is sent anywhere.</p>
        {saved && <GlassButton type="button" variant="ghost" size="sm" onClick={showSaved}>Show my saved result</GlassButton>}
      </GlassCard>
      {storageNote && <p className="vg-footnote" role="status">{storageNote}</p>}
    </>;
  }

  const assumptionIssues = validateAssumptions(assumptions);
  const result = calculate(answers, assumptions);
  const top = result.findings[0];
  const isSaved = saveState.kind !== 'conflict' && sameResult(saved, answers, assumptions);
  const pctField = (label: string, lo: keyof Assumptions, hi: keyof Assumptions) => <fieldset className="vg-assume"><legend>{label}</legend>
    <label>From <input type="number" min={0} max={100} value={Math.round(assumptions[lo] * 100)} onChange={e => setAssumptions(a => ({ ...a, [lo]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 }))} />%</label>
    <label>to <input type="number" min={0} max={100} value={Math.round(assumptions[hi] * 100)} onChange={e => setAssumptions(a => ({ ...a, [hi]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 }))} />%</label>
  </fieldset>;
  return <>
    {!embedded && head}
    <GlassCard promo aria-labelledby="audit-total">
      <span className="vg-promo-glow" aria-hidden="true" />
      <p className="vg-t-overline vg-eyebrow">Estimate from your answers</p>
      <h2 className="vg-promo-title" id="audit-total">{result.findings.length ? `About ${rangeText(result.total.value, aud)} a month you could be missing` : 'No clear gaps from these answers'}</h2>
      <p className="vg-promo-text">{result.findings.length ? `That is ${rangeText(result.total.bookings)} extra bookings a month across ${result.findings.length} ${result.findings.length === 1 ? 'problem' : 'problems'}. It is a range, not a promise.` : 'Nothing you entered points to missed bookings. You can still try your AI team on your own enquiries.'}</p>
      {top && <GlassButton variant="primary" href={top.href} iconRight="arrow">Fix the biggest one</GlassButton>}
    </GlassCard>
    {assumptionIssues.length > 0 && <GlassCard tight><p className="vg-notice" role="alert"><Icon name="alert" />{assumptionIssues[0]}</p></GlassCard>}
    {result.findings.map((f, i) => <GlassCard key={f.id} aria-labelledby={'f-' + f.id}>
      <div className="vg-card-head"><IconTile icon={f.id === 'missed' ? 'phone' : f.id === 'speed' ? 'chat' : 'calendar'} tone={f.id === 'missed' ? 'magenta' : f.id === 'speed' ? 'teal' : 'violet'} size="sm" /><div><h2 className="vg-card-title" id={'f-' + f.id}>{i + 1}. {f.title}</h2><Badge tone={f.confidence === 'Medium' ? 'violet' : 'neutral'}>Confidence: {f.confidence.toLowerCase()}</Badge></div></div>
      <dl className="vg-kv"><dt>Extra bookings a month</dt><dd>{rangeText(f.bookings)}</dd><dt>Estimated value a month</dt><dd>{rangeText(f.value, aud)}</dd></dl>
      <Detail label="Why we think this">{f.evidence}</Detail>
      <Detail label="What to do">{f.action}</Detail>
      <div className="vg-card-actions"><GlassButton href={f.href} iconRight="arrow">Set this up</GlassButton></div>
    </GlassCard>)}
    <GlassCard aria-labelledby="audit-basis">
      <div className="vg-card-head"><div><h2 className="vg-card-title" id="audit-basis">How this was worked out</h2><span className="vg-sample">Change any assumption and the numbers update</span></div></div>
      <ul className="vg-basis">{result.basis.map(b => <li key={b}>{b}</li>)}</ul>
      <div className="vg-assumptions">{pctField('Missed enquiries won back by an instant reply', 'recoverLow', 'recoverHigh')}{pctField('Booking rate lift from instant replies', 'speedLiftLow', 'speedLiftHigh')}{pctField('No-shows prevented by reminders', 'noShowCutLow', 'noShowCutHigh')}</div>
      <div className="vg-card-actions"><GlassButton icon="back" onClick={() => setStep(0)}>Change my answers</GlassButton><GlassButton variant="ghost" onClick={() => setAssumptions(defaultAssumptions)}>Reset assumptions</GlassButton></div>
    </GlassCard>
    <GlassCard aria-labelledby="audit-save">
      <div className="vg-card-head"><div><h2 className="vg-card-title" id="audit-save">Keep this result</h2><span className="vg-sample">Saves to your workspace in this browser only, not to your account</span></div></div>
      <p className="vg-card-text" role="status" data-testid="audit-save-state">{saveText(saveState, saved, isSaved)}</p>
      <div className="vg-card-actions">
        {saveState.kind === 'conflict'
          ? <GlassButton type="button" onClick={() => window.location.reload()}>Reload</GlassButton>
          : <GlassButton type="button" icon="check" disabled={isSaved || assumptionIssues.length > 0} onClick={saveToWorkspace}>{isSaved ? 'Saved' : 'Save to my workspace'}</GlassButton>}
        {saved && !isSaved && saveState.kind !== 'conflict' && <GlassButton type="button" variant="ghost" onClick={showSaved}>Show my saved result</GlassButton>}
      </div>
    </GlassCard>
    <p className="vg-footnote">Next: try your AI Setter with these details. <Link href="/customers/ai-team">Open your AI team</Link>.</p>
    <p className="vg-footnote">Want to write a fuller plan? <Link href="/services/growth-audit">Open the manual audit and 30-day plan</Link>.</p>
    {storageNote && <p className="vg-footnote" role="status">{storageNote}</p>}
  </>;
}

function when(iso: string) { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'earlier'; }
function saveText(s: SaveState, saved: OpportunitySnapshot | null, isSaved: boolean): string {
  if (s.kind === 'conflict') return 'Changed in another tab. Reload to see the latest, then save again.';
  if (s.kind === 'error') return `Not saved: ${s.message}`;
  if (isSaved && saved) return `Saved to your workspace in this browser on ${when(saved.savedAt)}.`;
  if (saved) return `Not saved yet. Your last saved result is from ${when(saved.savedAt)}.`;
  return 'Not saved yet.';
}

function Detail({ label, children }: { label: string; children: ReactNode }) { return <p className="vg-detail"><strong>{label}</strong>{children}</p>; }

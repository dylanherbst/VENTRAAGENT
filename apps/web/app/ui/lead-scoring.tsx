'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { contactConsentStatuses, contactSources, contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import type { Contact } from '../../lib/local-crm-contacts';
import {
  blankRuleset,
  leadPointsMax,
  leadPointsMin,
  leadRuleFields,
  leadRuleLimit,
  leadScoringStorageKey,
  leadTextLimit,
  persistRuleset,
  restoreRuleset,
  scoreAll,
  validateRuleset,
} from '../../lib/local-lead-scoring';
import type { LeadRule, LeadRuleField, LeadRuleset } from '../../lib/local-lead-scoring';

const fieldLabel: Record<LeadRuleField, string> = {
  source: 'Source is',
  consent: 'Consent is',
  hasEmail: 'Has an email',
  hasPhone: 'Has a phone number',
  noteContains: 'Notes mention',
};

function newRule(field: LeadRuleField, existing: readonly LeadRule[]): LeadRule {
  let n = existing.length + 1;
  while (existing.some(r => r.id === `rule-${n}`)) n += 1;
  const rule: LeadRule = { id: `rule-${n}`, field, points: 10 };
  if (field === 'source') rule.equals = contactSources[0];
  if (field === 'consent') rule.equals = 'opted_in';
  if (field === 'noteContains') rule.contains = '';
  return rule;
}

export default function LeadScoring({ profileId }: { profileId: string }) {
  const [ruleset, setRuleset] = useState<LeadRuleset | null>(null);
  const [saved, setSaved] = useState<LeadRuleset | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    let problem = '';
    let nextSaved: LeadRuleset | null = null;
    try {
      const raw = window.localStorage.getItem(leadScoringStorageKey(profileId));
      nextSaved = restoreRuleset(raw, profileId);
      rawRef.current = raw;
      setWritable(true);
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Saved lead scoring rules could not be read.';
      setWritable(false);
    }
    try {
      setContacts(restoreContacts(window.localStorage.getItem(contactStorageKey(profileId)), profileId));
    } catch {
      setContacts([]);
      problem = problem || 'Saved contacts could not be read. Nothing was overwritten.';
    }
    setSaved(nextSaved);
    setRuleset(nextSaved ?? blankRuleset(profileId));
    setError(problem);
    setStatus(nextSaved ? 'Saved rules restored.' : '');
    setReady(true);
  }, [profileId]);

  const validation = useMemo(() => {
    if (!ruleset) return { ok: null as LeadRuleset | null, message: '' };
    try { return { ok: validateRuleset(ruleset, profileId), message: '' }; } catch (e) { return { ok: null, message: e instanceof Error ? e.message : 'Invalid rules.' }; }
  }, [ruleset, profileId]);
  // Scores use the saved rules when valid edits are absent, so the table always reflects a valid ruleset.
  const scores = useMemo(() => {
    const active = validation.ok ?? saved;
    return active ? scoreAll(contacts, active) : [];
  }, [contacts, validation.ok, saved]);

  function update(patch: Partial<LeadRuleset>) { setRuleset(r => (r ? { ...r, ...patch } : r)); setStatus(''); }
  function updateRule(id: string, patch: Partial<LeadRule>) {
    setRuleset(r => (r ? { ...r, rules: r.rules.map(x => (x.id === id ? { ...x, ...patch } : x)) } : r)); setStatus('');
  }
  function save() {
    if (!ruleset || !validation.ok) { setError(validation.message || 'Fix the rules before saving.'); return; }
    try {
      const raw = persistRuleset(window.localStorage, profileId, rawRef.current, validation.ok);
      rawRef.current = raw;
      const next = restoreRuleset(raw, profileId);
      setSaved(next); setRuleset(next); setError(''); setStatus('Rules saved in this browser.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rules could not be saved. Your edits remain.');
    }
  }

  if (!ready || !ruleset) return <p role="status">Loading lead scoring…</p>;
  const byId = new Map(contacts.map(c => [c.id, c]));
  const counts = { hot: 0, warm: 0, cold: 0 };
  scores.forEach(s => { counts[s.label] += 1; });

  return <section className="crm-contacts" aria-labelledby="lead-scoring-title" data-testid="lead-scoring">
    <div className="section-heading">
      <h2 id="lead-scoring-title">Lead scoring</h2>
      <span className="status-badge">Browser draft · rules you write · no AI</span>
    </div>
    <p className="panel-note">Each rule adds or removes points. A contact is hot, warm or cold by its total. Contacts who have not opted in are never hot. Nothing is sent.</p>
    {status && <p role="status" className="activity-status" data-testid="lead-scoring-status">{status}</p>}
    {error && <p role="alert" className="error" data-testid="lead-scoring-error">{error}</p>}
    {validation.message && <p role="alert" className="error" data-testid="lead-scoring-validation">{validation.message}</p>}

    <fieldset disabled={!writable}>
      <legend>Scoring rules ({ruleset.rules.length} of {leadRuleLimit})</legend>
      <ul className="local-offer-list">
        {ruleset.rules.map((rule, index) => <li key={rule.id} className="local-offer" data-testid="lead-rule">
          <label>Rule {index + 1}
            <select value={rule.field} onChange={e => {
              const field = e.target.value as LeadRuleField;
              const fresh = newRule(field, []);
              updateRule(rule.id, { field, equals: fresh.equals, contains: fresh.contains });
            }}>{leadRuleFields.map(f => <option key={f} value={f}>{fieldLabel[f]}</option>)}</select>
          </label>
          {rule.field === 'source' && <label>Source<select value={rule.equals ?? ''} onChange={e => updateRule(rule.id, { equals: e.target.value })}>{contactSources.map(s => <option key={s} value={s}>{s}</option>)}</select></label>}
          {rule.field === 'consent' && <label>Consent<select value={rule.equals ?? ''} onChange={e => updateRule(rule.id, { equals: e.target.value })}>{contactConsentStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label>}
          {rule.field === 'noteContains' && <label>Text<input value={rule.contains ?? ''} maxLength={leadTextLimit} onChange={e => updateRule(rule.id, { contains: e.target.value })} /></label>}
          <label>Points<input type="number" step={1} min={leadPointsMin} max={leadPointsMax} value={rule.points} onChange={e => updateRule(rule.id, { points: e.target.valueAsNumber })} /></label>
          <button type="button" onClick={() => { setRuleset({ ...ruleset, rules: ruleset.rules.filter(x => x.id !== rule.id) }); setStatus(''); }}>Remove rule</button>
        </li>)}
      </ul>
      <button type="button" disabled={ruleset.rules.length >= leadRuleLimit} onClick={() => update({ rules: [...ruleset.rules, newRule('hasEmail', ruleset.rules)] })}>Add rule</button>
      <label>Hot at or above<input type="number" step={1} value={ruleset.hotAt} onChange={e => update({ hotAt: e.target.valueAsNumber })} /></label>
      <label>Warm at or above<input type="number" step={1} value={ruleset.warmAt} onChange={e => update({ warmAt: e.target.valueAsNumber })} /></label>
      <button type="button" className="primary-button" onClick={save} data-testid="lead-scoring-save">Save local ruleset</button>
    </fieldset>

    <h3>Scored contacts · {counts.hot} hot, {counts.warm} warm, {counts.cold} cold</h3>
    {!saved && <p className="panel-note">Showing nothing until you save rules.</p>}
    {saved && contacts.length === 0 && <p className="panel-note">No saved contacts yet. Add contacts on the Contacts tab.</p>}
    {scores.length > 0 && <table data-testid="lead-scoring-table">
      <thead><tr><th>Contact</th><th>Score</th><th>Label</th><th>Why</th></tr></thead>
      <tbody>{scores.map(s => <tr key={s.contactId}>
        <td>{byId.get(s.contactId)?.name}</td>
        <td>{s.score}</td>
        <td><span className="status-badge" data-testid="lead-label">{s.label}</span></td>
        <td>{s.reasons.length ? <ul>{s.reasons.map(r => <li key={r.ruleId}>{r.text} ({r.points > 0 ? '+' : ''}{r.points})</li>)}</ul> : 'No rules matched'}</td>
      </tr>)}</tbody>
    </table>}
  </section>;
}

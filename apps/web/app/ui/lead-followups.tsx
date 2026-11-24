'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import type { Contact } from '../../lib/local-crm-contacts';
import { addFollowUp, blankFollowUps, followUpCounts, followUpState, followupAssigneeLimit, followupLimit, followupNoteLimit, followupStorageKey, followupTitleLimit, missingContacts, persistFollowUps, removeFollowUp, restoreFollowUps, toggleFollowUp, validateFollowUps } from '../../lib/local-lead-followups';
import type { FollowUpList } from '../../lib/local-lead-followups';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `fu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const today = () => new Date().toISOString().slice(0, 10);
const stateLabel = { done: 'Done', overdue: 'Overdue', 'due-today': 'Due today', upcoming: 'Upcoming', 'no-date': 'No due date' } as const;

export default function LeadFollowUps({ profileId }: { profileId: string }) {
  const [list, setList] = useState<FollowUpList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState({ contactId: '', title: '', assignee: '', dueOn: '', note: '' });
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    let problem = '';
    try { setContacts(restoreContacts(window.localStorage.getItem(contactStorageKey(profileId)), profileId)); }
    catch (e) { problem = e instanceof Error ? e.message : 'Saved contacts could not be read.'; }
    try {
      const raw = window.localStorage.getItem(followupStorageKey(profileId));
      setList(restoreFollowUps(raw, profileId) ?? blankFollowUps(profileId));
      rawRef.current = raw; setWritable(true);
    } catch (e) {
      setList(null); setWritable(false);
      problem = e instanceof Error ? e.message : 'Saved follow-ups could not be read. Nothing was overwritten.';
    }
    setError(problem); setReady(true);
  }, [profileId]);

  const todayIso = useMemo(today, []);
  const check = useMemo(() => (list ? validateFollowUps(list) : { problems: [] }), [list]);
  const counts = useMemo(() => (list ? followUpCounts(list, todayIso) : null), [list, todayIso]);
  const orphans = useMemo(() => (list ? missingContacts(list, contacts.map(c => c.id)) : []), [list, contacts]);
  const nameOf = (id: string) => contacts.find(c => c.id === id)?.name ?? 'Contact no longer saved';

  const edit = (next: FollowUpList) => { setList(next); setDirty(true); setStatus(''); };
  function save() {
    if (!list) return;
    try {
      rawRef.current = persistFollowUps(window.localStorage, profileId, rawRef.current, list, new Date().toISOString());
      setList(restoreFollowUps(rawRef.current, profileId)); setDirty(false); setError('');
      setStatus('Follow-ups saved in this browser. Nothing was sent or scheduled.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); }
  }
  function add() {
    if (!list) return;
    if (!form.contactId) { setFormError('Choose a contact.'); return; }
    if (!form.title.trim()) { setFormError('Enter what needs doing.'); return; }
    try {
      const next = addFollowUp(list, { id: newId(), contactId: form.contactId, title: form.title, assignee: form.assignee, dueOn: form.dueOn || undefined, note: form.note });
      const p = validateFollowUps(next).problems;
      if (p.length) { setFormError(p[0]); return; }
      edit(next); setForm({ contactId: form.contactId, title: '', assignee: '', dueOn: '', note: '' }); setFormError('');
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Could not add follow-up.'); }
  }

  if (!ready) return <p role="status">Loading follow-ups…</p>;
  return <section aria-labelledby="followups-title" data-testid="lead-followups">
    <h2 id="followups-title">Lead follow-ups</h2>
    <p><span className="v-status">Browser draft · done by you · nothing is sent</span></p>
    <p>A to-do list tied to your saved contacts. VENTRA does not email, text or remind anyone; you do the follow-up and tick it off.</p>
    {status && <p role="status" data-testid="followups-status">{status}</p>}
    {error && <p role="alert" data-testid="followups-error">{error}</p>}
    {list && <>
      {contacts.length === 0 && <p data-testid="followups-no-contacts">Save a contact first (Customers). Follow-ups are tied to contacts.</p>}
      <form data-testid="followups-add-form" onSubmit={e => { e.preventDefault(); add(); }}>
        <fieldset disabled={!writable}>
          <legend>Add a follow-up</legend>
          <label>Contact<select value={form.contactId} data-testid="followups-contact" onChange={e => setForm({ ...form, contactId: e.target.value })}><option value="">Choose…</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>What to do<input value={form.title} maxLength={followupTitleLimit} data-testid="followups-title-input" onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Assigned to (optional, a name only)<input value={form.assignee} maxLength={followupAssigneeLimit} data-testid="followups-assignee" onChange={e => setForm({ ...form, assignee: e.target.value })} /></label>
          <label>Due on (optional)<input type="date" value={form.dueOn} data-testid="followups-due" onChange={e => setForm({ ...form, dueOn: e.target.value })} /></label>
          <label>Note (optional)<input value={form.note} maxLength={followupNoteLimit} data-testid="followups-note" onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          {formError && <p role="alert" data-testid="followups-form-error">{formError}</p>}
          <button type="submit" data-testid="followups-add" disabled={list.tasks.length >= followupLimit}>Add follow-up ({list.tasks.length} of {followupLimit})</button>
        </fieldset>
      </form>
      {counts && list.tasks.length > 0 && <p data-testid="followups-counts">{counts.overdue} overdue, {counts['due-today']} due today, {counts.upcoming} upcoming, {counts['no-date']} without a date, {counts.done} done.</p>}
      {orphans.length > 0 && <p role="status" data-testid="followups-orphans">{orphans.length} {orphans.length === 1 ? 'follow-up points' : 'follow-ups point'} to a contact that is no longer saved. They are kept.</p>}
      {list.tasks.length === 0 && <p data-testid="followups-empty">No follow-ups yet.</p>}
      {list.tasks.length > 0 && <ul data-testid="followups-list">{list.tasks.map(t => <li key={t.id} data-testid="followups-item">
        <label><input type="checkbox" disabled={!writable} checked={t.done} data-testid="followups-tick" onChange={() => edit(toggleFollowUp(list, t.id))} /> {t.title}</label>
        {' '}for {nameOf(t.contactId)}{t.assignee ? `, assigned to ${t.assignee}` : ''}{t.dueOn ? `, due ${t.dueOn}` : ''}{t.note ? `. ${t.note}` : ''}
        {' '}<span className="v-status" data-testid="followups-state">{stateLabel[followUpState(t, todayIso)]}</span>
        {' '}<button type="button" disabled={!writable} onClick={() => edit(removeFollowUp(list, t.id))}>Remove</button>
      </li>)}</ul>}
      {check.problems.length > 0 && <ul role="status" data-testid="followups-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <button type="button" className="v-button" data-testid="followups-save" disabled={!writable || !dirty || check.problems.length > 0} onClick={save}>Save follow-ups</button>
    </>}
  </section>;
}

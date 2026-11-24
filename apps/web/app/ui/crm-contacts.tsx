'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blankContactInput,
  contactConsentStatuses,
  contactSources,
  contactStorageKey,
  editContact,
  filterContacts,
  persistContact,
  restoreContacts,
  saveContact,
} from '../../lib/local-crm-contacts';
import type { Contact, ContactInput } from '../../lib/local-crm-contacts';

const consentLabel: Record<Contact['consentStatus'], string> = {
  unknown: 'Unknown',
  pending: 'Consent pending',
  opted_in: 'Opted in',
  opted_out: 'Opted out',
};

const sourceLabel: Record<Contact['source'], string> = {
  website: 'Website',
  referral: 'Referral',
  social: 'Social',
  event: 'Event',
  manual: 'Manual entry',
  other: 'Other',
};

export default function CrmContacts({
  profileId,
  ingestedContactsRaw = null,
}: {
  profileId: string;
  ingestedContactsRaw?: string | null;
}) {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const detailHeading=useRef<HTMLHeadingElement>(null);
  const detailOpener=useRef<HTMLButtonElement|null>(null);
  const [saved, setSaved] = useState<Contact[]>([]);
  const [input, setInput] = useState<ContactInput | null>(null);
  const [identity, setIdentity] = useState<Pick<Contact, 'id' | 'profileId'> | null>(null);
  const [search, setSearch] = useState('');
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const lastIngested = useRef<{ profileId: string; raw: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const focusCreateAfterClose = useRef(false);

  const selected=saved.find(c=>c.id===selectedId);
  useEffect(()=>{if(selectedId)detailHeading.current?.focus();else detailOpener.current?.focus();},[selectedId]);
  const visible = useMemo(() => filterContacts(saved, search), [saved, search]);

  function load() {
    try {
      const raw = window.localStorage.getItem(contactStorageKey(profileId));
      const restored = restoreContacts(raw, profileId);
      rawRef.current = raw;
      setSaved(restored);
      setWritable(true);
      setError('');
      setStatus('Saved browser contacts restored.');
    } catch {
      setWritable(false);
      setError('Saved contacts could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    setReady(true);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(contactStorageKey(profileId));
      setSaved(restoreContacts(raw, profileId));
      rawRef.current = raw;
      setWritable(true);
    } catch {
      setError('Saved contacts could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (identity) heading.current?.focus();
  }, [identity]);

  useEffect(() => {
    if (!input && !identity && focusCreateAfterClose.current) {
      focusCreateAfterClose.current = false;
      // The detail is remounted after save/cancel; return to that visible context.
      if (selectedId && detailHeading.current) detailHeading.current.focus();
      else createButton.current?.focus();
    }
  }, [input, identity, selectedId]);

  useEffect(() => {
    if (ingestedContactsRaw === null) return;
    // An editor change must not replay the previous capture over a newer manual save.
    if (lastIngested.current?.profileId === profileId && lastIngested.current.raw === ingestedContactsRaw) return;
    lastIngested.current = { profileId, raw: ingestedContactsRaw };
    try {
      const restored = restoreContacts(ingestedContactsRaw, profileId);
      rawRef.current = ingestedContactsRaw;
      setSaved(restored);
      setWritable(true);
      setError('');
      if (!input) setStatus('CRM contacts updated from lead capture preview.');
    } catch {
      if (!input) {
        setError('Lead capture saved a contact, but CRM contacts could not be refreshed. Use Reload saved contacts.');
      }
    }
  }, [ingestedContactsRaw, profileId, input]);

  function change<K extends keyof ContactInput>(key: K, value: ContactInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setError('');
  }

  function closeEditor(message: string) {
    focusCreateAfterClose.current = true;
    setInput(null);
    setIdentity(null);
    setError('');
    setStatus(message);
  }

  return (
    <section className="crm-contacts" aria-labelledby="crm-contacts-title">
      <div className="section-heading">
        <h2 id="crm-contacts-title">CRM contacts</h2>
        <span className="status-badge">Browser-local drafts · {saved.length} saved</span>
      </div>
      <p>
        Capture simple contact records for planning and follow-up. This is not a connected CRM, inbox or import tool.
      </p>
      <p className="panel-note">
        Stored only in this browser profile on this device — not your VENTRA account. No messages are sent, no imports run and no provider is connected. Anyone using this browser may see these drafts.
      </p>
      {status && <p role="status" className="activity-status">{status}</p>}
      {error && <p role="alert" className="error" id="crm-contacts-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring contact drafts…</p>
      ) : (
        <>
          <div className="setup-actions">
            <button
              ref={createButton}
              type="button"
              className="primary-button"
              disabled={!writable || !!input}
              onClick={() => {
                setInput(blankContactInput());
                setIdentity({ id: window.crypto.randomUUID(), profileId });
                setError('');
                setStatus('New unsaved contact.');
              }}
            >
              Create contact
            </button>
            <button type="button" disabled={!!input} onClick={load}>Reload saved contacts</button>
          </div>
          <label>
            Search contacts
            <input
              ref={searchField}
              type="search"
              maxLength={120}
              value={search}
              disabled={!!input}
              placeholder="Name, email or phone"
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          {!saved.length && <p>No saved contacts yet.</p>}
          {saved.length > 0 && !visible.length && <p role="status">No contacts match your search.</p>}
          {selected&&!input&&<article className="v-customer-detail v-glass" aria-labelledby="customer-detail-title"><button type="button" onClick={()=>{setSelectedId(null);detailOpener.current?.focus();}}>Back to contacts</button><h3 id="customer-detail-title" ref={detailHeading} tabIndex={-1}>{selected.name}</h3><p>{selected.email||'No email saved'} · {selected.phone||'No phone saved'}</p><dl><dt>Source</dt><dd>{sourceLabel[selected.source]}</dd><dt>Consent</dt><dd>{consentLabel[selected.consentStatus]}</dd><dt>Last local record update</dt><dd>{selected.updatedAt}</dd></dl><h4>Notes & next follow-up</h4><p className="prose">{selected.notes||'No follow-up notes saved yet.'}</p>{selected.leadFormCapture&&<details><summary>Lead capture context</summary>{selected.leadFormCapture.answers.map(a=><p key={a.questionId}>{a.label}: {a.value}</p>)}</details>}<button className="primary-button" type="button" onClick={()=>{setInput(editContact(selected));setIdentity({id:selected.id,profileId});setError('');}}>Plan follow-up / edit notes</button><p className="panel-note">Planning only. Messages, bookings, purchase history, assigned owners and AI summaries are not connected. No invented activity timeline.</p></article>}
          <ul hidden={!!selected&&!input} className="local-offer-list crm-contact-list">
            {visible.map(contact => (
              <li key={contact.id} className="local-offer">
                <h3>{contact.name}</h3>
                <p>
                  {contact.email || 'No email'} · {contact.phone || 'No phone'}
                </p>
                <p>
                  <span className="status-badge">{sourceLabel[contact.source]}</span>
                  <span className="status-badge">{consentLabel[contact.consentStatus]}</span>
                </p>
                {contact.notes && <p className="prose">{contact.notes.length > 160 ? `${contact.notes.slice(0, 160)}…` : contact.notes}</p>}
                {contact.leadFormCapture?.answers.map(answer => (
                  <p key={answer.questionId} className="prose">
                    {answer.label}: {answer.value.length > 120 ? `${answer.value.slice(0, 120)}…` : answer.value}
                  </p>
                ))}
                <button type="button" disabled={!!input} onClick={e=>{detailOpener.current=e.currentTarget;setSelectedId(contact.id);}}>Open customer details</button>
                <button
                  type="button"
                  disabled={!!input}
                  onClick={() => {
                    setInput(editContact(contact));
                    setIdentity({ id: contact.id, profileId });
                    setError('');
                    setStatus('Editing a saved contact. Changes are unsaved.');
                  }}
                >
                  Edit contact
                </button>
              </li>
            ))}
          </ul>
          {input && identity && (
            <form
              aria-describedby="crm-contacts-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const contact = saveContact(input, identity);
                  const raw = persistContact(window.localStorage, profileId, rawRef.current, contact);
                  rawRef.current = raw;
                  setSaved(restoreContacts(raw, profileId));
                  closeEditor('Contact saved in this browser. Nothing was sent or synced.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved.some(item => item.id === identity.id) ? 'Edit contact' : 'New contact'}
              </h3>
              <p id="crm-contacts-editor-note">
                Unsaved changes · Save explicitly before leaving. Refresh loses unsaved edits. Cancel discards only current changes; saved contacts remain.
              </p>
              <div className="setup-fields">
                <label>
                  Name *
                  <input required maxLength={160} value={input.name} onChange={e => change('name', e.target.value)} autoComplete="name" />
                </label>
                <label>
                  Email (optional, never sent)
                  <input type="email" maxLength={254} value={input.email} onChange={e => change('email', e.target.value)} autoComplete="email" />
                </label>
                <label>
                  Phone (optional)
                  <input type="tel" maxLength={32} value={input.phone} onChange={e => change('phone', e.target.value)} autoComplete="tel" />
                </label>
                <label>
                  Source
                  <select value={input.source} onChange={e => change('source', e.target.value as ContactInput['source'])}>
                    {contactSources.map(source => (
                      <option key={source} value={source}>{sourceLabel[source]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Consent status
                  <select value={input.consentStatus} onChange={e => change('consentStatus', e.target.value as ContactInput['consentStatus'])}>
                    {contactConsentStatuses.map(statusValue => (
                      <option key={statusValue} value={statusValue}>{consentLabel[statusValue]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Notes (optional, browser-local)
                  <textarea rows={3} maxLength={2000} value={input.notes} onChange={e => change('notes', e.target.value)} />
                </label>
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local contact</button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved contacts are unchanged.')}>
                  Cancel contact changes
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

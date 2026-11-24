'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatOfferPrice, offerCurrencies } from '../../lib/local-offers';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import type { Contact } from '../../lib/local-crm-contacts';
import {
  blankDealInput,
  contactExistsInList,
  contactNameForDeal,
  dealStages,
  missingContactSelectLabel,
  dealStorageKey,
  dealsByStage,
  editDeal,
  filterDeals,
  persistDeal,
  restoreDeals,
  saveDeal,
} from '../../lib/local-crm-pipeline';
import type { Deal, DealInput, DealStage } from '../../lib/local-crm-pipeline';

const stageLabel: Record<DealStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

type ViewMode = 'board' | 'list';

export default function CrmPipeline({ profileId }: { profileId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsReady, setContactsReady] = useState(false);
  const [saved, setSaved] = useState<Deal[]>([]);
  const [input, setInput] = useState<DealInput | null>(null);
  const [identity, setIdentity] = useState<Pick<Deal, 'id' | 'profileId'> | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('board');
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const focusCreateAfterClose = useRef(false);
  const stageFocusId = useRef<string | null>(null);

  const visible = useMemo(() => filterDeals(saved, contacts, search), [saved, contacts, search]);
  const grouped = useMemo(() => dealsByStage(visible), [visible]);
  const editingSavedDeal = identity ? saved.some(item => item.id === identity.id) : false;
  const orphanEditorContact =
    input && editingSavedDeal && input.contactId.trim() && !contactExistsInList(contacts, input.contactId)
      ? input.contactId.trim()
      : null;

  function loadContacts() {
    try {
      setContacts(restoreContacts(window.localStorage.getItem(contactStorageKey(profileId)), profileId));
    } catch {
      setContacts([]);
    }
    setContactsReady(true);
  }

  function loadDeals() {
    try {
      const raw = window.localStorage.getItem(dealStorageKey(profileId));
      const restored = restoreDeals(raw, profileId);
      rawRef.current = raw;
      setSaved(restored);
      setWritable(true);
      setError('');
      setStatus('Saved browser deals restored.');
    } catch {
      setWritable(false);
      setError('Saved deals could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    setReady(true);
  }

  useEffect(() => {
    loadContacts();
    try {
      const raw = window.localStorage.getItem(dealStorageKey(profileId));
      setSaved(restoreDeals(raw, profileId));
      rawRef.current = raw;
      setWritable(true);
    } catch {
      setError('Saved deals could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (identity) heading.current?.focus();
  }, [identity]);

  useEffect(() => {
    if (!input && !identity && focusCreateAfterClose.current) {
      focusCreateAfterClose.current = false;
      createButton.current?.focus();
    }
  }, [input, identity]);

  useEffect(() => {
    if (!stageFocusId.current) return;
    const id = stageFocusId.current;
    stageFocusId.current = null;
    const timer = window.setTimeout(() => {
      document.getElementById(`deal-stage-${id}`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function change<K extends keyof DealInput>(key: K, value: DealInput[K]) {
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

  function contactLabel(contactId: string) {
    const name = contactNameForDeal(contacts, contactId);
    return name ?? 'Missing contact (saved deal only)';
  }

  function persistStageChange(deal: Deal, stage: DealStage) {
    if (stage === deal.stage) return;
    try {
      const updated = saveDeal({ ...editDeal(deal), stage }, { id: deal.id, profileId: deal.profileId });
      const raw = persistDeal(window.localStorage, profileId, rawRef.current, updated);
      rawRef.current = raw;
      setSaved(restoreDeals(raw, profileId));
      stageFocusId.current = deal.id;
      setStatus(`Stage updated to ${stageLabel[stage]} in this browser. No sync or notification occurred.`);
      setError('');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Stage change failed. Saved deals are unchanged.');
    }
  }

  function renderDealCard(deal: Deal) {
    const missing = contactNameForDeal(contacts, deal.contactId) === null;
    const valueText =
      deal.valueMinor === null ? 'No value set' : `${deal.currency} ${formatOfferPrice(deal.valueMinor)}`;
    return (
      <article key={deal.id} className="local-offer crm-deal-card">
        <h3>{deal.title}</h3>
        <p>
          {contactLabel(deal.contactId)}
          {missing && <span className="status-badge">Contact not in saved list</span>}
        </p>
        <p>{valueText} · Demo pipeline draft</p>
        <label className="crm-deal-stage-label">
          Stage
          <select
            id={`deal-stage-${deal.id}`}
            disabled={!!input}
            value={deal.stage}
            aria-label={`Stage for ${deal.title}`}
            onChange={e => persistStageChange(deal, e.target.value as DealStage)}
          >
            {dealStages.map(stage => (
              <option key={stage} value={stage}>{stageLabel[stage]}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!!input}
          onClick={() => {
            setInput(editDeal(deal));
            setIdentity({ id: deal.id, profileId });
            setError('');
            setStatus('Editing a saved deal. Changes are unsaved.');
          }}
        >
          Edit deal
        </button>
      </article>
    );
  }

  return (
    <section className="crm-pipeline" aria-labelledby="crm-pipeline-title">
      <div className="section-heading">
        <h2 id="crm-pipeline-title">Sales pipeline</h2>
        <span className="status-badge">Browser-local demo · {saved.length} saved</span>
      </div>
      <p>
        Track simple deal stages linked to your saved CRM contacts. This is not a connected CRM, forecast or revenue report.
      </p>
      <p className="panel-note">
        Stored only in this browser profile on this device — not your VENTRA account. No payments, bookings, messages or AI actions run from here. Deals may reference contacts that were removed from the contact list.
      </p>
      {status && <p role="status" className="activity-status">{status}</p>}
      {error && <p role="alert" className="error" id="crm-pipeline-error">{error}</p>}
      {!ready || !contactsReady ? (
        <p role="status">Restoring pipeline drafts…</p>
      ) : (
        <>
          <div className="setup-actions">
            <button
              ref={createButton}
              type="button"
              className="primary-button"
              disabled={!writable || !!input || !contacts.length}
              onClick={() => {
                setInput(blankDealInput(contacts[0]?.id ?? ''));
                setIdentity({ id: window.crypto.randomUUID(), profileId });
                setError('');
                setStatus('New unsaved deal.');
              }}
            >
              Create deal
            </button>
            <button type="button" disabled={!!input} onClick={() => { loadContacts(); loadDeals(); }}>
              Reload saved deals
            </button>
            <button
              type="button"
              disabled={!!input}
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              Board view
            </button>
            <button
              type="button"
              disabled={!!input}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List by stage
            </button>
          </div>
          {!contacts.length && (
            <p role="status">Save at least one CRM contact above to create a deal linked by contact ID.</p>
          )}
          <label>
            Search deals
            <input
              type="search"
              maxLength={120}
              value={search}
              disabled={!!input}
              placeholder="Title, contact or stage"
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          {!saved.length && <p>No saved deals yet.</p>}
          {saved.length > 0 && !visible.length && <p role="status">No deals match your search.</p>}
          {view === 'board' && visible.length > 0 && (
            <div className="crm-pipeline-board" role="list">
              {dealStages.map(stage => (
                <section key={stage} className="crm-pipeline-column" aria-label={`${stageLabel[stage]} stage`}>
                  <h3>{stageLabel[stage]} <span className="subtle-label">({grouped[stage].length})</span></h3>
                  <div className="crm-pipeline-column-deals">
                    {grouped[stage].length ? grouped[stage].map(renderDealCard) : <p className="subtle-label">No deals</p>}
                  </div>
                </section>
              ))}
            </div>
          )}
          {view === 'list' && visible.length > 0 && (
            <div className="crm-pipeline-list">
              {dealStages.map(stage => (
                grouped[stage].length > 0 && (
                  <section key={stage} aria-labelledby={`pipeline-stage-${stage}`}>
                    <h3 id={`pipeline-stage-${stage}`}>{stageLabel[stage]}</h3>
                    <div className="local-offer-list">{grouped[stage].map(renderDealCard)}</div>
                  </section>
                )
              ))}
            </div>
          )}
          {input && identity && (
            <form
              aria-describedby="crm-pipeline-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const deal = saveDeal(input, identity);
                  const raw = persistDeal(window.localStorage, profileId, rawRef.current, deal);
                  rawRef.current = raw;
                  setSaved(restoreDeals(raw, profileId));
                  closeEditor('Deal saved in this browser. No payment or notification occurred.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved.some(item => item.id === identity.id) ? 'Edit deal' : 'New deal'}
              </h3>
              <p id="crm-pipeline-editor-note">
                Unsaved changes · Linked by contact ID only. Save explicitly before leaving. Refresh loses unsaved edits. Cancel discards only current changes; saved deals remain.
              </p>
              <div className="setup-fields">
                <label>
                  Deal title *
                  <input required maxLength={160} value={input.title} onChange={e => change('title', e.target.value)} />
                </label>
                <label>
                  Contact *
                  <select
                    required
                    value={input.contactId}
                    onChange={e => change('contactId', e.target.value)}
                  >
                    <option value="">Choose a saved contact</option>
                    {orphanEditorContact && (
                      <option value={orphanEditorContact}>
                        {missingContactSelectLabel(orphanEditorContact)}
                      </option>
                    )}
                    {contacts.map(contact => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </select>
                </label>
                {orphanEditorContact && (
                  <p role="status">
                    This deal still references a contact ID that is not in your saved list. Pick a saved contact to relink, or save unchanged to keep the stored ID.
                  </p>
                )}
                <label>
                  Stage *
                  <select value={input.stage} onChange={e => change('stage', e.target.value as DealStage)}>
                    {dealStages.map(stage => (
                      <option key={stage} value={stage}>{stageLabel[stage]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Value (optional, not charged)
                  <input inputMode="decimal" maxLength={18} placeholder="e.g. 2500.00" value={input.value} onChange={e => change('value', e.target.value)} />
                </label>
                <label>
                  Currency
                  <select value={input.currency} onChange={e => change('currency', e.target.value as DealInput['currency'])}>
                    {offerCurrencies.map(currency => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable || !input.contactId.trim()}>
                  Save local deal
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved deals are unchanged.')}>
                  Cancel deal changes
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerCurrencies } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import { editProposal, persistProposal, proposalFromPackage, proposalStorageKey, proposalTotal, restoreProposals, saveProposal } from '../../lib/service-proposals';
import type { Proposal, ProposalInput } from '../../lib/service-proposals';
import { LauncherAccountSync } from './launcher-account-sync';

export default function ServiceProposals({ offers, profileId }: { offers: LocalOffer[]; profileId: string }) {
  const [saved, setSaved] = useState<Proposal[]>([]);
  const [input, setInput] = useState<ProposalInput | null>(null);
  const [identity, setIdentity] = useState<Pick<Proposal, 'id' | 'profileId' | 'packageId' | 'packageName'> | null>(null);
  const [selectedPackage, setSelectedPackage] = useState('');
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<Proposal | null>(null);
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const packages = offers.filter(o => o.kind === 'service');
  function load() {
    try {
      const raw = window.localStorage.getItem(proposalStorageKey(profileId));
      const restored = restoreProposals(raw, profileId);
      rawRef.current = raw; setSaved(restored); setPreview(null); setWritable(true); setError(''); setStatus('Saved browser drafts restored.');
    } catch { setPreview(null); setWritable(false); setError('Saved proposals could not be restored or browser storage is unavailable. Nothing was overwritten.'); }
    setReady(true);
  }
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(proposalStorageKey(profileId));
      setSaved(restoreProposals(raw, profileId)); rawRef.current = raw; setWritable(true);
    } catch { setError('Saved proposals could not be restored or browser storage is unavailable. Nothing was overwritten.'); }
    setReady(true);
  }, [profileId]);
  useEffect(() => { if (identity) heading.current?.focus(); }, [identity]);
  function change<K extends keyof ProposalInput>(key: K, value: ProposalInput[K]) {
    setInput(current => current ? { ...current, [key]: value } : current); setPreview(null); setError('');
  }
  function close(message: string) { setInput(null); setIdentity(null); setPreview(null); setError(''); setStatus(message); createButton.current?.focus(); }
  return <section className="service-proposals" aria-labelledby="service-proposals-title">
    <div className="section-heading"><h2 id="service-proposals-title">Service proposals</h2><span className="status-badge">Private browser drafts · {saved.length} saved</span></div>
    <p>Choose a saved service package, tailor the scope and prepare a proposal. Package edits do not change existing proposal snapshots.</p>
    <p className="panel-note">Stored only in this browser, not your account. This is not tenant-secure storage: anyone using this browser profile may see drafts. Avoid sensitive client details. Nothing is sent, signed, invoiced or published.</p>
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="error" id="proposal-error">{error}</p>}
    {!ready ? <p role="status">Restoring proposal drafts…</p> : <>
      {!packages.length && <p>Save a service package above to create your first proposal.</p>}
      <div className="setup-actions"><label>Saved service package<select disabled={!!input} value={selectedPackage} onChange={e => setSelectedPackage(e.target.value)}><option value="">Choose a package</option>{packages.map(o => <option key={o.id} value={o.id}>{o.name} · {o.currency} {formatOfferPrice(o.amountMinor)}</option>)}</select></label>
        <button ref={createButton} type="button" disabled={!writable || !!input || !packages.some(p => p.id === selectedPackage)} onClick={() => {
          const offer = packages.find(p => p.id === selectedPackage);
          if (!offer) return;
          setInput(proposalFromPackage(offer)); setIdentity({ id: window.crypto.randomUUID(), profileId, packageId: offer.id, packageName: offer.name }); setError(''); setStatus('New unsaved proposal.'); setPreview(null);
        }}>Create proposal draft</button>
        <button type="button" disabled={!!input} onClick={load}>Reload saved drafts</button>
      </div>
      {!saved.length && <p>No saved proposals yet.</p>}
      <div className="local-offer-list">{saved.map(p => <article className="local-offer" key={p.id}><h3>{p.title}</h3><p>For {p.recipient} · {p.currency} {formatOfferPrice(proposalTotal(p.items))}</p><p>Draft only · Package snapshot: {p.packageName}</p><button type="button" disabled={!!input} onClick={() => { setInput(editProposal(p)); setIdentity({ id: p.id, profileId, packageId: p.packageId, packageName: p.packageName }); setPreview(null); setError(''); setStatus('Editing a saved proposal. Changes are unsaved.'); }}>Edit proposal</button><button type="button" disabled={!!input} onClick={() => setPreview(p)}>Preview saved proposal</button></article>)}</div>
      {input && identity && <form aria-describedby="proposal-editor-note" onSubmit={event => {
        event.preventDefault();
        try {
          const proposal = saveProposal(input, identity);
          const raw = persistProposal(window.localStorage, profileId, rawRef.current, proposal);
          rawRef.current = raw; setSaved(restoreProposals(raw, profileId)); close('Proposal saved in this browser. No delivery or payment occurred.');
        } catch (issue) { setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.'); }
      }}>
        <h3 ref={heading} tabIndex={-1}>{saved.some(p => p.id === identity.id) ? 'Edit proposal draft' : 'New proposal draft'}</h3>
        <p id="proposal-editor-note">Unsaved changes · Based on {identity.packageName}. Save explicitly before leaving. Refresh loses unsaved edits. Cancel discards only current changes; saved drafts remain.</p>
        <div className="setup-fields">
          <label>Proposal title<input required maxLength={160} value={input.title} onChange={e => change('title', e.target.value)} /></label>
          <label>Recipient name<input required maxLength={160} value={input.recipient} onChange={e => change('recipient', e.target.value)} autoComplete="off" /></label>
          <label>Recipient email (optional, never sent)<input type="email" maxLength={254} value={input.email} onChange={e => change('email', e.target.value)} autoComplete="off" /></label>
          <label>Currency<select value={input.currency} onChange={e => change('currency', e.target.value as ProposalInput['currency'])}>{offerCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
        </div>
        <p>Changing currency relabels amounts; it does not convert exchange rates. Review every line price.</p>
        <label>Scope and deliverables<textarea required maxLength={7000} rows={5} value={input.scope} onChange={e => change('scope', e.target.value)} /></label>
        <fieldset><legend>Line items · Quantity × unit price</legend>{input.items.map((item, index) => <fieldset key={index}><legend>Line {index + 1}</legend><div className="setup-fields">
          <label>Description<input required maxLength={300} value={item.description} onChange={e => change('items', input.items.map((x, i) => i === index ? { ...x, description: e.target.value } : x))} /></label>
          <label>Quantity<input required inputMode="numeric" maxLength={4} value={item.quantity} onChange={e => change('items', input.items.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x))} /></label>
          <label>Unit price<input required inputMode="decimal" maxLength={18} value={item.price} onChange={e => change('items', input.items.map((x, i) => i === index ? { ...x, price: e.target.value } : x))} /></label>
        </div><button type="button" disabled={input.items.length === 1} aria-label={`Remove line ${index + 1}`} onClick={() => change('items', input.items.filter((_, i) => i !== index))}>Remove line</button></fieldset>)}
        <button type="button" disabled={input.items.length >= 20} onClick={() => change('items', [...input.items, { description: '', quantity: '1', price: '' }])}>Add line item</button></fieldset>
        <label>Draft terms<textarea required maxLength={3000} rows={4} placeholder="Describe timing, exclusions and proposed payment terms. No contract is created." value={input.terms} onChange={e => change('terms', e.target.value)} /></label>
        <div className="setup-actions"><button className="primary-button" type="submit" disabled={!writable}>Save local proposal</button><button type="button" onClick={() => { try { setPreview(saveProposal(input, identity)); setError(''); } catch (issue) { setError((issue as Error).message); } }}>Preview unsaved proposal</button><button type="button" onClick={() => close('Changes discarded. Saved proposals are unchanged.')}>Cancel proposal changes</button></div>
      </form>}
      {preview && <article className="proposal-preview card" aria-labelledby="proposal-preview-title"><div className="section-heading"><h3 id="proposal-preview-title">{preview.title}</h3><span className="status-badge">{input ? 'Unsaved preview' : 'Saved draft preview'}</span></div><p>Prepared for {preview.recipient}{preview.email ? ` · ${preview.email}` : ''}</p><h4>Scope and deliverables</h4><p className="prose">{preview.scope}</p><div className="proposal-table"><table><caption>Proposed fees in {preview.currency} · No tax calculated</caption><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead><tbody>{preview.items.map((item, index) => <tr key={index}><th scope="row">{item.description}</th><td>{item.quantity}</td><td>{formatOfferPrice(item.amountMinor)}</td><td>{formatOfferPrice(item.quantity * item.amountMinor)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={3}>Total ({preview.currency})</th><td>{formatOfferPrice(proposalTotal(preview.items))}</td></tr></tfoot></table></div><h4>Draft terms</h4><p className="prose">{preview.terms}</p><p>Draft only. Not sent, accepted, signed or payable. No tax, invoice, contract or booking is created.</p><button type="button" onClick={() => setPreview(null)}>Close preview</button></article>}
    </>}
      <LauncherAccountSync kind="service-proposals" label="Service proposals" readLocal={() => localStorage.getItem(proposalStorageKey(profileId))} validate={raw => { restoreProposals(raw, profileId); }} onApply={raw => { localStorage.setItem(proposalStorageKey(profileId), raw); window.location.reload(); }} array />
  </section>;
}

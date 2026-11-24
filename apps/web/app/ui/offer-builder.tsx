'use client';
import { Anchor } from '../design-system/anchor';
import { useEffect, useRef, useState } from 'react';
import { blankOffer, editLocalOffer, formatOfferPrice, offerCurrencies, offerStorageKey, restoreLocalOffers, saveLocalOffer } from '../../lib/local-offers';
import type { LocalOffer, OfferDraft } from '../../lib/local-offers';
import { assertProfileRevision } from '../../lib/profile-revision';
import { storageKey, restoreProfile } from '../../lib/onboarding';
import type { Profile } from '../../lib/onboarding';
import CrmContacts from './crm-contacts';
import LeadCaptureBuilder from './lead-capture-builder';
import CrmPipeline from './crm-pipeline';
import ServiceProposals from './service-proposals';
import ServiceClientPortalDraftEditor from './service-client-portal-draft';
import ServiceAgreementDraftEditor from './service-agreement-draft';
import ServiceInvoiceDraftEditor from './service-invoice-draft';
import ServiceProjectBoardEditor from './service-project-board';
import EducationCreatorWorkflow from './education-creator-workflow';
import EducationCourseDraftEditor from './education-course-draft';
import EducationCourseSalesPageDraftEditor from './education-course-sales-page-draft';
import EducationCertificateTemplateDraftEditor from './education-certificate-template-draft';
import EducationCoachingProgramDraftEditor from './education-coaching-program-draft';
import EducationWorkshopPlanDraftEditor from './education-workshop-plan-draft';
import CommunitySpaceDraftEditor from './community-space-draft';
import StorefrontDraftEditor from './storefront-draft';
import LinkInBioDraftEditor from './link-in-bio-draft';
import WebsitePageDraftEditor from './website-page-draft';
import AdConceptDraftEditor from './ad-concept-draft';

export default function OfferBuilder({ profile, offersOnly = false, creationKind }: { profile: Profile; offersOnly?: boolean; creationKind?: 'service' | 'product' | 'education' }) {
  const [offers, setOffers] = useState<LocalOffer[]>([]);
  const [draft, setDraft] = useState<OfferDraft>(() => blankOffer(profile));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [ingestedContactsRaw, setIngestedContactsRaw] = useState<string | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const closingEditor = useRef(false);
  const profileRaw = useRef<string|null>(null);
  const offersRaw = useRef<string | null>(null);
  const creationApplied = useRef(false);
  const [writable, setWritable] = useState(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  // Loading is keyed only by profile identity: checklist/brief updates must not reset an unsaved offer.
  const latestProfile = useRef(profile);
  latestProfile.current = profile;
  useEffect(() => {
    try {
      const base = window.localStorage.getItem(storageKey);
      if(JSON.stringify(restoreProfile(base))!==JSON.stringify(latestProfile.current))throw Error('Business details changed. Reload before editing.');
      profileRaw.current=base;
      const raw = window.localStorage.getItem(offerStorageKey(profile.id));
      offersRaw.current = raw;
      const existing = restoreLocalOffers(raw, latestProfile.current);
      setWritable(!!existing);
      if (existing) setOffers(existing);
      else setStatus('Saved offers could not be restored. Saving is blocked; nothing was overwritten. Preserve the original data before recovery.');
    } catch { setStatus('Browser storage or saved setup is unavailable. Saving is blocked; no draft will be replaced.'); }
    setReady(true);
  }, [profile.id]);
  useEffect(() => { if (editorOpen) editorHeading.current?.focus(); else if (closingEditor.current) { closingEditor.current = false; createButton.current?.focus(); } }, [editorOpen, editingId]);
  useEffect(() => {
    if (ready && writable && creationKind && !creationApplied.current && profile.pathways.includes(creationKind === 'education' ? 'education' : 'business')) {
      creationApplied.current = true; setDraft({ ...blankOffer(profile), kind: creationKind }); setEditorOpen(true);
    }
  }, [ready, writable, creationKind, profile]);
  function update<K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) { setDraft(current => ({ ...current, [key]: value })); setError(''); }
  function open(offer?: LocalOffer) {
    setDraft(offer ? editLocalOffer(offer) : blankOffer(profile)); setEditingId(offer?.id ?? null); setEditorOpen(true); setError(''); setStatus('');
  }
  return <section className="card offer-builder" aria-labelledby="offer-builder-title">
    <div className="section-heading"><h2 id="offer-builder-title">Your offers</h2><span className="status-badge">Local drafts · {offers.length} saved</span></div>
    <p>Shape a service, product or educational offer for {profile.name}. This is a shared local offer library, not AI generation or a live storefront.</p>
    {status && <p role="status" className="activity-status">{status}</p>}
    {!ready ? <p role="status">Loading local offers…</p> : <>
      {!editorOpen && <button ref={createButton} className="primary-button" disabled={!writable} onClick={() => open()}>Create an offer →</button>}
      {!offers.length && <p>No saved offers yet. Start with one clear outcome and a price.</p>}
      <div className="local-offer-list">{offers.map(offer => <article key={offer.id} className="local-offer">
        <h3>{offer.name}</h3><span className="status-badge">{offer.kind === 'education' ? 'Education' : offer.kind === 'product' ? 'Product' : 'Service'}</span>
        <p>{offer.audience}</p><p className="prose">{offer.outcome}</p><p><strong>{offer.currency} {formatOfferPrice(offer.amountMinor)}</strong> · One-time price draft</p><p className="prose">{offer.delivery}</p>
        <button disabled={editorOpen} onClick={() => open(offer)}>Edit offer</button>
      </article>)}</div>
      {editorOpen && <form onSubmit={event => {
        event.preventDefault();
        try {
          const currentProfile = assertProfileRevision(window.localStorage,profileRaw.current,profile.id);
          if (!writable || window.localStorage.getItem(offerStorageKey(profile.id)) !== offersRaw.current) throw new Error('Offers changed or cannot be read. Reload before saving. Unsaved edits remain.');
          const next = saveLocalOffer(offers, draft, currentProfile, editingId ?? window.crypto.randomUUID());
          const message = 'Offer saved in this browser. No checkout created and no payment collected.';
          try { window.localStorage.setItem(offerStorageKey(profile.id), JSON.stringify(next)); offersRaw.current = JSON.stringify(next); }
          catch { throw new Error('Browser save failed. Your unsaved offer remains in the editor.'); }
          setOffers(next); closingEditor.current = true; setEditorOpen(false); setEditingId(null); setStatus(message); setError('');
        } catch (issue) { setError((issue as Error).message); }
      }}>
        <h3 ref={editorHeading} tabIndex={-1}>{editingId ? 'Edit your offer' : 'Create your offer'}</h3><p>All fields required. Draft changes are saved only when you select Save local offer.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="setup-fields">
          <label>Offer name<input required maxLength={160} value={draft.name} onChange={e => update('name', e.target.value)} /></label>
          <label>Audience<input required maxLength={500} value={draft.audience} onChange={e => update('audience', e.target.value)} /></label>
          <label>Offer type<select value={draft.kind} onChange={e => update('kind', e.target.value as OfferDraft['kind'])}>{profile.pathways.includes('business') && <><option value="service">Service package</option><option value="product">Physical or digital product</option></>}{profile.pathways.includes('education') && <option value="education">Education, coaching or training</option>}</select></label>
          <label>Currency<select value={draft.currency} onChange={e => update('currency', e.target.value as OfferDraft['currency'])}>{offerCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label>One-time price (0 for free)<input required inputMode="decimal" maxLength={18} placeholder="e.g. 149.00" value={draft.price} onChange={e => update('price', e.target.value)} /></label>
        </div>
        <label>Description or promised outcome<textarea required rows={3} maxLength={3000} value={draft.outcome} onChange={e => update('outcome', e.target.value)} /></label>
        <label>{draft.kind === 'education' ? 'Delivery details: format, lessons or sessions, duration and support' : draft.kind === 'product' ? 'Delivery details: contents, fulfilment or download plan' : 'Delivery details: inclusions, duration, location and booking plan'}<textarea required rows={3} maxLength={3000} value={draft.delivery} onChange={e => update('delivery', e.target.value)} /></label>
        <div className="setup-actions"><button type="submit" className="primary-button">Save local offer</button><button type="button" onClick={() => { closingEditor.current = true; setEditorOpen(false); setEditingId(null); setError(''); setStatus('Offer changes discarded. Saved offers are unchanged.'); }}>Cancel changes</button></div>
      </form>}
      <p className="panel-note">Browser-local prototype. No public listing, checkout, tax calculation, payment, booking or course delivery is created. Refreshing loses unsaved changes. Live selling requires connected backend services and explicit publishing approval.</p>
      {!offersOnly && <>
      {profile.pathways.includes('education') && (
        <>
          <EducationCreatorWorkflow key={`education-creator-${profile.id}`} profile={profile} />
          <EducationCourseDraftEditor key={`education-course-${profile.id}`} profile={profile} />
          <Anchor id="course-sales-page" />
          <EducationCourseSalesPageDraftEditor key={`education-sales-page-${profile.id}`} profile={profile} offers={offers} />
          <Anchor id="certificates" />
          <EducationCertificateTemplateDraftEditor key={`education-certificate-template-${profile.id}`} profile={profile} />
          <Anchor id="coaching" />
          <EducationCoachingProgramDraftEditor key={`education-coaching-program-${profile.id}`} profile={profile} offers={offers} />
          <Anchor id="workshop" />
          <EducationWorkshopPlanDraftEditor key={`education-workshop-plan-${profile.id}`} profile={profile} offers={offers} />
          <CommunitySpaceDraftEditor key={`community-space-${profile.id}`} profile={profile} />
        </>
      )}
      <Anchor id="ad-concepts" />
      <AdConceptDraftEditor key={`ad-concept-${profile.id}`} profile={profile} offers={offers} />
      <Anchor id="storefront" />
      <StorefrontDraftEditor key={`storefront-${profile.id}`} profile={profile} offers={offers} />
      <WebsitePageDraftEditor key={`website-page-${profile.id}`} profileId={profile.id} />
      <Anchor id="link-in-bio" />
      <LinkInBioDraftEditor key={`link-in-bio-${profile.id}`} profile={profile} offers={offers} />
      <Anchor id="lead-form" />
      <LeadCaptureBuilder
        key={`lead-capture-${profile.id}`}
        profileId={profile.id}
        onContactsPersisted={setIngestedContactsRaw}
      />
      <CrmContacts key={`crm-${profile.id}`} profileId={profile.id} ingestedContactsRaw={ingestedContactsRaw} />
      <CrmPipeline key={`crm-pipeline-${profile.id}`} profileId={profile.id} />
      {profile.pathways.includes('business') && (
        <>
          <Anchor id="proposals" />
          <ServiceProposals key={profile.id} offers={offers} profileId={profile.id} />
          <Anchor id="client-portal" />
          <ServiceClientPortalDraftEditor key={`client-portal-${profile.id}`} profileId={profile.id} />
          <Anchor id="agreements" />
          <ServiceAgreementDraftEditor key={`service-agreement-${profile.id}`} profileId={profile.id} />
          <Anchor id="invoices" />
          <ServiceInvoiceDraftEditor key={`service-invoice-${profile.id}`} profileId={profile.id} />
          <Anchor id="client-projects" />
          <ServiceProjectBoardEditor key={`service-project-board-${profile.id}`} profileId={profile.id} />
        </>
      )}
      </>}
    </>}
  </section>;
}

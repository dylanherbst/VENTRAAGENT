'use client';
import { Anchor } from '../design-system/anchor';
import { useEffect, useReducer, useRef, useState } from 'react';
import { initialLauncherState, launcherReducer, profileWithSavedBrief } from '../../lib/launcher-state';
import { buildPlan, businessTypes, educationOffers, enablePathway, profileErrors, restoreProfile, serializeProfile, storageKey, tools } from '../../lib/onboarding';
import OfferBuilder from './offer-builder';
import BrandDirectionDraftEditor from './brand-direction-draft';
import SkillAssessmentDraftEditor from './skill-assessment-draft';
import MarketEvidenceNotebookEditor from './market-evidence-notebook';
import OfferValidationWorksheetEditor from './offer-validation-worksheet';
import BusinessPlanDraftEditor from './business-plan-draft';
import { LauncherAccountSync } from './launcher-account-sync';
import { applyChecklistToProfile, checklistFromProfile, restoreChecklist } from '../../lib/launch-checklist';
import { skillAssessmentStorageKey, restoreSkillAssessmentDraft } from '../../lib/local-skill-assessment';
import { marketEvidenceStorageKey, restoreMarketEvidenceNotebook } from '../../lib/local-market-evidence';
import { offerValidationStorageKey, restoreOfferValidationWorksheet } from '../../lib/local-offer-validation-worksheet';
import { brandDirectionStorageKey, restoreBrandDirectionDraft } from '../../lib/local-brand-direction-draft';
import { businessPlanStorageKey, restoreBusinessPlanDraft } from '../../lib/local-business-plan-draft';
import PricingScenarioWorksheetEditor from './pricing-scenario-worksheet';
import type { Profile, Pathway } from '../../lib/onboarding';

// Writes a validated account copy into browser storage and reloads so the editor reads it.
function applyDraft(key: string, raw: string) { localStorage.setItem(key, raw); window.location.reload(); }
export default function BusinessLauncher({ onOpenDemo, embedded = false }: { onOpenDemo?: () => void; embedded?: boolean }) {
  const [{ profile, saved, toolDrafts }, dispatch] = useReducer(launcherReducer, undefined, initialLauncherState);
  const focusHeading = useRef<HTMLHeadingElement>(null);
  function setProfile(next: Profile) { dispatch({ type: 'profile', profile: next }); }
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [activeTool, setActiveTool] = useState('website');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const existing = restoreProfile(raw);
      if (existing) dispatch({ type: 'restore', profile: existing });
      else if (raw) setStatus('Your saved setup could not be restored. Start a new setup; nothing has been overwritten.');
    } catch { setStatus('Browser storage is unavailable. You can configure this session, but changes will not survive a refresh.'); }
    setReady(true);
  }, []);
  function update<K extends keyof Profile>(key: K, value: Profile[K]) { setProfile({ ...profile, [key]: value }); setError(''); }
  function persist(next: Profile) {
    let message = 'Saved on this browser. No live services connected.';
    try { window.localStorage.setItem(storageKey, serializeProfile(next)); }
    catch { message = 'Saved for this session only. Browser storage is unavailable; changes will be lost on refresh.'; }
    dispatch({ type: 'commit', profile: next }); setEditing(false); setStatus(message); setError('');
  }
  function choose(pathway: Pathway) { setProfile({ ...profile, primary: pathway, pathways: saved ? [...new Set([...profile.pathways, pathway])] : [pathway] }); setError(''); }
  const plan = saved ? buildPlan(saved) : [];
  const complete = plan.filter(s => saved?.completed.includes(s.id)).length;
  const tool = tools.find(t => t.id === activeTool)!;
  const setup = !saved || editing;
  useEffect(() => {
    if (!ready) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (target && !target.closest('[hidden]')) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    } else if (!embedded || step > 0) focusHeading.current?.focus({ preventScroll: embedded });
  }, [ready, setup, step, embedded]);
  const field = (key: 'name' | 'industry' | 'location' | 'audience' | 'goal' | 'expertise' | 'website' | 'channels', title: string, required = false, placeholder = '') => <label>{title}{required ? ' *' : ''}<input value={profile[key]} required={required} maxLength={500} placeholder={placeholder} onChange={e => update(key, e.target.value)} /></label>;
  return <section id="launch-content" className="launch-workspace" tabIndex={-1}>
    {!embedded && <header className="launch-topbar"><a href="/workspace">Account workspace →</a><a className="launch-wordmark" href="#launch-content"><span className="brand-mark" aria-hidden="true">V</span> VENTRA</a><button onClick={onOpenDemo ?? (() => undefined)}>Open course & selling demo <span aria-hidden="true">↗</span></button></header>}
    {!ready ? <p role="status">Loading your business setup…</p> : <>
      <header className="launch-hero"><p className="eyebrow">ONE BUSINESS. SHARED POSSIBILITIES.</p><h1 tabIndex={-1} ref={!setup ? focusHeading : undefined}>{setup ? <>Your ambition.<br /><span className="gradient-text">Your next chapter.</span></> : <>{saved.name}<br /><span className="gradient-text">Your next move.</span></>}</h1><p>{setup ? 'Build an education business, launch or grow a service or product business — or bring both together in one place.' : `${saved.stage === 'existing' ? 'Grow your existing business' : 'Turn your idea into a business'} · ${saved.pathways.map(p => p === 'education' ? 'Education' : 'Services').join(' + ')}`}</p></header>
      <p className="launch-local">Local prototype · Setup and checklist stay in this browser. No AI, payments, customer imports or integrations are connected.</p>
      {status && <p role="status" className="activity-status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {setup ? <section className="launch-setup" aria-label="Business onboarding">
        <ol className="setup-steps" aria-label="Setup progress">{['Your pathway', 'Your starting point', 'Your business'].map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined}><span>{String(i + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
        <form onSubmit={e => { e.preventDefault(); if (step < 2) { setStep(step + 1); return; } const issues = profileErrors(profile); if (issues.length) { setError(issues.join(' ')); return; } persist(profile); }}>
          {step === 0 && <><h2 tabIndex={-1} ref={focusHeading}>What do you want to build?</h2><p>Choose where to begin. Activate the other pathway later, inside the same business profile.</p><div className="pathway-options">{([
            ['education', 'Education', 'Turn what you know into courses, coaching, mentorship or training.', 'Fitness coach · Lash educator · 3D artist · Business mentor'],
            ['business', 'Services', 'Launch or grow a service business, with support for physical and digital products too.', 'Lash technician · Electrician · Clothing brand · Web designer'],
          ] as const).map(([id, title, description, examples]) => <label key={id} className={`pathway-option ${profile.primary === id ? 'is-selected' : ''}`}><input type="radio" name="pathway" value={id} checked={profile.primary === id} onChange={() => choose(id)} /><span className="subtle-label">{id === 'education' ? '01 / SHARE YOUR EXPERTISE' : '02 / GROW YOUR BUSINESS'}</span><strong>{title}</strong><span>{description}</span><small>{examples}</small></label>)}</div></>}
          {step === 1 && <><h2 tabIndex={-1} ref={focusHeading}>Where are you currently?</h2><p>Your starting point shapes your plan — not your access to the shared tools.</p><div className="pathway-options">{([['idea', 'I have a skill or idea', 'I haven’t started selling yet. Help me build a foundation.'], ['existing', 'I already have a business', 'Help me connect what I have and grow.']] as const).map(([id, title, text]) => <label key={id} className={`pathway-option ${profile.stage === id ? 'is-selected' : ''}`}><input type="radio" name="stage" checked={profile.stage === id} onChange={() => update('stage', id)} /><strong>{title}</strong><span>{text}</span></label>)}</div>{profile.stage === 'existing' && <p className="plan-preview">Your route: website & channels → customer import → setter & receptionist → campaigns → conversions.</p>}</>}
          {step === 2 && <><h2 tabIndex={-1} ref={focusHeading}>Make it yours.</h2><p>A few details will tailor your starting checklist. * Required</p><div className="setup-fields">{field('name', 'Business or project name', true, 'Your business name')}{field('audience', 'Who do you want to help or sell to?', true)}{field('goal', 'Your main goal', true, 'e.g. Book five more local clients each week')}{field('location', 'Location or service area', false, 'e.g. Perth, WA or online worldwide')}
            {profile.pathways.includes('education') && <>{field('expertise', 'What skill or expertise will you teach?', true)}<label>Educational offer<select value={profile.educationOffer} onChange={e => update('educationOffer', e.target.value)}>{educationOffers.map(x => <option key={x}>{x}</option>)}</select></label></>}
            {profile.pathways.includes('business') && <><label>Business type<select value={profile.businessType} onChange={e => update('businessType', e.target.value)}>{businessTypes.map(x => <option key={x}>{x}</option>)}</select></label>{field('industry', 'Industry, product or service', true, 'e.g. Lash treatments or electrical services')}</>}
            {profile.stage === 'existing' && <>{field('website', 'Existing website (optional)', false, 'https://your-business.com')}{field('channels', 'Existing sales and marketing channels (optional)', false, 'e.g. Instagram, website enquiries, phone')}</>}
          </div></>}
          <div className="setup-actions">{step > 0 && <button type="button" onClick={() => { setStep(step - 1); setError(''); }}>Back</button>}<button className="primary-button" type="submit">{step < 2 ? 'Continue →' : 'Save setup & view my plan ↗'}</button>{saved && <button type="button" onClick={() => { setProfile(saved); setEditing(false); setError(''); }}>Cancel changes</button>}</div>
        </form>
      </section> : <>
        <section className="business-summary card"><div className="section-heading"><h2>Your business profile</h2><button onClick={() => { setEditing(true); setStep(0); }}>Edit setup</button></div><p>{saved.audience} · {saved.location || 'Location not set'}</p><p><strong>Your goal:</strong> {saved.goal}</p>{saved.stage === 'existing' && <p>Website: {saved.website || 'Not supplied'} · Channels: {saved.channels || 'Not supplied'} · Not connected</p>}<div className="pathway-chips">{(['education', 'business'] as const).map(p => <div key={p}><span className="status-badge">{p === 'education' ? 'Education' : 'Services'} {saved.pathways.includes(p) ? 'enabled' : 'available'}</span>{!saved.pathways.includes(p) && <button onClick={() => { setProfile(enablePathway(saved, p)); setStep(2); setEditing(true); }}>Activate {p === 'education' ? 'Education' : 'Services'}</button>}</div>)}</div><p className="panel-note">One profile, shared tools. Adding a pathway keeps your business details, checklist progress and saved briefs.</p></section>
        <Anchor id="start-skills" />
        <SkillAssessmentDraftEditor key={`skill-assessment-${saved.id}`} profile={saved} />
        <LauncherAccountSync kind="skill-assessment" label="Skill assessment" readLocal={() => localStorage.getItem(skillAssessmentStorageKey(saved.id))} validate={raw => { restoreSkillAssessmentDraft(raw, saved.id); }} onApply={raw => applyDraft(skillAssessmentStorageKey(saved.id), raw)} />
        <Anchor id="start-evidence" />
        <MarketEvidenceNotebookEditor key={`market-evidence-${saved.id}`} profile={saved} />
        <LauncherAccountSync kind="market-evidence" label="Market evidence" readLocal={() => localStorage.getItem(marketEvidenceStorageKey(saved.id))} validate={raw => { restoreMarketEvidenceNotebook(raw, saved.id); }} onApply={raw => applyDraft(marketEvidenceStorageKey(saved.id), raw)} />
        <Anchor id="start-validate" />
        <OfferValidationWorksheetEditor key={`offer-validation-${saved.id}`} profile={saved} />
        <LauncherAccountSync kind="offer-validation" label="Offer validation" readLocal={() => localStorage.getItem(offerValidationStorageKey(saved.id))} validate={raw => { restoreOfferValidationWorksheet(raw, saved.id); }} onApply={raw => applyDraft(offerValidationStorageKey(saved.id), raw)} />
        <Anchor id="start-pricing" />
        <PricingScenarioWorksheetEditor key={`pricing-scenario-${saved.id}`} profile={saved} />
        <Anchor id="start-branding" />
        <BrandDirectionDraftEditor key={`brand-direction-${saved.id}`} profile={saved} />
        <LauncherAccountSync kind="brand-direction" label="Brand direction" readLocal={() => localStorage.getItem(brandDirectionStorageKey(saved.id))} validate={raw => { restoreBrandDirectionDraft(raw, saved.id); }} onApply={raw => applyDraft(brandDirectionStorageKey(saved.id), raw)} />
        <Anchor id="start-plan" />
        <BusinessPlanDraftEditor key={`business-plan-draft-${saved.id}`} profile={saved} />
        <LauncherAccountSync kind="business-plan" label="Business plan" readLocal={() => localStorage.getItem(businessPlanStorageKey(saved.id))} validate={raw => { restoreBusinessPlanDraft(raw, saved.id); }} onApply={raw => applyDraft(businessPlanStorageKey(saved.id), raw)} />
        <Anchor id="start-checklist" />
        <section className="launch-plan card" aria-labelledby="plan-title"><div className="section-heading"><h2 id="plan-title">Your launch plan</h2><span className="status-badge">{complete}/{plan.length} reviewed</span></div><p>Based on your setup, not AI-generated. Mark each step as reviewed as you plan your work — this does not perform an integration or publish anything.</p><progress aria-label={`${complete} of ${plan.length} steps reviewed`} value={complete} max={plan.length} /><ol>{plan.map((s, i) => <li key={s.id}><label className="plan-check"><input type="checkbox" checked={saved.completed.includes(s.id)} onChange={e => persist({ ...saved, completed: e.target.checked ? [...saved.completed, s.id] : saved.completed.filter(id => id !== s.id) })} /><span><small>STEP {String(i + 1).padStart(2, '0')}</small><strong>{s.title}</strong><span>{s.detail}</span></span></label>{s.area === 'course' ? <button onClick={onOpenDemo}>Open course workshop demo ↗</button> : tools.some(t => t.id === s.area) && <button onClick={() => { setActiveTool(s.area); document.getElementById('shared-tools')?.scrollIntoView({ behavior: 'smooth' }); }}>Prepare {tools.find(t => t.id === s.area)?.title} →</button>}</li>)}</ol><LauncherAccountSync kind="launch-checklist" label="Launch checklist" readLocal={() => checklistFromProfile(localStorage.getItem(storageKey))} validate={raw => { restoreChecklist(raw); }} onApply={raw => { localStorage.setItem(storageKey, applyChecklistToProfile(localStorage.getItem(storageKey), raw)); window.location.reload(); }} /></section>
        <section id="shared-tools" className="shared-tools" aria-labelledby="tools-title"><div className="section-heading"><h2 id="tools-title">One engine. Both pathways.</h2><span className="subtle-label">Shared business infrastructure</span></div><div className="tool-grid">{tools.map(t => <button key={t.id} aria-pressed={activeTool === t.id} onClick={() => setActiveTool(t.id)}><strong>{t.title}</strong><small>Prepare local brief · Not connected</small></button>)}</div><section className="card tool-brief" aria-labelledby="brief-title"><h3 id="brief-title">{tool.title} brief</h3><p>{tool.prompt}</p><label>Configuration notes<textarea rows={5} maxLength={5000} value={toolDrafts[tool.id] || ''} onChange={e => dispatch({ type: 'note', toolId: tool.id, value: e.target.value })} /></label><button onClick={() => persist(profileWithSavedBrief(saved, toolDrafts, tool.id))}>Save local brief</button><p className="panel-note">Unsaved notes stay in this session when you switch tools or edit setup; only Save local brief saves this tool’s notes. A planning brief only. Saving does not connect a provider, call AI, import customers, create a checkout or send campaigns.</p></section></section>
      </>}
      {saved && <div hidden={setup}><OfferBuilder key={saved.id} profile={saved} /></div>}
    </>}
  </section>;
}

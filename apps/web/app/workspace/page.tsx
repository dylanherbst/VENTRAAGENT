'use client';
import { useEffect, useRef, useState } from 'react';
import { forgetWorkspaces } from '../ui/workspace-list';
import { blankProfile, storageKey } from '../../lib/onboarding';
import { blankOffer, editLocalOffer, formatOfferPrice, offerStorageKey, saveLocalOffer } from '../../lib/local-offers';
import { checkedImport, checkedProfile } from '../../lib/workspace-validation';
import type { Profile } from '../../lib/onboarding';
import type { LocalOffer, OfferDraft } from '../../lib/local-offers';
type SavedProfile = { data: Profile; revision: number };
type SavedOffer = { id: string; data: LocalOffer; revision: number };
type Snapshot = { signedIn?: boolean; configured?: boolean; workspaces?: { id: string; name: string }[]; role?: string; profile?: SavedProfile | null; offers?: SavedOffer[]; workspace?: string; message?: string; result?: string };
const demoBypass = process.env.NEXT_PUBLIC_DEMO_BYPASS_AUTH === 'true';
async function api(body?: Record<string, unknown>, workspace = ''): Promise<Snapshot> {
  if (body) forgetWorkspaces();
  const res = await fetch('/api/workspace' + (workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''), { method: body ? 'POST' : 'GET', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Please retry.'), { status: res.status });
  return data;
}
export default function Workspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [workspace, setWorkspace] = useState('');
  const [profile, setProfile] = useState(blankProfile);
  const [draft, setDraft] = useState<OfferDraft>(() => blankOffer(blankProfile()));
  const [offerId, setOfferId] = useState('');
  const [offerRevision, setOfferRevision] = useState(0);
  const [preview, setPreview] = useState<ReturnType<typeof checkedImport> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading your account…');
  const requestVersion = useRef(0);
  const owner = snapshot.role === 'owner';
  useEffect(() => {
    if (demoBypass) window.location.replace('/');
  }, []);
  function apply(next: Snapshot) {
    setSnapshot(next); setProfile(next.profile?.data ?? blankProfile());
    setDraft(blankOffer(next.profile?.data ?? blankProfile())); setOfferId(''); setOfferRevision(0); setPreview(null);
  }
  function failure(e: unknown) {
    setError(e instanceof Error ? e.message : 'Unable to connect. Please retry.');
    if ((e as { status?: number }).status === 401) { setSnapshot({ signedIn: false }); setWorkspace(''); setProfile(blankProfile()); setDraft(blankOffer(blankProfile())); setPreview(null); }
  }
  useEffect(() => {
    if (demoBypass) return;
    let live = true;
    api().then(data => { if (live) { apply(data); setStatus('Choose or create a workspace.'); } }).catch(e => { if (live) { failure(e); setStatus('Your browser-local setup remains available.'); } }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  if (demoBypass) return <div className="account-workspace"><p role="status">Opening the local demo…</p></div>;
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { failure(e); } finally { setBusy(false); }
  }
  async function load(w: string) {
    const request = ++requestVersion.current;
    const next = await api(undefined, w);
    if (request === requestVersion.current) { apply(next); setWorkspace(w); }
  }
  async function save(body: Record<string, unknown>, message: string) {
    await api({ ...body, workspace }); await load(workspace); setStatus(message);
  }
  return <div className="account-workspace">
    <header><a href="/">← Browser-local setup</a><h1>Your business workspace</h1><p>Keep your profile and offers together. Saved account records are separate from browser-local drafts.</p></header>
    <p role="status">{busy ? 'Working…' : status}</p>
    {error && <p role="alert" id="workspace-error" className="error">{error}</p>}
    <button disabled={busy} onClick={() => run(async () => { await load(workspace); setStatus('Reloaded from your account. Unsaved form changes have been replaced.'); })}>Reload saved work</button>
    {!snapshot.signedIn ? <section className="card"><h2>Sign in or create your account</h2><form onSubmit={e => {
      e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') || 'login';
      void run(async () => { const result = await api({ action, email: data.get('email'), password: data.get('password') }); form.reset(); if (result.signedIn) await load(''); setStatus(result.message ?? 'Check your email.'); });
    }}><label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required disabled={busy} /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required disabled={busy} /></label><p>Use 12–128 characters. New accounts may require email confirmation before signing in.</p><button type="submit" value="login" disabled={busy}>Sign in</button><button type="submit" value="signup" disabled={busy}>Create account</button></form></section> : <>
      <button disabled={busy} onClick={() => run(async () => { await api({ action: 'logout' }); apply({ signedIn: false }); setWorkspace(''); setStatus('Signed out.'); })}>Sign out</button>
      <section className="card"><h2>Choose your workspace</h2><label>Workspace<select disabled={busy} value={workspace} onChange={e => { const w = e.target.value; void run(async () => { await load(w); setStatus('Loaded saved workspace.'); }); }}><option value="">Choose a workspace</option>{snapshot.workspaces?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => { const result = await api({ action: 'createWorkspace', name: data.get('name') }); await load(result.workspace!); setStatus('Workspace created. Save a profile or import browser drafts.'); }); }}><label>New workspace name<input name="name" required maxLength={160} disabled={busy} /></label><button disabled={busy}>Create workspace</button></form></section>
      {workspace && <>
        <p>{owner ? 'Owner: you can save profile and offer changes.' : 'Staff: read-only access to this workspace.'} Form edits are unsaved until you choose Save.</p>
        <section className="card"><h2>Bring your browser drafts</h2><p>Preview first. Import only into a workspace without a saved profile. Nothing is deleted from this browser.</p><button disabled={busy || !owner} onClick={() => { setError(''); try { const raw = localStorage.getItem(storageKey); if (!raw) throw new Error('No browser-local setup found. Create it from Browser-local setup first.'); const local = JSON.parse(raw); const offers = JSON.parse(localStorage.getItem(offerStorageKey(local.id)) ?? '[]'); setPreview(checkedImport({ profile: local, offers })); setStatus('Import preview only. Nothing saved yet.'); } catch (e) { setPreview(null); failure(e); } }}>Preview local drafts</button>
        {preview && <div><h3>{preview.profile.name}</h3><p>{preview.offers.length} offer(s). Existing server work will not be overwritten. An identical retry will not create duplicates.</p><ul>{preview.offers.map(o => <li key={o.id}>{o.name} · {o.currency} {formatOfferPrice(o.amountMinor)}</li>)}</ul><button disabled={busy || !owner} onClick={() => run(async () => { const result = await api({ action: 'import', workspace, payload: preview }); const count = preview.offers.length; await load(workspace); setStatus(result.result === 'already_imported' ? 'This exact import was already saved. No duplicates created.' : `Imported profile and ${count} offer(s). Browser source drafts retained.`); })}>Import these drafts</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel import</button></div>}</section>
        <section className="card"><h2>Business profile</h2><p>{snapshot.profile ? `Saved revision ${snapshot.profile.revision}` : 'Not saved to this account yet.'}</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await save({ action: 'profile', profile: checkedProfile(profile), revision: snapshot.profile?.revision ?? 0 }, 'Profile saved to your account.'); }); }}><fieldset disabled={busy || !owner}><legend>Business details</legend>
          {(['name','audience','goal','industry','expertise','location','website','channels'] as const).map(key => <label key={key}>{{ name: 'Business name', audience: 'Customers or learners', goal: 'Your goal', industry: 'Industry (required for Services)', expertise: 'Expertise (required for Education)', location: 'Location', website: 'Website', channels: 'Channels' }[key]}<input value={profile[key]} maxLength={500} required={['name','audience','goal'].includes(key)} onChange={e => setProfile({ ...profile, [key]: e.target.value })} /></label>)}
          <label>Primary pathway<select value={profile.primary} onChange={e => { const primary = e.target.value as Profile['primary']; setProfile({ ...profile, primary, pathways: [...new Set([...profile.pathways, primary])] }); }}><option value="education">Education</option><option value="business">Services</option></select></label>
          {(['education','business'] as const).map(p => <label key={p}><input type="checkbox" checked={profile.pathways.includes(p)} disabled={profile.primary === p} onChange={e => setProfile({ ...profile, pathways: e.target.checked ? [...profile.pathways, p] : profile.pathways.filter(x => x !== p) })} />{p === 'business' ? 'Services' : 'Education'} enabled</label>)}
          <button type="submit">Save profile</button></fieldset></form></section>
        <section className="card"><h2>Your offers</h2>{!snapshot.offers?.length && <p>No account offers yet. Save a profile, then add an offer.</p>}<ul>{snapshot.offers?.map(o => <li key={o.id}>{o.data.name} · {o.data.currency} {formatOfferPrice(o.data.amountMinor)} <button disabled={busy} onClick={() => { setDraft(editLocalOffer(o.data)); setOfferId(o.id); setOfferRevision(o.revision); setStatus('Offer loaded for editing. Changes are unsaved.'); }}>Edit {o.data.name}</button></li>)}</ul>
          <form onSubmit={e => { e.preventDefault(); void run(async () => { if (!snapshot.profile) throw new Error('Save a business profile first.'); const id = offerId || crypto.randomUUID(); setOfferId(id); const offer = saveLocalOffer([], draft, snapshot.profile.data, id)[0]; await save({ action: 'offer', id, offer, revision: offerRevision }, 'Offer saved to your account.'); }); }}><fieldset disabled={busy || !owner || !snapshot.profile}><legend>{offerRevision ? 'Edit offer' : 'New offer'} · unsaved form</legend>{(['name','audience','outcome','delivery','price'] as const).map(key => <label key={key}>{{ name: 'Offer name', audience: 'Audience', outcome: 'Outcome', delivery: 'Delivery details', price: 'One-time price' }[key]}<input required maxLength={key === 'name' ? 160 : key === 'audience' ? 500 : 3000} inputMode={key === 'price' ? 'decimal' : undefined} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}<label>Currency<select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value as OfferDraft['currency'] })}>{['AUD','USD','GBP','EUR','NZD','CAD'].map(c => <option key={c}>{c}</option>)}</select></label><label>Delivery type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as OfferDraft['kind'] })}><option value="service">Service</option><option value="product">Product</option><option value="education">Education</option></select></label><button>Save offer</button><button type="button" onClick={() => { setDraft(blankOffer(profile)); setOfferId(''); setOfferRevision(0); }}>Start a new offer</button></fieldset></form>
        </section>
      </>}
    </>}
  </div>;
}

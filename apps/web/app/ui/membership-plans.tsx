'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addPerk, addTier, blankPlans, membershipStorageKey, newPerks, perkLimit, perkTextLimit, persistPlans, removePerk, removeTier, restorePlans, tierLimit, tierNameLimit, tierPitchLimit, tierPriceTextLimit, validatePlans } from '../../lib/local-membership-plans';
import type { MembershipPlans } from '../../lib/local-membership-plans';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

export default function MembershipPlansEditor({ profileId }: { profileId: string }) {
  const [plans, setPlans] = useState<MembershipPlans | null>(null);
  const [form, setForm] = useState({ name: '', priceText: '', pitch: '' });
  const [perkText, setPerkText] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(membershipStorageKey(profileId));
      setPlans(restorePlans(raw, profileId) ?? blankPlans(profileId)); rawRef.current = raw; setWritable(true);
    } catch (e) { setPlans(null); setWritable(false); setError(e instanceof Error ? e.message : 'Saved membership plans could not be read. Nothing was overwritten.'); }
    setReady(true);
  }, [profileId]);

  const check = useMemo(() => (plans ? validatePlans(plans) : { problems: [] }), [plans]);
  const edit = (next: MembershipPlans) => { setPlans(next); setDirty(true); setStatus(''); };
  function save() {
    if (!plans) return;
    try {
      rawRef.current = persistPlans(window.localStorage, profileId, rawRef.current, plans, new Date().toISOString());
      setPlans(restorePlans(rawRef.current, profileId)); setDirty(false); setError('');
      setStatus('Membership plans saved in this browser. Nothing was published, billed or sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); }
  }
  function add() {
    if (!plans) return;
    if (!form.name.trim() || !form.priceText.trim()) { setFormError('Enter a tier name and price wording.'); return; }
    try {
      const next = addTier(plans, { id: newId(), ...form });
      const p = validatePlans(next).problems;
      if (p.length) { setFormError(p[0]); return; }
      edit(next); setForm({ name: '', priceText: '', pitch: '' }); setFormError('');
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Could not add tier.'); }
  }
  function perk(tierId: string) {
    if (!plans) return;
    try { edit(addPerk(plans, tierId, perkText[tierId] ?? '')); setPerkText({ ...perkText, [tierId]: '' }); setFormError(''); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Could not add perk.'); }
  }

  if (!ready) return <p role="status">Loading membership plans…</p>;
  return <section aria-labelledby="membership-title" data-testid="membership-plans">
    <h2 id="membership-title">Membership plans</h2>
    <p><span className="v-status">Browser draft · planning only · no billing</span></p>
    <p>Sketch the tiers, what each includes and how you would word the price. Nothing is charged, nobody can sign up and no content is locked.</p>
    {status && <p role="status" data-testid="membership-status">{status}</p>}
    {error && <p role="alert" data-testid="membership-error">{error}</p>}
    {plans && <>
      <form data-testid="membership-add-form" onSubmit={e => { e.preventDefault(); add(); }}>
        <fieldset disabled={!writable}>
          <legend>Add a tier</legend>
          <label>Tier name<input value={form.name} maxLength={tierNameLimit} data-testid="membership-name" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Price wording (text only, for example “$29 a month”)<input value={form.priceText} maxLength={tierPriceTextLimit} data-testid="membership-price" onChange={e => setForm({ ...form, priceText: e.target.value })} /></label>
          <label>One-line pitch (optional)<input value={form.pitch} maxLength={tierPitchLimit} data-testid="membership-pitch" onChange={e => setForm({ ...form, pitch: e.target.value })} /></label>
          {formError && <p role="alert" data-testid="membership-form-error">{formError}</p>}
          <button type="submit" data-testid="membership-add" disabled={plans.tiers.length >= tierLimit}>Add tier ({plans.tiers.length} of {tierLimit})</button>
        </fieldset>
      </form>
      {plans.tiers.length === 0 && <p data-testid="membership-empty">No tiers yet.</p>}
      {plans.tiers.map(t => <article key={t.id} data-testid="membership-tier">
        <h3>{t.name} <small data-testid="membership-tier-price">{t.priceText}</small></h3>
        {t.pitch && <p>{t.pitch}</p>}
        {t.perks.length === 0 ? <p>No perks yet.</p> : <ul>{t.perks.map((p, i) => <li key={i}>{p} <button type="button" disabled={!writable} onClick={() => edit(removePerk(plans, t.id, i))}>Remove perk</button></li>)}</ul>}
        {t.perks.length > 0 && <p data-testid="membership-new-perks">New in this tier: {newPerks(plans, t.id).join(', ') || 'nothing beyond earlier tiers'}.</p>}
        <label>Add a perk<input value={perkText[t.id] ?? ''} maxLength={perkTextLimit} disabled={!writable} data-testid="membership-perk-input" onChange={e => setPerkText({ ...perkText, [t.id]: e.target.value })} /></label>
        <button type="button" data-testid="membership-perk-add" disabled={!writable || t.perks.length >= perkLimit} onClick={() => perk(t.id)}>Add perk</button>
        {' '}<button type="button" disabled={!writable} onClick={() => edit(removeTier(plans, t.id))}>Remove tier {t.name}</button>
      </article>)}
      {check.problems.length > 0 && <ul role="status" data-testid="membership-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <button type="button" className="v-button" data-testid="membership-save" disabled={!writable || !dirty || check.problems.length > 0} onClick={save}>Save membership plans</button>
    </>}
  </section>;
}

'use client';
import { useState } from 'react';
import { approveAngleAction, createCampaignAction, editAngleAction, importNicheAction, regenerateAction, unapproveAction } from '../app/b/[brand]/angles-actions';
import type { AnglesView, Scope } from '../lib/views';
import type { AdAngle, Campaign } from '../../web/lib/aimp/marketing-engine/types';


const APPROACH: Record<string, string> = { pattern_interrupt: 'Pattern interrupt', value_contrast: 'Value contrast', curiosity_teaching: 'Curiosity + teaching', identification_objection: 'Identification + objection', specific_proof: 'Specific proof' };
const FORMAT: Record<string, string> = { reel_9x16: 'Reel 9:16', static_4x5: 'Image 4:5', carousel_4x5: 'Carousel 4:5' };
type Niche = { id: string; tier: string; name: string };
type BriefForm = { businessName: string; niche: string; offer: string; audience: string; region: string; goal: string; channel: string; tone: string; facts: string };

export function AnglesClient({ scope, initial, niches, defaults }: { scope: Scope; initial: AnglesView; niches?: Niche[]; defaults?: Partial<BriefForm> }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(initial.campaigns[0]?.id ?? null);
  const [showForm, setShowForm] = useState(initial.campaigns.length === 0);
  const [f, setF] = useState<BriefForm>({ businessName: '', niche: '', offer: '', audience: '', region: 'Australia', goal: 'leads', channel: 'organic', tone: '', facts: '', ...defaults });
  const act = async (p: Promise<AnglesView | null>, after?: (n: AnglesView) => void) => {
    setBusy(true);
    try { const n = await p; if (n) { setV(n); after?.(n); } else setV({ ...v, message: 'This page is not switched on here.', errors: [] }); }
    catch { setV({ ...v, message: 'Something went wrong. Nothing was changed.', errors: [] }); }
    finally { setBusy(false); }
  };
  const newest = (n: AnglesView) => { setOpen(n.campaigns[0]?.id ?? null); if (!n.errors.length) setShowForm(false); };
  const set = (k: keyof BriefForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const current = v.campaigns.find((c) => c.id === open) ?? null;

  return (
    <div className="ma-root">
      <div className="ma-status">
        <span className={v.demo ? 'ma-tag ma-warn' : 'ma-tag'}>{v.demo ? 'Demo writer: no AI key set, angles are templates' : `Writer: ${v.writer}`}</span>
        <span className="ma-muted">{v.usage.events ? `${v.usage.events} AI calls, about US$${v.usage.estimatedCostUsd.toFixed(4)}` : 'No AI calls yet'}</span>
      </div>
      {v.message ? <p className="ma-msg" role="status">{v.message}</p> : null}
      {v.errors.length ? <ul className="ma-errors">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}

      {niches?.length ? (
        <section className="ma-card">
          <h2>Your playbook</h2>
          <p className="ma-muted">100 ads across 20 niches. Load a niche to edit and approve its five angles.</p>
          <div className="ma-niches">
            {niches.map((n) => <button key={n.id} type="button" disabled={busy} onClick={() => act(importNicheAction(scope, n.id), newest)}><span className={`ma-tier ma-tier-${n.tier}`}>{n.tier}</span>{n.name}</button>)}
          </div>
        </section>
      ) : null}

      <div className="ma-row">
        <button type="button" className={showForm ? '' : 'ma-primary'} onClick={() => setShowForm(!showForm)}>{showForm ? 'Close the brief' : 'New campaign from a brief'}</button>
        {v.campaigns.length ? (
          <label className="ma-pick">Campaign
            <select value={open ?? ''} onChange={(e) => setOpen(e.target.value)}>
              {v.campaigns.map((c) => <option key={c.id} value={c.id}>{c.brief.businessName}: {c.brief.niche}{c.state === 'angle_approved' ? ' (approved)' : ''}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {showForm ? (
        <form className="ma-card ma-form" onSubmit={(e) => { e.preventDefault(); act(createCampaignAction(scope, { ...f, facts: f.facts.split('\n') }), newest); }}>
          <h2>Brand brief</h2>
          <div className="ma-grid">
            <label>Business name<input value={f.businessName} onChange={set('businessName')} required maxLength={80} /></label>
            <label>Niche<input value={f.niche} onChange={set('niche')} required maxLength={120} placeholder="e.g. mobile car detailing" /></label>
            <label className="ma-wide">What you sell<textarea rows={2} value={f.offer} onChange={set('offer')} required maxLength={400} /></label>
            <label className="ma-wide">Who it is for<input value={f.audience} onChange={set('audience')} required maxLength={300} placeholder="e.g. busy parents in Perth's northern suburbs" /></label>
            <label>Region<input value={f.region} onChange={set('region')} maxLength={80} /></label>
            <label>Tone<input value={f.tone} onChange={set('tone')} maxLength={120} placeholder="warm, plain, confident" /></label>
            <label>Goal<select value={f.goal} onChange={set('goal')}><option value="awareness">Get noticed</option><option value="leads">Get enquiries</option><option value="sales">Get sales</option></select></label>
            <label>Channel<select value={f.channel} onChange={set('channel')}><option value="organic">Organic posts</option><option value="paid">Paid ads (copy only, nothing is spent)</option></select></label>
            <label className="ma-wide">Facts you can stand behind, one per line
              <textarea rows={3} value={f.facts} onChange={set('facts')} maxLength={4000} placeholder={'Free delivery over $50\n4.9 stars from 212 Google reviews (link)\nSame cleaner every visit'} />
              <span className="ma-muted">Only these can be stated as true. Any other number or result the writer uses is flagged for you to check.</span>
            </label>
          </div>
          <div className="ma-row"><button className="ma-primary" type="submit" disabled={busy}>{busy ? 'Writing...' : 'Write 5 angles'}</button></div>
        </form>
      ) : null}

      {current ? <CampaignView c={current} busy={busy} onRegenerate={() => act(regenerateAction(scope, current.id))} onUnapprove={() => act(unapproveAction(scope, current.id))}
        onEdit={(a, e) => act(editAngleAction(scope, current.id, a, e))} onApprove={(a, ok) => act(approveAngleAction(scope, current.id, a, ok))} /> : null}
    </div>
  );
}

function CampaignView({ c, busy, onRegenerate, onUnapprove, onEdit, onApprove }: { c: Campaign; busy: boolean; onRegenerate: () => void; onUnapprove: () => void; onEdit: (id: string, e: Record<string, string>) => void; onApprove: (id: string, ok: boolean) => void }) {
  return (
    <section className="ma-campaign">
      <div className="ma-row ma-between">
        <div>
          <h2>{c.brief.businessName}: {c.brief.niche}</h2>
          <p className="ma-muted">{c.brief.audience} · {c.generatedBy === 'demo' ? 'demo angles' : `written by ${c.generatedBy ?? 'nobody yet'}`}</p>
        </div>
        <div className="ma-row">
          {c.state === 'angle_approved' ? <button type="button" disabled={busy} onClick={onUnapprove}>Withdraw approval</button> : null}
          {c.generatedBy?.startsWith('playbook') ? null : <button type="button" disabled={busy} onClick={onRegenerate}>Write new angles</button>}
        </div>
      </div>
      {c.angles.length === 0 ? <p className="ma-muted">No angles yet. Press "Write new angles".</p> : null}
      <div className="ma-angles">{c.angles.map((a) => <AngleCard key={`${a.id}:${a.hook}:${a.primaryCopy}`} a={a} approved={c.approvedAngleId === a.id} busy={busy} onEdit={onEdit} onApprove={onApprove} />)}</div>
    </section>
  );
}

function AngleCard({ a, approved, busy, onEdit, onApprove }: { a: AdAngle; approved: boolean; busy: boolean; onEdit: (id: string, e: Record<string, string>) => void; onApprove: (id: string, ok: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [e, setE] = useState({ hook: a.hook, headline: a.headline, primaryCopy: a.primaryCopy, cta: a.cta, imageBrief: a.imageBrief });
  const flagged = a.claims.filter((x) => x.status === 'hypothesis');
  return (
    <article className={`ma-angle${approved ? ' ma-approved' : ''}`}>
      <header className="ma-row ma-between">
        <strong>{APPROACH[a.approach]}</strong>
        <span className="ma-row"><span className="ma-tag">{FORMAT[a.format]}</span>{a.editedByOwner ? <span className="ma-tag">Edited</span> : null}{approved ? <span className="ma-tag ma-ok">Approved</span> : null}</span>
      </header>
      {editing ? (
        <div className="ma-form">
          <label>Hook<input value={e.hook} maxLength={160} onChange={(x) => setE({ ...e, hook: x.target.value })} /></label>
          <label>Headline<input value={e.headline} maxLength={90} onChange={(x) => setE({ ...e, headline: x.target.value })} /></label>
          <label>Ad text<textarea rows={4} value={e.primaryCopy} maxLength={700} onChange={(x) => setE({ ...e, primaryCopy: x.target.value })} /></label>
          <label>Button<input value={e.cta} maxLength={40} onChange={(x) => setE({ ...e, cta: x.target.value })} /></label>
          <label>Image brief<textarea rows={2} value={e.imageBrief} maxLength={600} onChange={(x) => setE({ ...e, imageBrief: x.target.value })} /></label>
          <div className="ma-row"><button className="ma-primary" type="button" disabled={busy} onClick={() => { onEdit(a.id, e); setEditing(false); }}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      ) : (
        <>
          <p className="ma-hook">{a.hook}</p>
          <p className="ma-headline">{a.headline}</p>
          <p>{a.primaryCopy}</p>
          <p className="ma-cta"><span>{a.cta}</span></p>
          <details><summary>Visual brief{a.storyboard.length ? ` and ${a.storyboard.length}-beat storyboard` : ''}</summary>
            <p className="ma-muted">{a.imageBrief}</p>
            {a.storyboard.length ? <ol className="ma-beats">{a.storyboard.map((b, i) => <li key={i}><span>{b.atSeconds}s</span> {b.visual}{b.overlay ? <em> · on screen: {b.overlay}</em> : null}</li>)}</ol> : null}
          </details>
        </>
      )}
      {flagged.length ? (
        <div className="ma-claims">
          <strong>Check before using</strong>
          <ul>{flagged.map((x) => <li key={x.text}>{x.text}</li>)}</ul>
          {!approved ? <label className="ma-check"><input type="checkbox" checked={checked} onChange={(x) => setChecked(x.target.checked)} /> I checked these are true or I removed them</label> : null}
        </div>
      ) : a.claims.length ? <p className="ma-muted">Claims match your facts.</p> : null}
      {!editing ? (
        <div className="ma-row">
          <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          {!approved ? <button type="button" className="ma-primary" disabled={busy || (flagged.length > 0 && !checked)} onClick={() => onApprove(a.id, checked)}>Approve this angle</button> : null}
        </div>
      ) : null}
    </article>
  );
}

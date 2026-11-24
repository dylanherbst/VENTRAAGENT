'use client';
// The five-step AI Team setup: describe the business, choose the niche, set goals, connect social, approve the first plan.
// Each step calls an action that already exists; nothing is posted and no paid ads are created. A step moves on only when its action succeeded.
import { useState } from 'react';
import { connectAction, launchAction, saveConfigAction, saveProfileAction } from './actions';
import { formOf, label, payloadOf, PLATFORMS, toggle, type PlatformId } from './team-helpers';
import type { TeamView } from './view';

const STEPS = ['Describe your business', 'Choose your niche', 'Set your goals', 'Connect social', 'Approve your first plan'] as const;

export function SetupWizard({ business, view, onView, onDone }: { business: string; view: TeamView; onView: (v: TeamView) => void; onDone: () => void }) {
  const pr = view.profile;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [b, setB] = useState({ businessName: pr?.businessName ?? '', industry: pr?.industry ?? view.presets[0]?.id ?? 'fitness', offer: pr?.offer ?? '', audience: pr?.audience ?? '', region: pr?.region ?? 'Australia', timezone: pr?.timezone ?? 'Australia/Perth', website: pr?.website ?? '', facts: (pr?.facts ?? []).join('\n') });
  const [g, setG] = useState({ goals: (view.configs.social?.goals ?? []).join('\n'), platforms: (view.configs.social?.platforms ?? ['instagram']) as string[], approvalMode: (view.configs.social?.approvalMode ?? 'manual') as 'manual' | 'draft_only' });

  /** Runs one action. Returns the new view when it worked (no errors and a saved profile), else shows why and stays on this step. */
  async function call(p: Promise<TeamView | null>): Promise<TeamView | null> {
    setBusy(true); setNote(null);
    try {
      const n = await p;
      if (!n) { setNote('This page is not switched on here.'); return null; }
      onView(n);
      if (n.errors.length || !n.profile) { setNote(n.message ?? 'That did not save.'); return null; }
      return n;
    } catch { setNote('Something went wrong. Nothing was changed.'); return null; }
    finally { setBusy(false); }
  }

  const next = async () => {
    if (step === 0) { if (!b.businessName.trim() || !b.offer.trim()) { setNote('Add your business name and what you sell.'); return; } setNote(null); setStep(1); return; }
    if (step === 1) { const n = await call(saveProfileAction(business, b)); if (n) setStep(2); return; }
    if (step === 2) {
      if (!g.platforms.length) { setNote('Pick at least one platform.'); return; }
      const s = await call(saveConfigAction(business, 'social', payloadOf({ ...formOf(view.configs.social), presetId: b.industry, goals: g.goals, platforms: g.platforms, approvalMode: g.approvalMode })));
      if (!s) return;
      const m = await call(saveConfigAction(business, 'marketing', payloadOf({ ...formOf(s.configs.marketing), presetId: b.industry, goals: g.goals })));
      if (m) setStep(3);
      return;
    }
    if (step === 3) { setNote(null); setStep(4); return; }
  };
  const launch = async () => { const n = await call(launchAction(business, 7)); if (n) onDone(); };
  const connect = async (platform: PlatformId) => {
    setBusy(true); setNote(null);
    try { const r = await connectAction(business, platform); if (r.view) onView(r.view); if (r.redirect) window.location.href = r.redirect; }
    catch { setNote('Could not start the connection. Try again.'); }
    finally { setBusy(false); }
  };
  const connected = view.accounts.filter((a) => a.state === 'connected');
  const platforms = PLATFORMS.filter((x) => g.platforms.includes(x));

  return (
    <section className="at-card at-wizard" aria-labelledby="aw-title">
      <ol className="at-steps" aria-label="Setup steps">
        {STEPS.map((s, i) => <li key={s} data-state={i < step ? 'done' : i === step ? 'now' : 'later'} aria-current={i === step ? 'step' : undefined}><i aria-hidden="true">{i < step ? '✓' : i + 1}</i><span>{s}</span></li>)}
      </ol>
      <h2 id="aw-title">Step {step + 1} of 5: {STEPS[step]}</h2>

      {step === 0 ? (
        <div className="at-form">
          <label>Business name<input value={b.businessName} onChange={(e) => setB({ ...b, businessName: e.target.value })} maxLength={80} autoComplete="organization" /></label>
          <label>What you sell<textarea rows={2} value={b.offer} onChange={(e) => setB({ ...b, offer: e.target.value })} maxLength={400} /></label>
          <label>Who it is for<input value={b.audience} onChange={(e) => setB({ ...b, audience: e.target.value })} maxLength={300} /></label>
          <div className="at-row"><label>Region<input value={b.region} onChange={(e) => setB({ ...b, region: e.target.value })} /></label><label>Time zone<input value={b.timezone} onChange={(e) => setB({ ...b, timezone: e.target.value })} /></label></div>
          <label>Website (optional)<input value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} placeholder="https://" inputMode="url" /></label>
          <label>Facts you can prove, one per line<textarea rows={3} value={b.facts} onChange={(e) => setB({ ...b, facts: e.target.value })} placeholder={'First session free\n4.9 stars from 87 Google reviews'} /><span className="at-muted">Only these can be stated as true in your posts.</span></label>
        </div>
      ) : null}

      {step === 1 ? (
        <fieldset className="at-niches">
          <legend className="at-muted">Pick the closest match. It sets the starting tone, content types and posting rhythm.</legend>
          {view.presets.map((p) => <label key={p.id} className="at-niche" data-on={b.industry === p.id ? '' : undefined}><input type="radio" name="niche" checked={b.industry === p.id} onChange={() => setB({ ...b, industry: p.id })} /><span>{p.name}</span></label>)}
        </fieldset>
      ) : null}

      {step === 2 ? (
        <div className="at-form">
          <label>What do you want from social, one goal per line<textarea rows={3} value={g.goals} onChange={(e) => setG({ ...g, goals: e.target.value })} placeholder={'Get more first-time bookings\nShow our work'} /></label>
          <fieldset className="at-checks"><legend className="at-muted">Platforms</legend>{PLATFORMS.map((x) => <label key={x}><input type="checkbox" checked={g.platforms.includes(x)} onChange={() => setG({ ...g, platforms: toggle(g.platforms, x) })} /> {label(x)}</label>)}</fieldset>
          <label>Approval<select value={g.approvalMode} onChange={(e) => setG({ ...g, approvalMode: e.target.value === 'draft_only' ? 'draft_only' : 'manual' })}><option value="manual">Drafts, then I approve each post</option><option value="draft_only">Drafts only, I post myself</option></select></label>
          <p className="at-muted">Paid ads stay off. Nothing is posted without your approval.</p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="at-form">
          <p className="at-muted">Connect the accounts your posts will go to. You can skip this and connect later, but a post cannot be approved until its platform has an account.</p>
          <div className="at-row">{platforms.map((x) => <button key={x} type="button" disabled={busy} onClick={() => connect(x)}>Connect {label(x)}</button>)}</div>
          {connected.length ? <ul className="at-list">{connected.map((a) => <li key={a.id}><span>{label(a.platform)} @{a.username ?? a.accountId}</span><span className={`at-tag ${a.live ? 'live' : 'mock'}`}>{a.live ? 'Live' : 'Mock'}</span></li>)}</ul> : <p className="at-muted">No accounts connected yet.</p>}
          <p className="at-muted">{view.providers.publishing === 'live' ? 'Instagram needs a Business or Creator account.' : 'Mock mode: connecting adds a test account. Nothing can reach a real account until Zernio is set up.'}</p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="at-form">
          <p>Your Marketing agent will write five ad ideas, then your Social agent will plan 7 days of posts to match.</p>
          <ul className="at-list"><li><span>Posts are saved as drafts</span><span className="at-tag">Needs review</span></li><li><span>You approve each one before it can be scheduled</span><span className="at-tag ok">You decide</span></li><li><span>Paid ads</span><span className="at-tag">Off</span></li></ul>
        </div>
      ) : null}

      {note ? <p className="at-errors" role="alert" style={{ listStyle: 'none', paddingLeft: 0 }}>{note}</p> : null}
      <div className="at-row at-between at-wizard-nav">
        <button type="button" disabled={busy || step === 0} onClick={() => { setNote(null); setStep(step - 1); }}>Back</button>
        {step < 4
          ? <button type="button" className="at-primary" disabled={busy} onClick={next}>{busy ? 'Saving...' : step === 3 && !connected.length ? 'Skip for now' : step === 2 ? 'Save goals' : step === 1 ? 'Save business' : 'Next'}</button>
          : <button type="button" className="at-primary" disabled={busy} onClick={launch}>{busy ? 'Working...' : 'Write my first plan'}</button>}
      </div>
    </section>
  );
}

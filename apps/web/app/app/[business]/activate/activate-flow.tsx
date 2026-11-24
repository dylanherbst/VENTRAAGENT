'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveAutomationAction, saveKnowledgeAction, suggestAction, type ActivateView, type Suggestion } from './actions';
import { connectAction, launchAction } from '../ai-team/actions';
import '../ai-team/team.css';

const GOALS = ['Generate more leads', 'Get more bookings', 'Increase product sales', 'Grow social media', 'Increase brand awareness', 'Improve marketing performance', 'Save time through automation'];
const STEPS = ['Your customers', 'Connect platforms', 'Goals', 'Automation', 'Activate'];
const lines = (a?: string[]) => (a ?? []).join('\n');
type Platform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin';
const SUPPORT: { name: string; platform?: Platform; status: string }[] = [
  { name: 'Instagram (posts)', platform: 'instagram', status: 'Supported: Business or Creator accounts, through Zernio.' },
  { name: 'Facebook Page', platform: 'facebook', status: 'Supported, through Zernio.' },
  { name: 'TikTok', platform: 'tiktok', status: 'Drafts only for now. Publishing needs TikTok review.' },
  { name: 'LinkedIn', platform: 'linkedin', status: 'Drafts only for now.' },
  { name: 'Instagram DMs (AI Sales)', status: 'Needs our Meta app approval. Test it in AI Sales meanwhile.' },
  { name: 'WhatsApp, Google Business, ad accounts, booking systems', status: 'Not supported yet.' },
];

export function ActivateFlow({ business, initial }: { business: string; initial: ActivateView }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const p = v.profile;
  const [c, setC] = useState({ description: p?.description ?? '', location: p?.location ?? '', products: lines(p?.products), audience: p?.audience ?? '', painPoints: lines(p?.painPoints), competitors: lines(p?.competitors), usps: lines(p?.usps), bookingUrl: p?.bookingUrl ?? '', facts: lines(p?.facts) });
  const [goals, setGoals] = useState<string[]>(p?.goals ?? []);
  const [auto, setAuto] = useState({ postApproval: 'manual' as 'manual' | 'draft_only', salesMode: 'draft_only' as 'draft_only' | 'auto', confirmAuto: false, botQuestion: 'honest' as 'honest' | 'handoff', aiUsdPerMonth: 5, adBudgetMonthlyAud: p?.adBudgetMonthlyAud ?? 0 });
  const [done, setDone] = useState<string | null>(null);
  const run = async <T,>(f: () => Promise<T>) => { setBusy(true); setMsg(''); try { return await f(); } catch { setMsg('Something went wrong. Nothing was changed.'); return null; } finally { setBusy(false); } };
  const apply = (n: ActivateView | null) => { if (n) { setV(n); setMsg(n.errors.length ? `${n.message} ${n.errors.join(' ')}` : n.message ?? ''); } return !!n && !n.errors.length; };
  const fill = (s: Suggestion) => setC({ ...c, description: s.description || c.description, location: s.location || c.location, products: s.products?.length ? s.products.join('\n') : c.products,
    audience: s.audience || c.audience, painPoints: s.painPoints?.length ? s.painPoints.join('\n') : c.painPoints, usps: s.usps?.length ? s.usps.join('\n') : c.usps });
  const set = (k: keyof typeof c) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });

  return (
    <div className="at">
      <ol className="at-row" aria-label="Setup steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        <li><span className="at-tag ok">✓ Your business</span></li>
        {STEPS.map((s, i) => <li key={s}><span className={`at-tag ${i < step ? 'ok' : i === step ? 'peach' : ''}`} aria-current={i === step ? 'step' : undefined}>{i < step ? '✓ ' : `${i + 2}. `}{s}</span></li>)}
      </ol>
      {msg ? <p className="at-msg" role="status">{msg}</p> : null}

      {step === 0 ? (
        <div className="at-card at-form">
          <h2>Step 2 of 6: Understand your customers</h2>
          <p className="at-muted">Your three agents all read this. {p?.website ? 'We can read your website to fill it in for you.' : 'Add your website in Business Profile later to auto-fill.'} Check every line: only what you save here is treated as true.</p>
          <div className="at-row">
            {p?.website ? <button type="button" disabled={busy} onClick={async () => { const r = await run(() => suggestAction(business, true)); if (r) { setMsg(r.message); if (r.suggestion) fill(r.suggestion); } }}>Read my website</button> : null}
            <button type="button" disabled={busy || !v.aiLive} onClick={async () => { const r = await run(() => suggestAction(business, false)); if (r) { setMsg(r.message); if (r.suggestion) fill(r.suggestion); } }}>Suggest from my answers</button>
            {busy ? <span className="at-muted">Working…</span> : null}
          </div>
          <label>What the business does<textarea rows={3} value={c.description} onChange={set('description')} maxLength={800} /></label>
          <label>Where you are, and where your customers are<input value={c.location} onChange={set('location')} maxLength={120} placeholder="Joondalup, WA and northern suburbs" /></label>
          <label>Products and services, one per line (add prices if you like)<textarea rows={3} value={c.products} onChange={set('products')} /></label>
          <label>Ideal customer<input value={c.audience} onChange={set('audience')} maxLength={300} /></label>
          <label>Their problems, one per line<textarea rows={3} value={c.painPoints} onChange={set('painPoints')} /></label>
          <label>Why customers choose you, one per line<textarea rows={3} value={c.usps} onChange={set('usps')} /></label>
          <label>Competitors, one per line<textarea rows={2} value={c.competitors} onChange={set('competitors')} placeholder="Names of businesses your customers compare you with" /></label>
          <label>Facts you can prove, one per line<textarea rows={2} value={c.facts} onChange={set('facts')} placeholder={'4.9 stars from 87 Google reviews\nFirst session free'} /><span className="at-muted">Only these can be stated as true in ads, posts and DMs.</span></label>
          <label>Booking or buy link<input value={c.bookingUrl} onChange={set('bookingUrl')} placeholder="https://" /></label>
          <div className="at-row"><button className="at-primary" disabled={busy} onClick={async () => { if (apply(await run(() => saveKnowledgeAction(business, c)))) setStep(1); }}>Save and continue</button></div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="at-card">
          <h2>Step 3 of 6: Connect your platforms</h2>
          <p className="at-muted">{v.publishingLive ? 'Connecting opens the platform to sign in.' : 'Test mode: connecting adds a test account so you can try everything. Real accounts connect once publishing is set up.'}</p>
          <ul className="at-list">
            {SUPPORT.map((s) => {
              const acct = v.accounts.find((a) => a.platform === s.platform);
              return (
                <li key={s.name}><span><strong>{s.name}</strong><br /><span className="at-muted">{s.status}</span></span>
                  {s.platform ? acct ? <span className={`at-tag ${acct.live ? 'live' : 'mock'}`}>{acct.live ? 'Connected' : 'Test account'} @{acct.username}</span>
                    : <button type="button" disabled={busy} onClick={async () => { const r = await run(() => connectAction(business, s.platform!)); if (r?.redirect) { window.location.href = r.redirect; return; } const n = await run(() => saveKnowledgeAction(business, {})); if (n) setV(n); }}>Connect</button>
                    : <span className="at-tag">Not yet</span>}
                </li>
              );
            })}
          </ul>
          <div className="at-row"><button onClick={() => setStep(0)}>Back</button><button className="at-primary" onClick={() => setStep(2)}>Continue</button></div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="at-card at-form">
          <h2>Step 4 of 6: Your goals</h2>
          <fieldset className="at-checks">{GOALS.map((g) => <label key={g}><input type="checkbox" checked={goals.includes(g)} onChange={() => setGoals(goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g])} /> {g}</label>)}</fieldset>
          <div className="at-row"><button onClick={() => setStep(1)}>Back</button><button className="at-primary" disabled={busy || !goals.length} onClick={async () => { if (apply(await run(() => saveKnowledgeAction(business, { goals })))) setStep(3); }}>Save and continue</button></div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="at-card at-form">
          <h2>Step 5 of 6: How much the AI does on its own</h2>
          <label>Social posts<select value={auto.postApproval} onChange={(e) => setAuto({ ...auto, postApproval: e.target.value as 'manual' | 'draft_only' })}><option value="manual">Drafts, then I approve each post before it is scheduled</option><option value="draft_only">Drafts only, I post them myself</option></select></label>
          <label>AI Sales replies<select value={auto.salesMode} onChange={(e) => setAuto({ ...auto, salesMode: e.target.value as 'draft_only' | 'auto' })}><option value="draft_only">Drafts for me to approve</option><option value="auto">Reply automatically (low-confidence replies still come to me)</option></select></label>
          {auto.salesMode === 'auto' ? <label className="at-checks"><input type="checkbox" checked={auto.confirmAuto} onChange={(e) => setAuto({ ...auto, confirmAuto: e.target.checked })} /> I understand replies will be sent without me checking each one.</label> : null}
          <label>If someone asks whether they are talking to a bot<select value={auto.botQuestion} onChange={(e) => setAuto({ ...auto, botQuestion: e.target.value as 'honest' | 'handoff' })}><option value="honest">Answer honestly that it is the business&apos;s assistant</option><option value="handoff">Hand the chat to me</option></select></label>
          <div className="at-row">
            <label>AI spend limit (US$ a month)<input type="number" min={0} max={20} value={auto.aiUsdPerMonth} onChange={(e) => setAuto({ ...auto, aiUsdPerMonth: Number(e.target.value) })} /></label>
            <label>Ad budget you might spend (A$ a month)<input type="number" min={0} value={auto.adBudgetMonthlyAud} onChange={(e) => setAuto({ ...auto, adBudgetMonthlyAud: Number(e.target.value) })} /></label>
          </div>
          <p className="at-muted">Paid ads are never launched or changed without your approval. People asking for a human, complaints and opt-outs always come to you.</p>
          <div className="at-row"><button onClick={() => setStep(2)}>Back</button><button className="at-primary" disabled={busy} onClick={async () => { if (apply(await run(() => saveAutomationAction(business, auto)))) setStep(4); }}>Save and continue</button></div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="at-card">
          <h2>Step 6 of 6: Activate your AI team</h2>
          <ul className="at-list">
            <li><span><strong>Marketing agent</strong> writes five different ad angles from your profile, with image and video briefs.</span><span className="at-tag">You approve</span></li>
            <li><span><strong>Social Media agent</strong> plans your first 7 days of posts to match, with captions and visuals.</span><span className="at-tag">You approve each post</span></li>
            <li><span><strong>AI Sales agent</strong> answers DMs in your voice, qualifies people and sends your link.</span><span className="at-tag">{auto.salesMode === 'auto' ? 'Automatic' : 'Drafts'}</span></li>
            <li><span><strong>Growth Manager</strong> builds your daily plan on Home and flags what needs you.</span><span className="at-tag">Always on</span></li>
          </ul>
          {done ? <p className="at-msg">{done}</p> : null}
          <div className="at-row">
            <button onClick={() => setStep(3)} disabled={busy}>Back</button>
            {!done ? <button className="at-primary" disabled={busy} onClick={async () => { const r = await run(() => launchAction(business, 7)); if (r) setDone(r.message ?? 'Your team is working.'); }}>{busy ? 'Your team is working… (about a minute)' : 'Activate my AI team'}</button>
              : <button className="at-primary" onClick={() => router.push(`/app/${business}/home`)}>Go to Home</button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

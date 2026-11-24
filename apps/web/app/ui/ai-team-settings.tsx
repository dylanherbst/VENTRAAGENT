'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchWorkspaces } from './workspace-list';
import type { AgentSettings, Faq, Hours, TemplateId } from '../../lib/front-office/settings';

// Your AI team's settings (workspace owners). Real data: saved to your workspace and used by the AI Setter (chat, SMS,
// email, DMs) and the AI Receptionist (phone). Start from the gym template; add your own FAQ answers, hours and
// contacts. The AI only states facts written here; everything else becomes a message for your team.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Load = { settings: AgentSettings; revision: number; saved: boolean };
const field = { display: 'block', width: '100%' } as const;

export default function AgentSettingsPage() {
  const [workspace, setWorkspace] = useState('');
  const [s, setS] = useState<AgentSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('Checking…');
  const load = useCallback(async (w: string, template?: TemplateId) => {
    const r = await fetch('/api/front-office/settings?workspace=' + encodeURIComponent(w) + (template ? '&template=' + template : ''), { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json().catch(() => ({})) as Partial<Load> & { error?: string };
    if (!r.ok || !j.settings) { setNote(j.error ?? 'Settings unavailable.'); return; }
    setS(j.settings); setRevision(j.revision ?? 0); setSaved(!!j.saved); setNote(j.saved ? '' : 'Not saved yet: this is the template. Fill in your details and save.');
  }, []);
  useEffect(() => {
    fetchWorkspaces().then(async r => {
      const b = await r.json().catch(() => null);
      if (r.ok && b?.workspaces?.length) { setWorkspace(b.workspaces[0].id); void load(b.workspaces[0].id); }
      else setNote(r.status === 401 ? 'Sign in to edit your AI team.' : 'Account storage is not available here.');
    }).catch(() => setNote('Account storage is not available here.'));
  }, [load]);
  const set = <K extends keyof AgentSettings>(k: K, v: AgentSettings[K]) => setS(x => x ? { ...x, [k]: v } : x);
  async function save() {
    if (!s) return;
    setNote('Saving…');
    const r = await fetch('/api/front-office/settings?workspace=' + encodeURIComponent(workspace), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s, revision }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(j.error ?? 'Could not save.'); return; }
    setS(j.settings); setRevision(j.revision); setSaved(true); setNote('Saved. The AI uses these from the next message or call.');
  }
  const hoursText = (h: Hours, d: number) => (h[String(d) as keyof Hours] ?? []).map(w => w.join('-')).join(', ');
  function setHours(d: number, text: string) {
    if (!s) return;
    const windows = text.split(',').map(x => x.trim()).filter(Boolean).map(x => x.split('-').map(y => y.trim()) as [string, string]);
    const h = { ...s.hours }; if (windows.length) h[String(d) as keyof Hours] = windows; else delete h[String(d) as keyof Hours];
    set('hours', h);
  }
  const setFaq = (i: number, f: Faq) => set('faqs', (s?.faqs ?? []).map((x, j) => j === i ? f : x));

  const status = (on: boolean, label: string) => <span className="v-status">{label}: {on ? 'On' : 'Off'}</span>;
  return <section className="v-glass" aria-labelledby="ai-team-title">
    <h1 id="ai-team-title">Your AI team</h1>
    <p><span className="v-status" data-testid="page-mode">{!workspace ? 'NOT SIGNED IN' : saved ? 'LIVE · Saved to your workspace' : 'NOT SAVED YET'}</span> What your AI Setter and AI Receptionist say and do. They only state facts you write here.</p>
    {note && <p role="status">{note}</p>}
    {s && <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <p>{status(s.setterOn, 'Setter')} {status(s.receptionistOn, 'Receptionist')} {status(s.voiceOn, 'Phone answering')} <small>Phone calls also need a Vapi assistant and the owner’s live-voice approval.</small></p>
      <fieldset><legend>Business</legend>
        <label htmlFor="as-template">Template</label>
        <select id="as-template" value={s.template} onChange={e => { const t = e.target.value as TemplateId; if (!saved && workspace) void load(workspace, t); else set('template', t); }}>
          <option value="gym">Gym or fitness studio</option><option value="ventra">Ventra (our own)</option><option value="custom">Custom</option>
        </select>
        <label htmlFor="as-name">Business name</label><input id="as-name" style={field} value={s.businessName} maxLength={160} onChange={e => set('businessName', e.target.value)} required />
        <label htmlFor="as-offer">What the AI books or sells</label><textarea id="as-offer" style={field} rows={2} maxLength={600} value={s.offer} onChange={e => set('offer', e.target.value)} />
        <label htmlFor="as-fit">Good fit</label><input id="as-fit" style={field} maxLength={400} value={s.idealCustomer} onChange={e => set('idealCustomer', e.target.value)} />
        <label htmlFor="as-notfit">Not a fit</label><input id="as-notfit" style={field} maxLength={400} value={s.notAFit} onChange={e => set('notAFit', e.target.value)} />
      </fieldset>
      <fieldset><legend>Bookings</legend>
        <label htmlFor="as-type">Booking type</label><input id="as-type" style={field} maxLength={80} value={s.bookingType} onChange={e => set('bookingType', e.target.value)} />
        <label htmlFor="as-where">Where it happens</label><input id="as-where" style={field} maxLength={80} value={s.bookingWhere} onChange={e => set('bookingWhere', e.target.value)} />
        <label htmlFor="as-min">Length (minutes)</label><input id="as-min" type="number" min={10} max={240} value={s.bookingMinutes} onChange={e => set('bookingMinutes', Number(e.target.value))} />
        <label htmlFor="as-tz">Time zone</label><input id="as-tz" style={field} value={s.timeZone} onChange={e => set('timeZone', e.target.value)} />
        <p><small>Booking hours, for example 06:00-10:00, 16:00-19:00. Leave a day empty when nobody takes bookings. No hours: the AI takes a message instead of booking.</small></p>
        {DAYS.map((d, i) => <div key={`${d}-${s.template}-${revision}`}><label htmlFor={'as-h' + i}>{d}</label><input id={'as-h' + i} style={field} placeholder="Closed" defaultValue={hoursText(s.hours, i)} onBlur={e => setHours(i, e.target.value)} /></div>)}
      </fieldset>
      <fieldset><legend>Qualifying questions (3 to 5)</legend>
        {s.questions.map((q, i) => <div key={q.id}>
          <label htmlFor={'as-q' + i}>{q.id}{q.required ? '' : ' (optional)'}</label>
          <input id={'as-q' + i} style={field} maxLength={300} value={q.ask} onChange={e => set('questions', s.questions.map((x, j) => j === i ? { ...x, ask: e.target.value } : x))} />
        </div>)}
      </fieldset>
      <fieldset><legend>FAQ answers (the only facts the AI will state)</legend>
        {!s.faqs.length && <p><small>None yet. Add your prices, opening hours, classes, location and parking so the AI can answer them.</small></p>}
        {s.faqs.map((f, i) => <div key={i}>
          <input aria-label={`Question ${i + 1}`} style={field} maxLength={200} placeholder="Question, e.g. What are your opening hours?" value={f.q} onChange={e => setFaq(i, { ...f, q: e.target.value })} />
          <textarea aria-label={`Answer ${i + 1}`} style={field} rows={2} maxLength={600} placeholder="Your answer" value={f.a} onChange={e => setFaq(i, { ...f, a: e.target.value })} />
          <button type="button" onClick={() => set('faqs', s.faqs.filter((_, j) => j !== i))}>Remove</button>
        </div>)}
        {s.faqs.length < 40 && <button type="button" onClick={() => set('faqs', [...s.faqs, { q: '', a: '' }])}>Add a question</button>}
      </fieldset>
      <fieldset><legend>Your team</legend>
        <label htmlFor="as-sp">Staff mobile for messages (+61…)</label><input id="as-sp" style={field} value={s.staffPhone ?? ''} onChange={e => set('staffPhone', e.target.value || null)} />
        <label htmlFor="as-se">Staff email for messages</label><input id="as-se" style={field} type="email" value={s.staffEmail ?? ''} onChange={e => set('staffEmail', e.target.value || null)} />
        <label htmlFor="as-tn">Transfer urgent calls to (+61…)</label><input id="as-tn" style={field} value={s.transferNumber ?? ''} onChange={e => set('transferNumber', e.target.value || null)} />
      </fieldset>
      <fieldset><legend>Phone greeting</legend>
        <label htmlFor="as-g">Greeting</label><input id="as-g" style={field} maxLength={200} value={s.greeting} onChange={e => set('greeting', e.target.value)} />
        <label htmlFor="as-ai">AI disclosure (always said)</label><input id="as-ai" style={field} maxLength={200} value={s.aiDisclosure} onChange={e => set('aiDisclosure', e.target.value)} />
        <label htmlFor="as-rec">Call recording notice (read at the start when set)</label><input id="as-rec" style={field} maxLength={300} value={s.recordingNotice} placeholder="e.g. This call may be recorded for quality and training." onChange={e => set('recordingNotice', e.target.value)} />
      </fieldset>
      <fieldset><legend>Switch on or off</legend>
        <label><input type="checkbox" checked={s.setterOn} onChange={e => set('setterOn', e.target.checked)} /> AI Setter replies to new leads</label>
        <label><input type="checkbox" checked={s.receptionistOn} onChange={e => set('receptionistOn', e.target.checked)} /> AI Receptionist</label>
        <label><input type="checkbox" checked={s.voiceOn} onChange={e => set('voiceOn', e.target.checked)} /> Answer phone calls</label>
      </fieldset>
      <button type="submit" disabled={!workspace}>Save</button>
    </form>}
  </section>;
}

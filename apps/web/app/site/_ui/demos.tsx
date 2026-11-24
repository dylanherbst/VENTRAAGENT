'use client';
import { useEffect, useRef, useState } from 'react';
import { demos, pillarById } from '../../../lib/site/content';
import type { DemoId } from '../../../lib/site/content';
import { Icon } from './icons';
import { StatusPill } from './status';
import { useJourney } from './journey';
import { track } from './track';

// Every demo on the site is a scripted, labelled preview. It never places a call, sends a message or books anything.
type Line = { who: 'them' | 'ai' | 'sys'; text: string; stage?: number; book?: boolean };
const reduced = () => typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function usePlayer(lines: Line[], onStart?: () => void) {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!playing) return;
    if (shown >= lines.length) { setPlaying(false); return; }
    timer.current = window.setTimeout(() => setShown(n => n + 1), reduced() ? 60 : shown === 0 ? 400 : lines[shown].who === 'ai' ? 1500 : 1100);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [playing, shown, lines]);
  const play = () => { setShown(0); setPlaying(true); onStart?.(); };
  const visible = lines.slice(0, shown);
  const stage = visible.reduce((s, l) => Math.max(s, l.stage ?? 0), 0);
  const booked = visible.some(l => l.book);
  return { visible, playing, play, stage, booked, done: shown >= lines.length && shown > 0 };
}

function Pipeline({ steps, stage }: { steps: string[]; stage: number }) {
  return <div className="vs-pipe" aria-label="Progress">{steps.map((s, i) => <span key={s} style={{ display: 'contents' }}>{i > 0 && <i />}<span className={i < stage ? 'on' : ''}>{s}</span></span>)}</div>;
}
function Calendar({ booked, day = 'Fri', time = '10:30' }: { booked: boolean; day?: string; time?: string }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return <div className="vs-cal" aria-label="Sample calendar">{days.map((d, i) => <div key={d} className={booked && d === day ? 'booked' : i % 2 ? 'busy' : ''}><b>{d}</b>{booked && d === day ? `${time} booked` : i % 2 ? 'Busy' : 'Open'}</div>)}</div>;
}
function Messages({ lines }: { lines: Line[] }) {
  return <div className="vs-msgs" aria-live="polite">{lines.length === 0 && <p className="vs-hint">Press play for a sample conversation.</p>}{lines.map((l, i) => <div key={i} className={`vs-msg ${l.who}`}>{l.text}</div>)}</div>;
}

const receptionistScript: Line[] = [
  { who: 'sys', text: 'Incoming call · Harbour Physio', stage: 1 },
  { who: 'ai', text: 'Hi, thanks for calling Harbour Physio, I’m the AI receptionist. How can I help?', stage: 2 },
  { who: 'them', text: 'Hi, I’d like to book an appointment for Friday.', stage: 3 },
  { who: 'ai', text: 'Sure. Checking Friday… I have 10:30 am or 2:15 pm. Which suits you?', stage: 4 },
  { who: 'them', text: '10:30 is perfect.' },
  { who: 'ai', text: 'Done: Friday at 10:30 am. I’ll text you a confirmation now.', stage: 5, book: true },
  { who: 'sys', text: 'Contact and call summary saved to CRM', stage: 6 },
];
export function ReceptionistDemo() {
  const p = usePlayer(receptionistScript, () => track('receptionist_demo'));
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="vs-phone">
      <div className="vs-phone-head"><div className={`vs-avatar ${p.playing && p.stage < 2 ? 'ring' : ''}`} /><div><b>Harbour Physio</b><span>{p.stage === 0 ? 'Sample business' : p.done ? 'Call ended · 0:42' : 'AI receptionist on the line'}</span></div></div>
      <Messages lines={p.visible} />
      <button className="vs-btn vs-btn-primary vs-btn-sm" onClick={p.play} style={{ alignSelf: 'center' }}>{p.done ? 'Replay call' : p.playing ? 'Playing…' : 'Hear the AI Receptionist'}</button>
    </div>
    <Pipeline steps={['Incoming call', 'AI answers', 'Enquiry', 'Calendar checked', 'Booked', 'CRM updated']} stage={p.stage} />
    <Calendar booked={p.booked} />
    <p className="vs-note">Simulated preview. The AI Receptionist is coming soon; this is not a real call.</p>
  </div>;
}

const setterScripts: Record<'instagram' | 'sms' | 'phone', { steps: string[]; lines: Line[]; note: string; day: string; time: string }> = {
  instagram: { steps: ['Instagram enquiry', 'AI replies', 'Qualified', 'Time offered', 'Booked', 'CRM updated'], day: 'Thu', time: '4:00', note: 'Simulated preview. Instagram connection is coming soon, through Meta’s official API.',
    lines: [
      { who: 'sys', text: 'New DM on @studio.flow', stage: 1 },
      { who: 'them', text: 'Hey! How much are your intro classes?' },
      { who: 'ai', text: 'Hi! I’m Studio Flow’s AI assistant. Intro week is $29. Are you after mornings or evenings?', stage: 2 },
      { who: 'them', text: 'Evenings, I work 9 to 5.' },
      { who: 'ai', text: 'Perfect. Have you done reformer before, or is this your first time?', stage: 3 },
      { who: 'them', text: 'First time!' },
      { who: 'ai', text: 'Great. I can book you into a beginner class Thursday 4:00 pm or Friday 5:30 pm?', stage: 4 },
      { who: 'them', text: 'Thursday please' },
      { who: 'ai', text: 'You’re booked: Thursday 4:00 pm. Confirmation and a reminder are on their way.', stage: 5, book: true },
      { who: 'sys', text: 'Lead added to pipeline · Booked', stage: 6 },
    ] },
  sms: { steps: ['Text received', 'AI replies', 'Qualified', 'Time offered', 'Booked', 'CRM updated'], day: 'Tue', time: '9:00', note: 'Preview of the AI Setter by text. Built and being switched on for customers.',
    lines: [
      { who: 'sys', text: 'Text to Ventra · 7:42 pm', stage: 1 },
      { who: 'them', text: 'Hi, saw your ad. Do you work with gyms?' },
      { who: 'ai', text: 'Hi, it’s the Ventra AI assistant. Yes! Roughly how many enquiries do you get a week?', stage: 2 },
      { who: 'them', text: 'About 40, lots go unanswered at night' },
      { who: 'ai', text: 'That’s exactly what we fix. How soon would you want this running?', stage: 3 },
      { who: 'them', text: 'This month ideally' },
      { who: 'ai', text: 'Let’s book a free 30-min call. Tue 9:00 am or Wed 2:30 pm?', stage: 4 },
      { who: 'them', text: 'Tue works' },
      { who: 'ai', text: 'You’re booked for Tue 9:00 am. We’ll text a reminder the day before. Reply STOP to opt out.', stage: 5, book: true },
      { who: 'sys', text: 'Answers saved · Handed to Sales', stage: 6 },
    ] },
  phone: { steps: ['Sales call', 'AI qualifies', 'Objection handled', 'Time offered', 'Booked', 'CRM updated'], day: 'Wed', time: '11:00', note: 'Simulated preview. Phone conversations are coming soon, only with people who opted in.',
    lines: [
      { who: 'sys', text: 'Inbound sales call', stage: 1 },
      { who: 'ai', text: 'Hi, you’ve reached Ventra, I’m the AI assistant. What made you get in touch?', stage: 2 },
      { who: 'them', text: 'We’re missing calls while we’re with clients.' },
      { who: 'ai', text: 'Got it. How many calls a day roughly go unanswered?' },
      { who: 'them', text: 'Maybe five. Is this expensive though?', stage: 3 },
      { who: 'ai', text: 'Pricing depends on volume, and the team covers it on a free call. Wed 11:00 am or Thu 3:00 pm?', stage: 4 },
      { who: 'them', text: 'Wednesday.' },
      { who: 'ai', text: 'Booked: Wednesday 11:00 am. You’ll get a text confirmation now.', stage: 5, book: true },
      { who: 'sys', text: 'Call outcome saved to CRM', stage: 6 },
    ] },
};
export function SetterDemo() {
  const [mode, setMode] = useState<keyof typeof setterScripts>('instagram');
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="vs-seg" role="group" aria-label="Channel">
      {(['instagram', 'sms', 'phone'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'instagram' ? 'Instagram' : m === 'sms' ? 'Text' : 'Phone'}</button>)}
    </div>
    <SetterThread key={mode} mode={mode} />
  </div>;
}
function SetterThread({ mode }: { mode: keyof typeof setterScripts }) {
  const s = setterScripts[mode];
  const p = usePlayer(s.lines, () => track('setter_demo', { channel: mode }));
  return <>
    <div className="vs-phone vs-light">
      <div className="vs-phone-head"><div className="vs-ico"><Icon name={mode === 'instagram' ? 'insta' : mode === 'sms' ? 'chat' : 'phone'} /></div><div><b>{mode === 'instagram' ? 'Instagram DM' : mode === 'sms' ? 'Text message' : 'Phone call'}</b><span>{p.done ? 'Appointment confirmed' : 'AI Sales Setter'}</span></div></div>
      <Messages lines={p.visible} />
      <button className="vs-btn vs-btn-primary vs-btn-sm" onClick={p.play} style={{ alignSelf: 'center' }}>{p.done ? 'Replay' : p.playing ? 'Playing…' : 'Watch the AI Setter'}</button>
    </div>
    <Pipeline steps={s.steps} stage={p.stage} />
    <Calendar booked={p.booked} day={s.day} time={s.time} />
    <p className="vs-note">{s.note}</p>
  </>;
}

/** Section 4: tabs across the six product areas; the chosen journey decides which tab opens first. */
export function InAction() {
  const { journey } = useJourney();
  const [tab, setTab] = useState<DemoId>('booking');
  useEffect(() => {
    if (journey) setTab(journey.demo);
  }, [journey]);
  const d = demos.find(x => x.id === tab) ?? demos[0];
  return <>
    <div className="vs-tabs" role="tablist" aria-label="Product demos">
      {demos.map(x => <button key={x.id} role="tab" aria-selected={x.id === tab} aria-controls="demo-panel" onClick={() => { setTab(x.id); track('demo_tab', { tab: x.id }); }}>{x.tab}</button>)}
    </div>
    <div id="demo-panel" role="tabpanel" className="vs-glass vs-stagepanel">
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <StatusPill status={d.status} />
        <h3>{d.title}</h3>
        <p>{blurb[tab]}</p>
      </div>
      <div key={tab}>{tab === 'receptionist' ? <ReceptionistDemo /> : tab === 'social' || tab === 'booking' ? <SetterThreadStandalone mode={tab === 'social' ? 'instagram' : 'sms'} /> : <Mock id={tab} />}</div>
    </div>
  </>;
}
function SetterThreadStandalone({ mode }: { mode: 'instagram' | 'sms' }) { return <div style={{ display: 'grid', gap: 14 }}><SetterThread mode={mode} /></div>; }
const blurb: Record<DemoId, string> = {
  plan: pillarById('launcher').summary,
  course: pillarById('courses').summary,
  receptionist: pillarById('receptionist').summary,
  social: 'Comments and DMs answered in seconds, qualified with your questions, and moved to a booking.',
  booking: pillarById('setter').summary,
  crm: pillarById('growth').summary,
};
function Mock({ id }: { id: 'plan' | 'course' | 'crm' }) {
  if (id === 'plan') return <div className="vs-mock" aria-label="Sample business plan">
    {[['Idea', 'Mobile dog grooming'], ['Customer', 'Busy pet owners, 5 km radius'], ['Offer', 'Full groom at your door'], ['Price', '$95 · 3 a day'], ['Month 1 goal', '20 regular clients']].map(([k, v], i) => <div key={k} className="vs-mock-row" style={{ animationDelay: `${i * 120}ms` }}><b>{k}</b><span>{v}</span></div>)}
    <small style={{ color: 'var(--faint)' }}>Launch readiness</small><div className="vs-bar"><i style={{ width: '72%' }} /></div>
  </div>;
  if (id === 'course') return <div className="vs-mock" aria-label="Sample course outline">
    {[['Module 1', 'Foundations · 4 lessons'], ['Module 2', 'Your first client · 5 lessons + quiz'], ['Module 3', 'Pricing with confidence · 3 lessons'], ['Module 4', 'Growing by referral · 4 lessons']].map(([k, v], i) => <div key={k} className="vs-mock-row" style={{ animationDelay: `${i * 140}ms` }}><b>{k}</b><span>{v}</span></div>)}
    <small style={{ color: 'var(--faint)' }}>Course built</small><div className="vs-bar"><i style={{ width: '58%' }} /></div>
  </div>;
  return <div className="vs-mock" aria-label="Sample pipeline">
    <div className="vs-kanban">
      <div><small>New</small><p>Sam · Gym</p><p>Priya · Clinic</p></div>
      <div><small>Qualified</small><p>Leo · Café</p></div>
      <div><small>Booked</small><p>Mia · Studio</p><p>Tom · Trades</p></div>
    </div>
    <div className="vs-mock-row"><b>This week</b><span>Sample data</span></div>
  </div>;
}

/** Section 5: two flows, lighting up step by step when they scroll into view. */
export function Workflow({ title, steps }: { title: string; steps: { label: string; icon: Parameters<typeof Icon>[0]['name'] }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let t: number | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (reduced()) { setOn(steps.length); return; }
      let i = 0; const tick = () => { i += 1; setOn(i); if (i < steps.length) t = window.setTimeout(tick, 450); }; tick();
    }, { threshold: .4 });
    io.observe(el); return () => { io.disconnect(); if (t) window.clearTimeout(t); };
  }, [steps.length]);
  return <div ref={ref} className="vs-glass vs-flow">
    <h3>{title}</h3>
    <div className="vs-flow-steps">{steps.map((s, i) => <span key={s.label} style={{ display: 'contents' }}>{i > 0 && <span className="vs-link" aria-hidden="true" />}<div className={`vs-step ${i < on ? 'on' : ''}`}><span className="vs-ico"><Icon name={s.icon} /></span><b>{s.label}</b></div></span>)}</div>
  </div>;
}

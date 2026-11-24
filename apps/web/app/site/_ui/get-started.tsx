'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { contactEmail, journeys, plans } from '../../../lib/site/content';
import type { Journey } from '../../../lib/site/content';
import { Icon } from './icons';
import { useJourney } from './journey';
import { consent, setConsent, track } from './track';

// Get Started. Online checkout stays closed until real prices, Stripe and the owner's approval exist (lib/site/content.ts
// checkoutReady). Until then the fastest honest path is: pick your goal, then book a free strategy call with Ventra's own
// AI Setter in the chat below (the product selling itself), or email us.
type Open = (from: string) => void;
const SheetCtx = createContext<Open>(() => {});
export const useGetStarted = () => useContext(SheetCtx);

export function GetStartedProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSheet: Open = (from) => { setOpen(true); track('get_started_open', { from }); };
  return <SheetCtx.Provider value={openSheet}>{children}{open && <Sheet onClose={() => setOpen(false)} />}<Sticky /><Consent /></SheetCtx.Provider>;
}

export function GetStartedButton({ label = 'Get Started', from, ghost = false, small = false }: { label?: string; from: string; ghost?: boolean; small?: boolean }) {
  const open = useGetStarted();
  return <button className={`vs-btn ${ghost ? 'vs-btn-ghost' : 'vs-btn-primary'} ${small ? 'vs-btn-sm' : ''}`} onClick={() => { track('cta_click', { from, label }); open(from); }}>{label}</button>;
}

type Line = { who: 'them' | 'ai' | 'sys'; text: string };
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
function visitor(): string {
  try { const v = localStorage.getItem('ventra-chat-visitor'); if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v; const n = 'v_' + newId(); localStorage.setItem('ventra-chat-visitor', n); return n; } catch { return 'v_' + newId(); }
}

function Sheet({ onClose }: { onClose: () => void }) {
  const { journey, choose } = useJourney();
  const [goal, setGoal] = useState<Journey['id'] | null>(journey?.id ?? null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatState, setChatState] = useState<'unknown' | 'ready' | 'offline'>('unknown');
  const box = useRef<HTMLDivElement>(null);
  const v = useRef('');
  useEffect(() => {
    v.current = visitor();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    fetch('/api/front-office/chat?visitor=' + v.current).then(r => setChatState(r.status === 503 ? 'offline' : r.ok ? 'ready' : 'offline')).catch(() => setChatState('offline'));
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [lines]);
  const pick = (id: Journey['id']) => {
    setGoal(id); choose(id);
    if (!lines.length) setLines([{ who: 'ai', text: 'Hi, I’m Ventra’s AI assistant. Tell me a little about your business and I’ll book you a free 30-minute strategy call.' }]);
  };
  async function send() {
    const message = text.trim(); if (!message || busy) return;
    setBusy(true); setText(''); setLines(l => [...l, { who: 'them', text: message }]); track('chat_message', { goal });
    try {
      const prefix = lines.filter(l => l.who === 'them').length === 0 && goal ? `[Goal: ${journeys.find(j => j.id === goal)?.title}] ` : '';
      const r = await fetch('/api/front-office/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: v.current, message: prefix + message, id: newId() }) });
      const j = await r.json().catch(() => ({}));
      setLines(l => [...l, r.ok ? { who: j.reply ? 'ai' : 'sys', text: j.reply ?? j.note ?? 'Thanks, the team will reply soon.' } : { who: 'sys', text: j.error ?? 'Chat is unavailable. Please email us.' }]);
    } catch { setLines(l => [...l, { who: 'sys', text: 'Chat is unavailable. Please email us.' }]); }
    finally { setBusy(false); }
  }
  const mail = `mailto:${contactEmail}?subject=${encodeURIComponent('Get started with VENTRA')}&body=${encodeURIComponent(`Hi Ventra,\n\nI'd like to get started${goal ? ` (${journeys.find(j => j.id === goal)?.title})` : ''}.\n\nMy business: \nBest time to call: \n`)}`;
  return <div className="vs-sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="vs-sheet" role="dialog" aria-modal="true" aria-labelledby="gs-title">
      <div className="vs-sheet-head"><div><span className="vs-eyebrow">Get started</span><h3 id="gs-title">What do you want VENTRA to do first?</h3></div><button className="vs-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
      <div className="vs-choice" role="group" aria-label="Your goal">
        {journeys.map(j => <button key={j.id} aria-pressed={goal === j.id} onClick={() => pick(j.id)}>{j.title}<Icon name={goal === j.id ? 'check' : 'arrow'} /></button>)}
      </div>
      {goal && chatState === 'ready' && <div className="vs-chat">
        <div className="vs-msgs" ref={box} aria-live="polite">{lines.map((l, i) => <div key={i} className={`vs-msg ${l.who}`} style={l.who === 'them' ? { alignSelf: 'flex-end', background: 'var(--ink)', color: '#fff' } : l.who === 'ai' ? { alignSelf: 'flex-start', background: '#EEF6F6', color: 'var(--text)' } : {}}>{l.text}</div>)}</div>
        <form className="vs-input" onSubmit={e => { e.preventDefault(); void send(); }}>
          <input aria-label="Message" placeholder="Type your message" value={text} onChange={e => setText(e.target.value)} maxLength={2000} />
          <button className="vs-btn vs-btn-primary vs-btn-sm" disabled={busy} type="submit">{busy ? '…' : 'Send'}</button>
        </form>
        <p className="vs-fine">You’re chatting with an AI assistant, and a person from our team can step in at any time. Messages are stored to reply to you (see our privacy policy).</p>
      </div>}
      {goal && chatState !== 'ready' && <a className="vs-btn vs-btn-primary" href={mail} onClick={() => track('email_capture', { goal })}>Book a free strategy call by email</a>}
      {goal && <div className="vs-glass vs-card" style={{ padding: 16 }}>
        <b style={{ color: 'var(--ink)' }}>Online checkout</b>
        <p style={{ fontSize: 14, marginTop: 4 }}>{plans.every(p => p.priceMonthlyAud === null) ? 'Opens soon with Apple Pay and Google Pay. For now, pricing is confirmed on your free call and nothing is charged online.' : 'Opens soon. Nothing is charged online yet.'}</p>
      </div>}
      <p className="vs-fine">Prefer email? <a href={mail} style={{ textDecoration: 'underline' }}>{contactEmail}</a></p>
    </div>
  </div>;
}

function Sticky() {
  const open = useGetStarted();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 640 && window.innerHeight + window.scrollY < document.body.scrollHeight - 260);
    on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on);
  }, []);
  return <div className={`vs-sticky vs-glass ${show ? '' : 'hide'}`} aria-hidden={!show}>
    <b>Start with VENTRA</b>
    <button className="vs-btn vs-btn-primary vs-btn-sm" tabIndex={show ? 0 : -1} onClick={() => { track('cta_click', { from: 'sticky' }); open('sticky'); }}>Get Started</button>
  </div>;
}

function Consent() {
  const [ask, setAsk] = useState(false);
  useEffect(() => { const c = consent(); if (c === null) setAsk(true); else if (c === 'yes') track('page_view'); }, []);
  if (!ask) return null;
  return <div className="vs-consent vs-glass" role="region" aria-label="Analytics choice">
    <span>Can we count visits and clicks to improve this site? No ads, no selling data.</span>
    <span className="vs-row"><button className="vs-btn vs-btn-ghost vs-btn-sm" onClick={() => { setConsent('no'); setAsk(false); }}>No thanks</button><button className="vs-btn vs-btn-primary vs-btn-sm" onClick={() => { setConsent('yes'); setAsk(false); }}>Allow</button></span>
  </div>;
}

/** Fires one pricing_view when the pricing section is seen. */
export function PricingSeen() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { track('pricing_view'); io.disconnect(); } }, { threshold: .3 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}

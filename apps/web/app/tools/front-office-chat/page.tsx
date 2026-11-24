'use client';
import { useEffect, useRef, useState } from 'react';

// Isolated test page for the website chat (tracker 1.8). It talks to the real /api/front-office/chat route.
// LIVE = the AI answers (FRONT_OFFICE_CHAT_LIVE=1); RECORDING = messages are stored and a person replies; NOT CONNECTED = no chat channel.
type Line = { who: 'you' | 'ventra' | 'note'; text: string };
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
function visitorId(): string {
  try {
    const saved = localStorage.getItem('ventra-chat-visitor');
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const v = 'v_' + newId(); localStorage.setItem('ventra-chat-visitor', v); return v;
  } catch { return 'v_' + newId(); }
}
export default function FrontOfficeChatTest() {
  const [visitor, setVisitor] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<'CHECKING' | 'LIVE' | 'RECORDING' | 'NOT CONNECTED'>('CHECKING');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const v = visitorId(); setVisitor(v);
    fetch('/api/front-office/chat?visitor=' + v).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j.configured === false) { setMode('NOT CONNECTED'); return; }
      setMode('RECORDING');
      if (Array.isArray(j.messages)) setLines(j.messages.map((m: { direction: string; body: string }) => ({ who: m.direction === 'inbound' ? 'you' : 'ventra', text: m.body })));
    }).catch(() => setMode('NOT CONNECTED'));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [lines]);
  async function send() {
    const message = text.trim(); if (!message || busy) return;
    setBusy(true); setText(''); setLines(l => [...l, { who: 'you', text: message }]);
    try {
      const r = await fetch('/api/front-office/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor, message, id: newId() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setLines(l => [...l, { who: 'note', text: j.error ?? 'Something went wrong.' }]);
      else {
        setMode(j.live ? 'LIVE' : 'RECORDING');
        setLines(l => [...l, j.reply ? { who: 'ventra', text: j.reply } : { who: 'note', text: j.note ?? 'Message received.' }]);
      }
    } finally { setBusy(false); }
  }
  return <main>
    <h1>Website chat test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode}</span> Uses the real chat route. Messages here are stored as a real web chat contact.</p>
    <ol aria-live="polite" data-testid="chat-lines">{lines.map((l, i) => <li key={i}><strong>{l.who === 'you' ? 'You' : l.who === 'ventra' ? 'Ventra' : 'Note'}:</strong> {l.text}</li>)}<li ref={end} hidden /></ol>
    <label htmlFor="chat-input">Message</label>
    <textarea id="chat-input" rows={2} maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={mode === 'NOT CONNECTED'} />
    <button onClick={send} disabled={busy || mode === 'NOT CONNECTED'}>{busy ? 'Sending…' : 'Send'}</button>
  </main>;
}

'use client';
import { useEffect, useState } from 'react';
import { importFromShopAction, inboxAction, loadSetterAction, saveConfigAction, simulateAction } from '../app/b/[brand]/setter-actions';
import type { SetterView } from '../lib/views';


type Tab = 'inbox' | 'setup' | 'results';
const dollars = (c: number) => (c / 100).toString();

export function SetterClient({ business, initial }: { business: string; initial: SetterView }) {
  const [v, setV] = useState(initial);
  const [tab, setTab] = useState<Tab>('inbox');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [person, setPerson] = useState<'a' | 'b'>('a');
  const [open, setOpen] = useState<string | null>(initial.conversations[0]?.id ?? null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [reply, setReply] = useState('');
  const c = v.config;
  const toForm = (c: SetterView['config']) => ({
    businessName: c.businessName, about: c.about ?? '', idealCustomer: c.idealCustomer, brandVoice: c.brandVoice, qualifyingQuestion: c.qualifyingQuestion,
    shipping: c.shipping ?? '', returns: c.returns ?? '', warranty: c.warranty ?? '', refundPolicy: c.refundPolicy, bookingUrl: c.bookingUrl,
    sellingPoints: (c.sellingPoints ?? []).join('\n'), upsell: c.upsell ?? '', testimonials: (c.testimonials ?? []).join('\n'), testimonialsConfirmed: (c.testimonials ?? []).length > 0,
    objections: (c.objections ?? []).map((o) => ({ objection: o.objection, answer: o.answer })),
    delayEnabled: c.replyDelay?.enabled ?? true, delayMin: c.replyDelay?.minSeconds ?? 45, delayMax: c.replyDelay?.maxSeconds ?? 420,
    botQuestion: c.botQuestion ?? 'honest', discloseAi: c.discloseAi, prohibitedClaims: c.prohibitedClaims.join('\n'), mode: c.mode, paused: c.paused, confirmAuto: false,
    offers: c.offers.map((o) => ({ name: o.name, description: o.description, details: o.details ?? '', bestFor: o.bestFor ?? '', price: dollars(o.priceMinor), ctaUrl: o.ctaUrl })),
    knowledge: c.knowledge.map((k) => ({ question: k.question, answer: k.answer })),
  });
  const [form, setForm] = useState(toForm(c));
  const run = async <T extends { view: SetterView | null }>(p: Promise<T>, say: (r: T) => string) => {
    setBusy(true); const r = await p; setBusy(false); if (r.view) setV(r.view); setMsg(say(r)); return r;
  };
  const conv = v.conversations.find((x) => x.id === open) ?? null;
  // While a reply is waiting to go out, tick every second and refresh from the server every 5 seconds.
  const [clock, setClock] = useState(() => Date.now());
  const waiting = v.conversations.some((x) => x.messages.some((m) => m.status === 'queued' && m.sendAt));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    const r = setInterval(async () => { const nv = await loadSetterAction(business); if (nv) setV(nv); }, 5000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [waiting, business]);
  const left = (iso: string) => { const sec = Math.max(0, Math.round((Date.parse(iso) - clock) / 1000)); return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`; };

  return (
    <div className="st-setter">
      <nav className="st-tabs" aria-label="AI Setter">
        {(['inbox', 'setup', 'results'] as const).map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'inbox' ? 'Inbox and test' : t === 'setup' ? 'Setup' : 'Results'}</button>)}
      </nav>
      <div className="st-status">
        <span>Replies written by: <strong>{v.agentName === 'rules' ? 'basic rules (no AI key yet)' : `Claude (${v.agentName})`}</strong> · Mode: <strong>{c.mode === 'auto' ? 'Automatic replies' : c.mode === 'off' ? 'Off' : 'Drafts only'}</strong>{c.paused ? ' (paused)' : ''}</span>
        <span className="st-row">
        <button type="button" disabled={busy} onClick={async () => { await run(inboxAction(business, { kind: 'reset' }), (r) => r.message); setOpen(null); setEdit({}); }}>Reset test messages</button>
        <button type="button" className={v.killSwitch ? 'st-on' : 'st-danger'} disabled={busy} onClick={() => run(inboxAction(business, { kind: 'kill', on: !v.killSwitch }), (r) => r.message)}>{v.killSwitch ? 'Allow sending again' : 'Stop all sending'}</button>
        </span>
      </div>
      {msg ? <p role="status" className="st-msg">{msg}</p> : null}

      {tab === 'inbox' ? (
        <section className="st-grid">
          <div className="st-card">
            <h2>Pretend to be a customer</h2>
            <p className="st-muted">Sends a simulated, signed Instagram message through the real pipeline.</p>
            <div className="st-row"><label><input type="radio" checked={person === 'a'} onChange={() => setPerson('a')} /> Person A</label><label><input type="radio" checked={person === 'b'} onChange={() => setPerson('b')} /> Person B</label></div>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "how much is the lamp?", "how long is shipping?" or "stop"' />
            <button type="button" className="st-primary" disabled={busy || !text.trim()} onClick={async () => { const r = await run(simulateAction(business, text, person), (x) => `Result: ${x.result}`); if (r.view?.conversations[0]) setOpen(r.view.conversations[0].id); setText(''); }}>Send as customer</button>
          </div>
          <div className="st-card">
            <h2>Conversations</h2>
            {v.conversations.length === 0 ? <p className="st-muted">No messages yet.</p> : (
              <ul className="st-convs">{v.conversations.map((x) => (
                <li key={x.id}><button type="button" aria-pressed={open === x.id} onClick={() => setOpen(x.id)}>
                  <span className="st-conv-name">{x.igsid.endsWith('2') ? 'Person B' : 'Person A'}</span>
                  <span className="st-conv-tags"><span className="st-pill">{(x.lead?.stage ?? 'new').replace(/_/g, ' ')}</span>{x.humanTakeover ? <span className="st-pill st-warn">You are replying</span> : null}{x.state === 'awaiting_approval' ? <span className="st-pill st-glow">Needs approval</span> : null}</span>
                </button></li>))}</ul>)}
          </div>
          {conv ? (
            <div className="st-card st-wide">
              <div className="st-row st-between"><h2>Conversation</h2>
                <button type="button" disabled={busy} onClick={() => run(inboxAction(business, { kind: conv.humanTakeover ? 'release' : 'takeover', id: conv.id }), (r) => r.message)}>{conv.humanTakeover ? 'Let the AI reply again' : 'Take over'}</button></div>
              {conv.lead ? <p className="st-muted">Lead: {conv.lead.stage.replace(/_/g, ' ')}. Why: “{conv.lead.reason}”</p> : null}
              <ol className="st-thread">{conv.messages.map((m) => (
                <li key={m.id} className={m.direction === 'in' ? 'st-in' : 'st-out'}>
                  <div className="st-meta">{m.direction === 'in' ? 'Customer' : m.author === 'ai' ? 'AI' : 'You'} · {m.status === 'queued' && m.sendAt ? `sending in ${left(m.sendAt)} (human-like delay)` : m.status}{m.intent ? ` · ${m.intent} (${m.confidence})` : ''}</div>
                  {m.status === 'draft' ? (
                    <>
                      <textarea rows={5} aria-label="Draft reply" value={edit[m.id] ?? m.text} onChange={(e) => setEdit({ ...edit, [m.id]: e.target.value })} />
                      <div className="st-row">
                        <button type="button" className="st-primary" disabled={busy} onClick={() => run(inboxAction(business, { kind: 'approve', id: m.id, text: edit[m.id] }), (r) => r.message)}>Approve and send</button>
                        <button type="button" disabled={busy} onClick={() => run(inboxAction(business, { kind: 'reject', id: m.id }), (r) => r.message)}>Discard</button>
                      </div>
                    </>
                  ) : <p>{m.text}</p>}
                  {m.notes.length ? <ul className="st-notes">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
                  {m.error ? <p className="st-err">{m.error}</p> : null}
                </li>))}</ol>
              <div className="st-row"><input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write your own reply" aria-label="Your reply" />
                <button type="button" className="st-primary" disabled={busy || !reply.trim()} onClick={async () => { await run(inboxAction(business, { kind: 'reply', id: conv.id, text: reply }), (r) => r.message); setReply(''); }}>Send</button></div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'setup' ? (
        <section className="st-card st-form">
          <div className="st-row st-between"><h2>Teach it your business</h2>
            <button type="button" disabled={busy} onClick={async () => { const r = await run(importFromShopAction(business), (x) => x.message); if (r.view) setForm(toForm(r.view.config)); }}>Import from my shop</button></div>
          {v.gaps.length ? (
            <div className="st-gaps"><strong>Still missing ({v.gaps.length})</strong><ul>{v.gaps.map((g) => <li key={g.field}><b>{g.field}</b>: {g.why}.</li>)}</ul></div>
          ) : <p className="st-ok">Everything it needs is filled in.</p>}

          <h3>Your business</h3>
          <label>Business name<input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></label>
          <label>About the business (who you are, why people buy from you)<textarea rows={3} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} /></label>
          <label>Who you help<input value={form.idealCustomer} onChange={(e) => setForm({ ...form, idealCustomer: e.target.value })} /></label>
          <label>How you sound (e.g. warm, casual, like a friend texting)<input value={form.brandVoice} onChange={(e) => setForm({ ...form, brandVoice: e.target.value })} /></label>

          <h3>Products</h3>
          <p className="st-muted">The more detail here, the better it sells. Sizes, features, what is in the box, how to use it.</p>
          {form.offers.map((o, i) => {
            const set = (patch: Partial<typeof o>) => { const x = [...form.offers]; x[i] = { ...o, ...patch }; setForm({ ...form, offers: x }); };
            return (
              <fieldset key={i}><legend>Product {i + 1}</legend>
                <input placeholder="Name" value={o.name} onChange={(e) => set({ name: e.target.value })} />
                <input placeholder="Price in dollars" inputMode="decimal" value={o.price} onChange={(e) => set({ price: e.target.value })} />
                <input placeholder="Checkout link (https)" value={o.ctaUrl} onChange={(e) => set({ ctaUrl: e.target.value })} />
                <textarea rows={2} placeholder="One-line summary" value={o.description} onChange={(e) => set({ description: e.target.value })} />
                <textarea rows={5} placeholder="Full details: features, specs, size, materials, what's in the box, how to use, care" value={o.details} onChange={(e) => set({ details: e.target.value })} />
                <textarea rows={2} placeholder="Best for, and who it's NOT for" value={o.bestFor} onChange={(e) => set({ bestFor: e.target.value })} />
              </fieldset>
            );
          })}
          <button type="button" onClick={() => setForm({ ...form, offers: [...form.offers, { name: '', description: '', details: '', bestFor: '', price: '', ctaUrl: '' }] })}>Add product</button>

          <h3>Policies</h3>
          <label>Shipping (cost, how long, tracking)<textarea rows={2} value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} /></label>
          <label>Returns<textarea rows={2} value={form.returns} onChange={(e) => setForm({ ...form, returns: e.target.value })} /></label>
          <label>Warranty and faulty items<textarea rows={2} value={form.warranty} onChange={(e) => setForm({ ...form, warranty: e.target.value })} /></label>
          <label>Booking link (https, optional)<input value={form.bookingUrl} onChange={(e) => setForm({ ...form, bookingUrl: e.target.value })} /></label>

          <h3>How to sell it</h3>
          <label>Why people buy (one reason per line, strongest first)<textarea rows={4} value={form.sellingPoints} onChange={(e) => setForm({ ...form, sellingPoints: e.target.value })} /></label>
          <label>One question to understand the buyer<input value={form.qualifyingQuestion} onChange={(e) => setForm({ ...form, qualifyingQuestion: e.target.value })} /></label>
          <label>Upsell or bundle (offered once, only when it fits)<input value={form.upsell} onChange={(e) => setForm({ ...form, upsell: e.target.value })} /></label>
          <p className="st-muted">Your answers to common hesitations. It uses your words when someone is unsure.</p>
          {form.objections.map((o, i) => {
            const set = (patch: Partial<typeof o>) => { const x = [...form.objections]; x[i] = { ...o, ...patch }; setForm({ ...form, objections: x }); };
            return (
              <fieldset key={i}><legend>Hesitation {i + 1}</legend>
                <input placeholder='What they say, e.g. "too expensive"' value={o.objection} onChange={(e) => set({ objection: e.target.value })} />
                <textarea rows={2} placeholder="How you answer it" value={o.answer} onChange={(e) => set({ answer: e.target.value })} />
              </fieldset>
            );
          })}
          <button type="button" onClick={() => setForm({ ...form, objections: [...form.objections, { objection: '', answer: '' }] })}>Add hesitation</button>
          <label>Customer reviews it may quote (one per line, word for word)<textarea rows={3} value={form.testimonials} onChange={(e) => setForm({ ...form, testimonials: e.target.value })} /></label>
          <label><input type="checkbox" checked={form.testimonialsConfirmed} onChange={(e) => setForm({ ...form, testimonialsConfirmed: e.target.checked })} /> These are real reviews from real customers. (Reviews are only saved when this is ticked.)</label>

          <h3>Questions people ask</h3>
          {form.knowledge.map((k, i) => (
            <fieldset key={i}><legend>Question {i + 1}</legend>
              <input placeholder="Question" value={k.question} onChange={(e) => { const x = [...form.knowledge]; x[i] = { ...k, question: e.target.value }; setForm({ ...form, knowledge: x }); }} />
              <textarea rows={2} placeholder="Your answer" value={k.answer} onChange={(e) => { const x = [...form.knowledge]; x[i] = { ...k, answer: e.target.value }; setForm({ ...form, knowledge: x }); }} />
            </fieldset>))}
          <button type="button" onClick={() => setForm({ ...form, knowledge: [...form.knowledge, { question: '', answer: '' }] })}>Add question</button>
          <label>Things it must never say (one per line)<textarea rows={3} value={form.prohibitedClaims} onChange={(e) => setForm({ ...form, prohibitedClaims: e.target.value })} /></label>

          <h3>Replies</h3>
          <label><input type="radio" checked={form.mode === 'draft_only'} onChange={() => setForm({ ...form, mode: 'draft_only' })} /> Drafts only: I approve every reply</label>
          <label><input type="radio" checked={form.mode === 'auto'} onChange={() => setForm({ ...form, mode: 'auto' })} /> Automatic replies when it is allowed</label>
          <label><input type="radio" checked={form.mode === 'off'} onChange={() => setForm({ ...form, mode: 'off' })} /> Off</label>
          {form.mode === 'auto' ? <label><input type="checkbox" checked={form.confirmAuto} onChange={(e) => setForm({ ...form, confirmAuto: e.target.checked })} /> I understand it will reply on my behalf, only within 24 hours of a person messaging me, and only with the facts above.</label> : null}
          <p className="st-muted">It never says it is AI on its own. If someone asks "are you a bot?":</p>
          <label><input type="radio" checked={form.botQuestion === 'honest'} onChange={() => setForm({ ...form, botQuestion: 'honest' })} /> Answer honestly that it is the store's assistant and offer a person</label>
          <label><input type="radio" checked={form.botQuestion === 'handoff'} onChange={() => setForm({ ...form, botQuestion: 'handoff' })} /> Do not answer: hand the chat to me</label>
          <label><input type="checkbox" checked={form.discloseAi} onChange={(e) => setForm({ ...form, discloseAi: e.target.checked })} /> Say the first reply is automated. Off by default. Some places (for example California and Germany) may require this by law.</label>
          <h3>Reply timing</h3>
          <label><input type="checkbox" checked={form.delayEnabled} onChange={(e) => setForm({ ...form, delayEnabled: e.target.checked })} /> Wait a random, human-like time before automatic replies (never more than 7 minutes)</label>
          {form.delayEnabled ? (
            <div className="st-row">
              <label>Shortest wait (seconds)<input type="number" min={0} max={420} value={form.delayMin} onChange={(e) => setForm({ ...form, delayMin: Number(e.target.value) })} /></label>
              <label>Longest wait (seconds, max 420)<input type="number" min={0} max={420} value={form.delayMax} onChange={(e) => setForm({ ...form, delayMax: Math.min(420, Number(e.target.value)) })} /></label>
            </div>
          ) : null}
          <p className="st-muted">Approved drafts and your own replies go out straight away. If the person sends another message while a reply is waiting, it is replaced with a fresh one.</p>
          <label><input type="checkbox" checked={form.paused} onChange={(e) => setForm({ ...form, paused: e.target.checked })} /> Pause the AI</label>
          <button type="button" className="st-primary" disabled={busy} onClick={() => run(saveConfigAction(business, form), (r) => r.message)}>Save</button>
        </section>
      ) : null}

      {tab === 'results' ? (
        <section className="st-card">
          <h2>Results</h2>
          <dl className="st-metrics">
            {Object.entries({ Conversations: v.metrics.conversations, 'Qualified leads': v.metrics.qualified, 'Handed to you': v.metrics.handoffs, 'Opted out': v.metrics.optOuts, 'Checkout clicks': v.metrics.checkoutClicks, 'Verified purchases': v.metrics.verifiedPurchases, 'Verified bookings': v.metrics.verifiedBookings, 'Median reply time': v.metrics.medianReplyMs === null ? 'not yet' : `${Math.round(v.metrics.medianReplyMs / 1000)}s`, 'Blocked sends': v.metrics.blockedSends, 'Failed after retries': v.metrics.deadLetters }).map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{String(val)}</dd></div>)}
          </dl>
          <p className="st-muted">Purchases and bookings count only when Stripe or the booking tool confirms them, never because the AI said so.</p>
          <h3>AI reply credits</h3>
          <dl className="st-metrics">
            {Object.entries({ 'Credits left': v.usage.creditsLeft, 'AI replies used': v.usage.aiReplies, 'Your AI cost (USD)': `$${v.usage.platformCostUsd.toFixed(4)}`, 'Cost per conversation': v.usage.costPerConversationUsd === null ? 'not yet' : `$${v.usage.costPerConversationUsd.toFixed(4)}` }).map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{String(val)}</dd></div>)}
          </dl>
          <p className="st-muted">{v.metered ? '1 credit = 1 reply written by Claude. With no credits left, the AI stops and chats come to you.' : 'Credits are only used when Claude writes the replies. Right now the basic rules are answering, which costs nothing.'}{v.usage.low ? ' Credits are running low.' : ''}</p>
          <div className="st-row">
            {v.usage.packs.map((p) => <span key={p.id} className="st-pill">{p.label}: ${(p.priceMinor / 100).toFixed(0)} {p.currency.toUpperCase()}</span>)}
          </div>
          <p className="st-muted">{v.canBuy ? 'Buying credits opens Stripe checkout.' : 'Buying credits needs Stripe keys, so it is off here.'}</p>
          <button type="button" disabled={busy} onClick={() => run(inboxAction(business, { kind: 'test_credits' }), (r) => r.message)}>Add 500 test credits</button>
          <h3>Recent activity</h3>
          <ul className="st-notes">{v.audit.map((a, i) => <li key={i}>{a.kind}: {a.detail}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

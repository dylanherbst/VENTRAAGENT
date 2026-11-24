'use client';
import { useState } from 'react';
import { handleInboundSms } from '../../../lib/front-office/orchestrator';
import type { InboundResult, Rpc } from '../../../lib/front-office/orchestrator';
import { contactStates } from '../../../lib/front-office/state';
import type { ContactState } from '../../../lib/front-office/state';

// Isolated test page for the front-office orchestrator (tracker 0.2 to 0.6). It runs the production orchestrator with an
// in-memory stand-in for the database, so nothing is stored or sent. The live path is the Twilio webhook
// /api/front-office/sms/inbound, which needs a channel, a Twilio number and TWILIO_AUTH_TOKEN.
type Log = { fn: string; detail: string };
export default function FrontOfficeTest() {
  const [state, setState] = useState<ContactState | 'unknown'>('unknown');
  const [optedOut, setOptedOut] = useState(false);
  const [body, setBody] = useState('Hi, how much is a membership?');
  const [result, setResult] = useState<InboundResult | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  async function send() {
    const calls: Log[] = [];
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, detail: fn === 'fo_log_outbound' ? `prompt ${String(args.prompt)}` : fn === 'fo_log_dispatch' ? `agent ${String(args.agent_name)}` : `opt_out ${String(args.opt_out)}, opt_in ${String(args.opt_in)}` });
      if (fn !== 'fo_ingest_sms') return null;
      const nowOut = args.opt_out ? true : args.opt_in ? false : optedOut;
      return { contact: 'demo-contact', state: state === 'unknown' ? 'new' : state, created: state === 'unknown', duplicate: false, optedOut: nowOut };
    };
    const r = await handleInboundSms(rpc, { channel: 'demo', key: 'demo' }, { from: '+61411111111', to: '+61400000001', body, messageSid: 'SMdemo' + Date.now() });
    setOptedOut(r.optedOut); if (state === 'unknown') setState('new');
    setResult(r); setLog(calls);
  }
  return <main>
    <h1>Front office orchestrator test</h1>
    <p><span className="v-status" data-testid="page-mode">DEMO · In-memory, nothing stored or sent</span> Live texts arrive through the Twilio webhook once a channel is connected.</p>
    <p><a href="/tools/front-office-settings">Your AI team settings</a> (business details, questions, FAQ answers, hours, phone greeting).</p>
    <label htmlFor="fo-state">Contact state before the text</label>
    <select id="fo-state" value={state} onChange={e => setState(e.target.value as ContactState | 'unknown')}>
      <option value="unknown">Unknown number</option>
      {contactStates.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
    <label htmlFor="fo-body">Text message</label>
    <textarea id="fo-body" value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={1600} />
    <button onClick={send}>Send test text</button>
    <p>Opted out: {optedOut ? 'yes' : 'no'}</p>
    {result && <section aria-live="polite">
      <h2>Result</h2>
      <dl>
        <dt>Contact state</dt><dd data-testid="fo-state">{result.state}{result.created ? ' (new contact)' : ''}</dd>
        <dt>Routed to</dt><dd data-testid="fo-agent">{result.route.agent ?? 'No agent'}: {result.route.reason}</dd>
        <dt>Reply sent</dt><dd data-testid="fo-reply">{result.reply ?? 'None (agents reply from Phase 1)'}</dd>
      </dl>
      <h2>Database calls</h2>
      <ol>{log.map((l, i) => <li key={i}><code>{l.fn}</code> · {l.detail}</li>)}</ol>
    </section>}
  </main>;
}

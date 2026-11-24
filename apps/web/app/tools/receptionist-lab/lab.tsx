'use client';
import { useActionState, useState } from 'react';
import { runLab } from './actions';
import type { LabState } from './actions';

// Plain functional markup on purpose (no design system): this is a test page, not product UI.
type Fixture = { id: string; title: string; covers: string; lines: string[] };
type Status = { name: string; state: string };
const json = (v: unknown) => JSON.stringify(v, null, 2);

export default function ReceptionistLab({ status, fixtures }: { status: Status[]; fixtures: Fixture[] }) {
  const [state, action, pending] = useActionState<LabState, FormData>(runLab, { result: null, error: null });
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id ?? '');
  const [custom, setCustom] = useState(false);
  const [lines, setLines] = useState((fixtures[0]?.lines ?? []).join('\n'));
  const selected = fixtures.find(f => f.id === fixtureId);
  const r = state.result;

  return <main>
    <h1>Receptionist Test Lab</h1>
    <p><span className="v-status" data-testid="page-mode">DEMO · Simulated call</span> Runs a pretend inbound call through the real AI Receptionist pipeline with a scripted model, an in-memory database and calendar. No call is placed or answered and nothing is sent.</p>

    <h2>Connections</h2>
    <p>The lab uses none of these. They show whether the real ones are set up.</p>
    <ul data-testid="connections">{status.map(s => <li key={s.name}>{s.name}: <strong>{s.state}</strong></li>)}</ul>

    <form action={action}>
      <fieldset>
        <legend>Call</legend>
        <label htmlFor="fixture">Scenario</label>{' '}
        <select id="fixture" name="fixture" value={fixtureId} onChange={e => { setFixtureId(e.target.value); setLines((fixtures.find(f => f.id === e.target.value)?.lines ?? []).join('\n')); }}>
          {fixtures.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        {selected && <p>{selected.covers}</p>}
        <p><label><input type="checkbox" name="custom" checked={custom} onChange={e => setCustom(e.target.checked)} /> Use my own caller lines (simple keyword rules stand in for the model)</label></p>
        <label htmlFor="lines">Caller says (one line per turn, up to 8)</label>
        <textarea id="lines" name="lines" rows={5} cols={80} maxLength={3000} value={lines} onChange={e => setLines(e.target.value)} readOnly={!custom} />
      </fieldset>
      <fieldset>
        <legend>Switches (inside the simulation only)</legend>
        <p><label><input type="checkbox" name="live" defaultChecked /> Simulated live switch (the real FRONT_OFFICE_VOICE_LIVE is not read or changed)</label></p>
        <p><label><input type="checkbox" name="receptionistOn" defaultChecked /> Receptionist switched on in the business settings</label></p>
        <p><label><input type="checkbox" name="transfer" defaultChecked /> Business has a transfer number</label></p>
        <p><label><input type="checkbox" name="calendar" defaultChecked /> Calendar connected (simulated)</label></p>
      </fieldset>
      <button type="submit" disabled={pending}>{pending ? 'Running…' : 'Run simulated call'}</button>
    </form>

    {state.error && <p role="alert">{state.error}</p>}

    {r && <section data-testid="result">
      <h2>{r.fixture.title}</h2>
      <p>Live gate: <strong>{r.gate.live ? 'ANSWERING (simulated)' : 'NOT SWITCHED ON'}</strong>. {r.gate.note} Model: {r.gate.model === 'rules' ? 'keyword rules' : 'scripted'}.</p>
      <p>Operating mode: <strong>{r.modes.available.join(', ')}</strong>. {r.modes.note}</p>

      <h3>Transcript</h3>
      <ol data-testid="transcript">{r.transcript.map((l, i) => <li key={i}><strong>{l.who}:</strong> {l.text}</li>)}</ol>

      <h3>Tool calls</h3>
      {r.toolCalls.length === 0 ? <p>None.</p> : <table data-testid="tool-calls">
        <thead><tr><th>Turn</th><th>Tool</th><th>Arguments</th><th>Result</th><th>Mode decision</th></tr></thead>
        <tbody>{r.toolCalls.map(t => <tr key={t.id}>
          <td>{t.turn}</td><td>{t.name}</td><td><pre>{json(t.input)}</pre></td>
          <td><pre>{t.isError ? 'ERROR: ' : ''}{t.result}</pre></td>
          <td>{t.mode ? `${t.mode.action}: ${t.mode.mode} (not enforced)` : 'not an action'}</td>
        </tr>)}</tbody>
      </table>}

      <h3>What Vapi would do</h3>
      <ul>{r.turns.map(t => <li key={t.turn}>Request {t.turn} ({t.route}{t.prompt ? `, ${t.prompt}` : ''}): {t.vapiActions.length ? t.vapiActions.map(x => `${x.name} ${json(x.args)}`).join(', ') : 'speak and wait'}{t.error ? ` (turn failed: ${t.error})` : ''}</li>)}</ul>

      <h3>Call record (fo_calls)</h3>
      <pre data-testid="fo-calls">{json(r.tables.fo_calls)}</pre>
      <h3>Contacts (fo_contacts)</h3>
      <pre data-testid="fo-contacts">{json(r.tables.fo_contacts)}</pre>
      <h3>Summary and outcome</h3>
      <p data-testid="summary">{r.endOfCall.summary}</p>
      <p>Ended: {r.endOfCall.endedReason}. Outcomes: {r.endOfCall.outcomes.join(', ') || 'none'}.</p>

      <h3>Every write ({r.writes.length})</h3>
      <ol>{r.writes.map((w, i) => <li key={i}>{w.rpc} {w.op} {w.table}: {w.detail}</li>)}</ol>
      <h3>Bookings, reminders, handoffs</h3>
      <pre>{json({ fo_appointments: r.tables.fo_appointments, fo_jobs: r.tables.fo_jobs, handoffs: r.tables.handoffs })}</pre>
      <h3>Calendar (simulated)</h3>
      <ul>{r.calendar.length ? r.calendar.map((c, i) => <li key={i}>{c}</li>) : <li>No changes.</li>}</ul>
      <h3>Would have been sent (not sent)</h3>
      <ul>{r.wouldSend.length ? r.wouldSend.map((s, i) => <li key={i}>{s.channel} to {s.to}: {s.body}</li>) : <li>Nothing.</li>}</ul>
      <details><summary>Raw Vapi requests and streamed chunks</summary><pre>{json(r.turns.map(t => ({ turn: t.turn, request: t.vapiRequest, chunks: t.chunks })))}</pre></details>
      <details><summary>System prompt the model saw</summary><pre>{r.turns.find(t => t.system)?.system ?? 'No model request on this call.'}</pre></details>
    </section>}

    <h2>Real test call</h2>
    <p data-testid="real-call">Not available here. A real test call needs the owner’s written approval, a Vapi assistant and phone number pointed at this app, and the live voice switch turned on for that one test. Until then the Receptionist stays off and callers hear the honest “not switched on yet” message.</p>
    <button type="button" disabled>Place a real test call (needs owner approval)</button>
  </main>;
}

'use client';
// Gallery parts 7–9: search + segmented tabs, form fields, setup checklist.
import { useId, useState } from 'react';
import { Icons as I } from '@/components/glass';

export function SearchAndTabs() {
  const tabs = ['Today', 'Week', 'Month'];
  const [tab, setTab] = useState('Week');
  const [q, setQ] = useState('');
  return (
    <div className="g-stack">
      <label className="g-search">
        {I.search}
        <input type="search" placeholder="Search customers and offers" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        {q && <button type="button" className="g-search-clear" aria-label="Clear search" onClick={() => setQ('')}>{I.close}</button>}
      </label>
      <div className="g-seg" role="tablist" aria-label="Time range">
        {tabs.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={'g-seg-btn' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export function FormFields() {
  const id = useId();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const err = touched && name.trim() === '';
  return (
    <form className="g-form" onSubmit={e => { e.preventDefault(); setTouched(true); }} noValidate>
      <div className="g-field">
        <label htmlFor={`${id}-n`}>Business name</label>
        <input id={`${id}-n`} value={name} onChange={e => setName(e.target.value)} onBlur={() => setTouched(true)} placeholder="e.g. Bright Smile Dental"
          aria-invalid={err} aria-describedby={err ? `${id}-ne` : undefined} />
        {err && <p id={`${id}-ne`} className="g-field-error">Enter your business name.</p>}
      </div>
      <div className="g-field">
        <label htmlFor={`${id}-t`}>Business type</label>
        <div className="g-select">
          <select id={`${id}-t`} defaultValue="">
            <option value="" disabled>Choose one</option>
            <option>Coaching or mentoring</option><option>Local service</option><option>Online store</option><option>Agency</option>
          </select>
          <span aria-hidden="true">{I.chevron}</span>
        </div>
      </div>
      <div className="g-field">
        <label htmlFor={`${id}-d`}>What do you sell? <span className="g-optional">Optional</span></label>
        <textarea id={`${id}-d`} rows={3} placeholder="A sentence or two is enough" />
        <p className="g-field-hint">We use this to write your first offer.</p>
      </div>
      <button type="submit" className="g-btn g-btn-primary">Save</button>
    </form>
  );
}

const STEPS = [
  { t: 'Add your business details', done: true },
  { t: 'Create your first offer', done: true },
  { t: 'Connect your calendar', done: false },
  { t: 'Turn on AI Setter', done: false },
];

export function SetupChecklist() {
  const [steps, setSteps] = useState(STEPS);
  const done = steps.filter(s => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <div className="g-setup">
      <div className="g-setup-head">
        <div><h3>Finish setting up</h3><small>{done} of {steps.length} done</small></div>
        <span className="g-ring" style={{ ['--p' as string]: pct }} role="img" aria-label={`${pct}% complete`}><b>{pct}%</b></span>
      </div>
      <div className="g-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <ul>
        {steps.map((s, i) => (
          <li key={s.t}>
            <button type="button" className={'g-step' + (s.done ? ' done' : '')} aria-pressed={s.done}
              onClick={() => setSteps(x => x.map((y, j) => j === i ? { ...y, done: !y.done } : y))}>
              <span className="g-check">{s.done && I.check}</span><span className="g-step-text">{s.t}</span>{!s.done && <span className="g-chev">{I.chevron}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

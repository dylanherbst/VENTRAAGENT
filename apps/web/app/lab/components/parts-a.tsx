'use client';
// Gallery parts 4–6: badges & chips, list card, quick actions.
import { useState } from 'react';
import { Icons as I } from '@/components/glass';

export function BadgesAndChips() {
  const filters = ['All', 'New', 'Booked', 'Paid', 'Follow up'];
  const [on, setOn] = useState('All');
  return (
    <div className="g-stack">
      <div className="g-row">
        <span className="g-badge ok"><i />Active</span>
        <span className="g-badge warn"><i />Needs setup</span>
        <span className="g-badge bad"><i />Failed</span>
        <span className="g-badge muted"><i />Paused</span>
        <span className="g-badge new">New</span>
      </div>
      <div className="g-chips" role="group" aria-label="Filter customers">
        {filters.map(f => (
          <button key={f} type="button" className={'g-chip' + (on === f ? ' on' : '')} aria-pressed={on === f} onClick={() => setOn(f)}>{f}</button>
        ))}
      </div>
    </div>
  );
}

const ROWS = [
  { name: 'Sarah Mitchell', sub: 'Booked a call · Today 2:30 pm', badge: ['ok', 'Booked'], init: 'SM' },
  { name: 'James Okafor', sub: 'Replied to AI Setter · 12 min ago', badge: ['new', 'New'], init: 'JO' },
  { name: 'Priya Shah', sub: 'Invoice sent · $450', badge: ['warn', 'Unpaid'], init: 'PS' },
  { name: 'Tom Becker', sub: 'No reply in 3 days', badge: ['muted', 'Follow up'], init: 'TB' },
] as const;

export function ListCard() {
  return (
    <div className="g-list">
      <div className="g-list-head"><h3>Recent customers</h3><button type="button" className="g-link">See all</button></div>
      <ul>
        {ROWS.map(r => (
          <li key={r.name}>
            <button type="button" className="g-list-row">
              <span className="g-avatar sm" aria-hidden="true">{r.init}</span>
              <span className="g-list-text"><strong>{r.name}</strong><small>{r.sub}</small></span>
              <span className={'g-badge ' + r.badge[0]}>{r.badge[1]}</span>
              <span className="g-chev">{I.chevron}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTIONS = [
  { label: 'New offer', icon: I.spark },
  { label: 'Send invoice', icon: I.doc },
  { label: 'Add customer', icon: I.users },
  { label: 'Book meeting', icon: I.calendar },
  { label: 'Send email', icon: I.mail },
  { label: 'Inbox', icon: I.inbox },
];

export function QuickActions() {
  return (
    <div className="g-actions">
      {ACTIONS.map(a => (
        <button key={a.label} type="button" className="g-action"><span className="g-action-icon">{a.icon}</span>{a.label}</button>
      ))}
    </div>
  );
}

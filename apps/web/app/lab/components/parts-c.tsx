'use client';
// Gallery parts 10–12: notices, empty state, bottom sheet and toast.
import { useState } from 'react';
import { GlassSheet, GlassToast, Icons as I } from '@/components/glass';

const NOTICES = [
  { kind: 'info', icon: I.info, title: 'Tip', text: 'Connect your calendar so AI Setter can book calls for you.' },
  { kind: 'ok', icon: I.check, title: 'Offer published', text: 'Your “Starter Coaching” page is live.' },
  { kind: 'warn', icon: I.warn, title: 'Payment details needed', text: 'Add a payout account before your first sale.' },
  { kind: 'bad', icon: I.close, title: 'Email failed to send', text: 'Check the address for Tom Becker and try again.' },
] as const;

export function Notices() {
  return (
    <div className="g-stack">
      {NOTICES.map(n => (
        <div key={n.kind} className={'g-notice ' + n.kind} role={n.kind === 'bad' || n.kind === 'warn' ? 'alert' : 'status'}>
          <span className="g-notice-icon">{n.icon}</span>
          <div><strong>{n.title}</strong><p>{n.text}</p></div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="g-empty">
      <span className="g-empty-icon">{I.users}</span>
      <h3>No customers yet</h3>
      <p>When someone books a call or buys an offer, they’ll appear here.</p>
      <button type="button" className="g-btn g-btn-primary g-btn-sm">{I.plus}Add a customer</button>
    </div>
  );
}

export function SheetAndToastDemo() {
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState(false);
  return (
    <>
      <div className="g-row">
        <button type="button" className="g-btn g-btn-glass g-btn-sm" onClick={() => setSheet(true)}>Open bottom sheet</button>
        <button type="button" className="g-btn g-btn-glass g-btn-sm" onClick={() => setToast(true)}>Show toast</button>
      </div>
      <GlassSheet open={sheet} onClose={() => setSheet(false)} title="Send invoice">
        <p>Priya Shah · Starter Coaching · <b>$450</b></p>
        <button type="button" className="g-btn g-btn-primary" onClick={() => { setSheet(false); setToast(true); }}>Send now</button>
        <button type="button" className="g-btn g-btn-ghost" onClick={() => setSheet(false)}>Not now</button>
      </GlassSheet>
      <GlassToast open={toast} onClose={() => setToast(false)} action={{ label: 'Undo', onClick: () => setToast(false) }}>Invoice sent to Priya Shah</GlassToast>
    </>
  );
}

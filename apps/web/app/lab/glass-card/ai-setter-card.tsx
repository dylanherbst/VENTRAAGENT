'use client';
// AI Setter info card content (lab). Sits inside the tinted Liquid Glass React card; local state only, not wired to the agent yet.
import { useState } from 'react';

export function AiSetterCardBody() {
  const [active, setActive] = useState(true);
  return (
    <div className="ais">
      <div className="ais-top">
        <span className="ais-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5c4.7 0 8.5 3.2 8.5 7.2s-3.8 7.2-8.5 7.2c-1 0-2-.1-2.9-.4L5 19.5l1.1-3.6C4.5 14.6 3.5 12.8 3.5 10.7c0-4 3.8-7.2 8.5-7.2Z" />
            <circle cx="8.6" cy="10.8" r=".9" fill="currentColor" stroke="none" />
            <circle cx="12" cy="10.8" r=".9" fill="currentColor" stroke="none" />
            <circle cx="15.4" cy="10.8" r=".9" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <div className="ais-text">
          <h2>AI Setter</h2>
          <p>Finds leads, starts conversations and books appointments.</p>
        </div>
        <button type="button" className="ais-more" aria-label="More options for AI Setter">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>
        </button>
      </div>
      <div className="ais-status">
        <span className={'ais-dot' + (active ? ' on' : '')} aria-hidden="true" />
        <span className="ais-label">{active ? 'Active' : 'Paused'}</span>
        <button type="button" role="switch" aria-checked={active} aria-label="AI Setter on or off" className={'ais-switch' + (active ? ' on' : '')} onClick={() => setActive(a => !a)}>
          <span className="ais-knob" />
        </button>
      </div>
    </div>
  );
}

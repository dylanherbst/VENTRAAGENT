'use client';
// Home bottom navigation (lab): VENTRA's five areas on a Liquid Glass React bar. Local state only; not wired to routes yet.
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card';

const ic = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ITEMS = [
  { key: 'home', label: 'Home', icon: ic(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" /></>) },
  { key: 'create', label: 'Create', icon: ic(<><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8.5v7M8.5 12h7" /></>) },
  { key: 'customers', label: 'Customers', icon: ic(<><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2 3 4.2" /></>) },
  { key: 'grow', label: 'Grow', icon: ic(<><path d="M4 17l5.5-5.5 3.5 3.5L20 8" /><path d="M15 8h5v5" /></>) },
  { key: 'money', label: 'Money', icon: ic(<><rect x="3.5" y="6" width="17" height="13" rx="3" /><path d="M3.5 10h17" /><circle cx="16" cy="14.5" r="1.2" fill="currentColor" stroke="none" /></>) },
] as const;

export function HomeBottomNav({ tint, mouseContainer }: { tint: string; mouseContainer: RefObject<HTMLElement | null> }) {
  const [current, setCurrent] = useState<string>('home');
  return (
    <div className="bnav-slot">
      <LiquidGlassCard tint={tint} width="min(420px, calc(100vw - 44px))" height={0} padding="6px" cornerRadius={30} mouseContainer={mouseContainer}>
        <nav aria-label="Main" className="bnav">
          {ITEMS.map(it => (
            <button key={it.key} type="button" className={'bnav-item' + (current === it.key ? ' on' : '')}
              aria-current={current === it.key ? 'page' : undefined} onClick={() => setCurrent(it.key)}>
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </nav>
      </LiquidGlassCard>
    </div>
  );
}

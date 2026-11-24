'use client';
// VENTRA glass UI kit: the building blocks every app screen uses. The glass itself is the real liquid-glass-react
// component (via components/ui/liquid-glass-card.tsx); this file only arranges it. Rules: docs/design/UI_BIBLE.md.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassBlock, LiquidGlassCard } from '@/components/ui/liquid-glass-card';
import type { LiquidGlassCardProps } from '@/components/ui/liquid-glass-card';
import { TINTS } from './tints';
import type { Tint } from './tints';
import { I } from './icons';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import './reset.css';
import './glass-ui.css';

const StageCtx = createContext<{ stage: RefObject<HTMLElement | null>; root: RefObject<HTMLDivElement | null> } | null>(null);
function useStage() {
  const ctx = useContext(StageCtx);
  if (!ctx) throw new Error('Glass components must be inside <GlassPage>.');
  return ctx;
}

/** Wrap every glass screen in this. It applies the reset, the background and the space for the bottom nav. */
export function GlassPage({ children, wide = false, className = '' }: { children: ReactNode; wide?: boolean; className?: string }) {
  const stage = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className="vglass">
      <StageCtx.Provider value={{ stage, root }}>
        <main ref={stage} className={`g-stage${wide ? ' wide' : ''} ${className}`.trim()}>{children}</main>
      </StageCtx.Provider>
    </div>
  );
}

type GlassProps = Omit<LiquidGlassCardProps, 'tint' | 'mouseContainer'> & { tint?: Tint; className?: string };

/** A glass card in normal page flow: fills the width, grows with its content. Default tint: slate. */
export function GlassCard({ tint = 'slate', padding = '20px', ...props }: GlassProps) {
  const { stage } = useStage();
  return <LiquidGlassBlock {...props} padding={padding} tint={TINTS[tint]} mouseContainer={stage} />;
}

/** A section with the small numbered/uppercase label above it. */
export function GlassSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="g-section">
      {title && <h2 className="g-section-title">{title}</h2>}
      {children}
    </section>
  );
}

export type NavItem = { key: string; label: string; icon: ReactNode; href?: string };
const NAV_ICON = (d: ReactNode) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
/** VENTRA's five areas. */
export const VENTRA_NAV: NavItem[] = [
  { key: 'home', label: 'Home', href: '/app', icon: NAV_ICON(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" /></>) },
  { key: 'create', label: 'Create', href: '/create', icon: NAV_ICON(<><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M12 8.5v7M8.5 12h7" /></>) },
  { key: 'customers', label: 'Customers', href: '/customers', icon: NAV_ICON(<><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2 3 4.2" /></>) },
  { key: 'grow', label: 'Grow', href: '/grow', icon: NAV_ICON(<><path d="M4 17l5.5-5.5 3.5 3.5L20 8" /><path d="M15 8h5v5" /></>) },
  { key: 'money', label: 'Money', href: '/money', icon: NAV_ICON(<><rect x="3.5" y="6" width="17" height="13" rx="3" /><path d="M3.5 10h17" /><circle cx="16" cy="14.5" r="1.2" fill="currentColor" stroke="none" /></>) },
];

/**
 * Bottom navigation (fixed). Pass `current` and either `onSelect` (buttons) or items with `href` and `asLinks` (links).
 */
export function GlassBottomNav({ current, onSelect, items = VENTRA_NAV, asLinks = false, tint = 'grape' }:
  { current: string; onSelect?: (key: string) => void; items?: NavItem[]; asLinks?: boolean; tint?: Tint }) {
  const { stage } = useStage();
  return (
    <div className="g-nav-slot">
      <LiquidGlassCard tint={TINTS[tint]} width="min(420px, calc(100vw - 44px))" height={0} padding="6px" cornerRadius={30} mouseContainer={stage}>
        <nav aria-label="Main" className="g-nav">
          {items.map(it => {
            const on = current === it.key;
            const cls = 'g-nav-item' + (on ? ' on' : '');
            return asLinks && it.href
              ? <a key={it.key} href={it.href} className={cls} aria-current={on ? 'page' : undefined}>{it.icon}<span>{it.label}</span></a>
              : <button key={it.key} type="button" className={cls} aria-current={on ? 'page' : undefined} onClick={() => onSelect?.(it.key)}>{it.icon}<span>{it.label}</span></button>;
          })}
        </nav>
      </LiquidGlassCard>
    </div>
  );
}

// Overlays are portalled to the page root: a glass card's transform would trap position:fixed.
function usePortalHost() {
  const { root } = useStage();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(root.current); }, [root]);
  return host;
}

/** Bottom sheet (modal). Closes on the scrim, the close button and Escape; focus moves to the close button. */
export function GlassSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const host = usePortalHost();
  const { stage } = useStage();
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtn.current?.focus(), 350);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open || !host) return null;
  return createPortal(
    <div className="g-sheet-layer">
      <button type="button" className="g-scrim" aria-label="Close" onClick={onClose} />
      <div className="g-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <LiquidGlassBlock tint={TINTS.grape} padding="20px" cornerRadius={32} mouseContainer={stage}>
          <div className="g-sheet-body">
            <span className="g-grabber" aria-hidden="true" />
            <div className="g-sheet-head"><h3>{title}</h3>
              <button ref={closeBtn} type="button" className="g-icon-btn" aria-label="Close" onClick={onClose}>{I.close}</button></div>
            {children}
          </div>
        </LiquidGlassBlock>
      </div>
    </div>, host);
}

/** Toast at the top of the screen. Disappears after `duration` ms (default 3200). */
export function GlassToast({ open, onClose, children, action, duration = 3200 }:
  { open: boolean; onClose: () => void; children: ReactNode; action?: { label: string; onClick: () => void }; duration?: number }) {
  const host = usePortalHost();
  const { stage } = useStage();
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [open, onClose, duration]);
  if (!host) return null;
  return createPortal(
    <div className="g-toast-slot" role="status" aria-live="polite">
      {open && (
        <LiquidGlassBlock tint={TINTS.toast} blurAmount={0.4} padding="12px" cornerRadius={22} mouseContainer={stage}>
          <div className="g-toast"><span className="g-notice-icon">{I.check}</span><span>{children}</span>
            {action && <button type="button" className="g-link" onClick={action.onClick}>{action.label}</button>}</div>
        </LiquidGlassBlock>
      )}
    </div>, host);
}

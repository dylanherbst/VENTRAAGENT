'use client';
// GlassButton: primary (milky-white pill, plum label), secondary/provider (clear pill with a fine rim),
// icon (round, for Back) and skip (small pill). Renders a link when `href` is given, otherwise a native button.
// States: hover (pointer devices), pressed, keyboard focus, loading (width stays the same) and disabled.
import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

export type GlassButtonVariant = 'primary' | 'secondary' | 'icon' | 'skip';

export interface GlassButtonProps {
  children?: ReactNode;
  variant?: GlassButtonVariant;
  /** Leading icon (a sparkle on the primary action, a provider mark on provider buttons). */
  icon?: ReactNode;
  /** Small trailing note, for example "Coming soon". */
  note?: ReactNode;
  /** Navigates instead of acting. Ignored while disabled or loading (a native disabled button is rendered). */
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** Shows a spinner in place of the label without changing the button's size. Clicks are ignored. */
  loading?: boolean;
  /** Read out while loading. */
  loadingLabel?: string;
  /** Stretch to the full width of the container (the default for primary and secondary). */
  block?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  className?: string;
  id?: string;
  /** Required for icon-only buttons. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-pressed'?: boolean;
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
}

export function GlassButton({
  children, variant = 'secondary', icon, note, href, type = 'button', disabled = false, loading = false,
  loadingLabel = 'Working…', block, onClick, className = '', ...aria
}: GlassButtonProps) {
  const isBlock = block ?? (variant === 'primary' || variant === 'secondary');
  const shared = {
    className: `plg-btn ${className}`.trim(),
    'data-variant': variant,
    'data-block': isBlock ? 'true' : undefined,
    ...aria,
  };
  const inner = (
    <>
      <span className="plg-btn-content">
        {icon ? <span className="plg-btn-icon">{icon}</span> : null}
        {children !== undefined && children !== null ? <span className="plg-btn-label">{children}</span> : null}
        {note ? <span className="plg-btn-note">{note}</span> : null}
      </span>
      {loading ? <><span className="plg-btn-spinner" aria-hidden="true" /><span className="plg-sr">{loadingLabel}</span></> : null}
    </>
  );
  if (href && !disabled && !loading) {
    return <Link href={href} onClick={onClick} {...shared}>{inner}</Link>;
  }
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading ? 'true' : undefined}
      onClick={(event) => { if (loading) { event.preventDefault(); return; } onClick?.(event); }}
      {...shared}
    >
      {inner}
    </button>
  );
}

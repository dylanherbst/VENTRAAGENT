// GlassState: the loading, empty and error placeholders for a region of an app page, so every page handles the three
// non-happy states the same way. Loading is announced politely; an error is announced straight away.
import type { ReactNode } from 'react';
import { GlassIcon } from './glass-icon';

export interface GlassStateProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  children?: ReactNode;
  /** Usually one GlassButton (try again, go to the previous step). */
  action?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function GlassState({ kind, title, children, action, className = '', ...rest }: GlassStateProps) {
  return (
    <div className={`plg-state ${className}`.trim()} data-kind={kind} role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading' || undefined} {...rest}>
      <span className="plg-state-mark" aria-hidden="true">
        {kind === 'loading' ? <span className="plg-state-spinner" /> : <GlassIcon name={kind === 'error' ? 'warn' : 'info'} size={22} />}
      </span>
      <p className="plg-state-title">{title}</p>
      {children ? <div className="plg-state-text">{children}</div> : null}
      {action ? <div className="plg-state-action">{action}</div> : null}
    </div>
  );
}

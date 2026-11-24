// GlassBadge: a small status pill. Tone carries meaning in the label as well as the colour, so it never relies on
// colour alone. `demo` and `live` are the honesty labels: sample data versus a real connection.
import type { ReactNode } from 'react';

export type GlassBadgeTone = 'neutral' | 'demo' | 'live' | 'success' | 'warn' | 'danger' | 'highlight';

export interface GlassBadgeProps {
  children: ReactNode;
  tone?: GlassBadgeTone;
  /** Small leading dot (status lights). */
  dot?: boolean;
  className?: string;
  title?: string;
  'data-testid'?: string;
}

export function GlassBadge({ children, tone = 'neutral', dot = false, className = '', ...rest }: GlassBadgeProps) {
  return (
    <span className={`plg-badge ${className}`.trim()} data-tone={tone} {...rest}>
      {dot ? <span className="plg-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

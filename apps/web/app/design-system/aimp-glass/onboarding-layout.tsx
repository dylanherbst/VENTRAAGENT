// OnboardingLayout: the shared screen frame. Same side gutters and safe-area spacing on every screen, a column
// that is centred at tablet and desktop widths, and room for a header on top and a primary action at the bottom.
// Nothing is fixed to the viewport: on short screens, with large text or with the keyboard open, the page simply
// scrolls, so focused fields and the action stay reachable.
import type { ReactNode } from 'react';

export interface OnboardingLayoutProps {
  /** Usually <OnboardingHeader>. */
  header?: ReactNode;
  children: ReactNode;
  /** Bottom-anchored action group (primary button, legal note). */
  footer?: ReactNode;
  /**
   * Where the content sits when the screen is taller than the content.
   * `end`: pushed down, leaving the wave area open above (Welcome, Create account).
   * `start`: directly under the header (Feature overview).
   */
  align?: 'start' | 'end';
  /** Text alignment of the content. */
  text?: 'start' | 'center';
  /** `main` for a real page; `div` when several layouts share one page (the showcase). */
  as?: 'main' | 'div';
  /** Fill the parent box instead of the viewport (showcase phone frames). */
  contained?: boolean;
  className?: string;
}

export function OnboardingLayout({ header, children, footer, align = 'end', text = 'start', as: Tag = 'main', contained = false, className = '' }: OnboardingLayoutProps) {
  return (
    <div className={`plg-layout ${className}`.trim()} data-contained={contained ? 'true' : undefined}>
      <div className="plg-layout-column">
        {header}
        <Tag className="plg-layout-main" data-align={align} data-text={text}>
          {children}
        </Tag>
        {footer ? <div className="plg-layout-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

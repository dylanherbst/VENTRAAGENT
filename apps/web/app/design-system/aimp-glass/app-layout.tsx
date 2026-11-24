// AppLayout: the frame for app pages after onboarding. Same backdrop, gutters and safe-area spacing as
// OnboardingLayout, but the column is wider on tablet and desktop so cards can sit in a grid. Nothing is fixed to the
// viewport; the page scrolls and the action row sits at the end of the content.
import type { ReactNode } from 'react';

export interface AppLayoutProps {
  /** Usually <JourneyHeader>. */
  header?: ReactNode;
  children: ReactNode;
  /** Primary action row at the end of the page (one primary button, then quieter ones). */
  footer?: ReactNode;
  /** `regular` up to 720px, `wide` up to 960px. */
  width?: 'regular' | 'wide';
  as?: 'main' | 'div';
  className?: string;
}

export function AppLayout({ header, children, footer, width = 'wide', as: Tag = 'main', className = '' }: AppLayoutProps) {
  return (
    <div className={`plg-app ${className}`.trim()} data-width={width}>
      <div className="plg-app-column">
        {header}
        <Tag className="plg-app-main">{children}</Tag>
        {footer ? <div className="plg-app-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Intro block for an app page: eyebrow, focusable heading and a short lede. */
export function AppIntro({ eyebrow, title, children, badges }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; badges?: ReactNode }) {
  return (
    <div className="plg-app-intro">
      {eyebrow ? <p className="plg-eyebrow">{eyebrow}</p> : null}
      <h1 className="plg-title" tabIndex={-1}>{title}</h1>
      {children ? <div className="plg-lede">{children}</div> : null}
      {badges ? <div className="plg-badges">{badges}</div> : null}
    </div>
  );
}

/** Responsive card grid: one column on phones, two (or three) where there is room. */
export function GlassGrid({ children, min = 300, className = '' }: { children: ReactNode; min?: number; className?: string }) {
  return <div className={`plg-grid ${className}`.trim()} style={{ ['--plg-grid-min' as string]: `${min}px` }}>{children}</div>;
}

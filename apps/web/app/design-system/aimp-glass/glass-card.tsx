// GlassCard: the content card for app pages. A raised glass surface with an optional eyebrow, heading, badges and a
// footer row of actions. `highlighted` is the one peach-to-purple treatment a view may use (the selected or
// recommended choice); it is a lightened wash of the highlight so plum body text keeps its contrast across the card.
// GlassKeyValue is a compact label/value list, GlassDisclosure a native <details> for detail people may skip.
import type { ElementType, ReactNode } from 'react';

export interface GlassCardProps {
  children?: ReactNode;
  as?: ElementType;
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** Heading element for the title. */
  heading?: 'h2' | 'h3' | 'h4';
  /** Badges or a short status, shown at the end of the heading row. */
  badges?: ReactNode;
  /** Action row at the bottom of the card. */
  footer?: ReactNode;
  highlighted?: boolean;
  /** Blur what is behind. Turn off inside another frosted surface. */
  frosted?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
}

export function GlassCard({ children, as: Tag = 'section', eyebrow, title, heading: H = 'h2', badges, footer, highlighted = false, frosted = true, className = '', ...rest }: GlassCardProps) {
  return (
    <Tag className={`plg-card ${className}`.trim()} data-highlighted={highlighted ? 'true' : undefined} data-frosted={frosted ? 'true' : 'false'} {...rest}>
      {eyebrow || title || badges ? (
        <div className="plg-card-head">
          <div className="plg-card-heading">
            {eyebrow ? <p className="plg-eyebrow">{eyebrow}</p> : null}
            {title ? <H className="plg-card-title">{title}</H> : null}
          </div>
          {badges ? <div className="plg-card-badges">{badges}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="plg-card-footer">{footer}</div> : null}
    </Tag>
  );
}

export interface GlassKeyValueProps {
  items: readonly { label: ReactNode; value: ReactNode; key?: string }[];
  /** `rows`: label left, value right. `stack`: label above value (long values). */
  layout?: 'rows' | 'stack';
  className?: string;
  'data-testid'?: string;
}

export function GlassKeyValue({ items, layout = 'rows', className = '', ...rest }: GlassKeyValueProps) {
  return (
    <dl className={`plg-kv ${className}`.trim()} data-layout={layout} {...rest}>
      {items.map((item, i) => (
        <div className="plg-kv-row" key={item.key ?? i}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface GlassDisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function GlassDisclosure({ summary, children, defaultOpen = false, className = '' }: GlassDisclosureProps) {
  return (
    <details className={`plg-details ${className}`.trim()} open={defaultOpen || undefined}>
      <summary className="plg-details-summary"><span>{summary}</span></summary>
      <div className="plg-details-body">{children}</div>
    </details>
  );
}

// FeatureRow: a wide translucent card with two lines of copy on the left and a glossy icon on the right.
// Static by default; give it an `href` and it becomes a real link. Copy wraps and the row grows with it.
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface FeatureRowProps {
  title: string;
  detail?: ReactNode;
  icon?: ReactNode;
  href?: string;
  /** Heading level for the title when the row is static (default: no heading, plain text). */
  as?: 'div' | 'li';
  className?: string;
}

export function FeatureRow({ title, detail, icon, href, as: Tag = 'div', className = '' }: FeatureRowProps) {
  const body = (
    <>
      <span className="plg-row-text">
        <span className="plg-row-title">{title}</span>
        {detail ? <span className="plg-row-detail">{detail}</span> : null}
      </span>
      {icon ? <span className="plg-row-icon" aria-hidden="true">{icon}</span> : null}
    </>
  );
  const cls = `plg-row plg-surface ${className}`.trim();
  if (href) {
    const link = <Link className={cls} href={href} data-frosted="true" data-tone="quiet" data-link="true">{body}</Link>;
    return Tag === 'li' ? <li className="plg-row-item">{link}</li> : link;
  }
  return <Tag className={cls} data-frosted="true" data-tone="quiet">{body}</Tag>;
}

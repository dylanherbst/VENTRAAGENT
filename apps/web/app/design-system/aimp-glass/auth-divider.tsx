// AuthDivider: short centred copy between two fine rules. The rules are decoration only.
import type { ReactNode } from 'react';

export function AuthDivider({ children, className = '' }: { children?: ReactNode; className?: string }) {
  if (!children) return <hr className={`plg-divider-rule ${className}`.trim()} />;
  return (
    <div className={`plg-divider ${className}`.trim()}>
      <span className="plg-divider-line" aria-hidden="true" />
      <span className="plg-divider-text">{children}</span>
      <span className="plg-divider-line" aria-hidden="true" />
    </div>
  );
}

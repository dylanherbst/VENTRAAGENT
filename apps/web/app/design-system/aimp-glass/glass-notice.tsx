// GlassNotice: an inline message on raised glass. `error` and `warn` are announced straight away (role="alert");
// `info` and `success` politely (role="status"). The icon repeats the tone, so meaning never rests on colour alone.
import type { ReactNode } from 'react';
import { GlassIcon } from './glass-icon';

export type GlassNoticeTone = 'info' | 'success' | 'warn' | 'error';

export interface GlassNoticeProps {
  tone?: GlassNoticeTone;
  title?: string;
  children?: ReactNode;
  /** A link or button shown under the message. */
  action?: ReactNode;
  /** Override the announcement. `none` for static explanatory notes that should not be announced. */
  live?: 'auto' | 'none';
  className?: string;
  id?: string;
  'data-testid'?: string;
}

const icon = { info: 'info', success: 'check', warn: 'warn', error: 'warn' } as const;

export function GlassNotice({ tone = 'info', title, children, action, live = 'auto', className = '', ...rest }: GlassNoticeProps) {
  const role = live === 'none' ? undefined : tone === 'error' || tone === 'warn' ? 'alert' : 'status';
  return (
    <div className={`plg-notice ${className}`.trim()} data-tone={tone} role={role} {...rest}>
      <span className="plg-notice-icon"><GlassIcon name={icon[tone]} size={18} /></span>
      <div className="plg-notice-body">
        {title ? <p className="plg-notice-title">{title}</p> : null}
        {children ? <div className="plg-notice-text">{children}</div> : null}
        {action ? <div className="plg-notice-action">{action}</div> : null}
      </div>
    </div>
  );
}

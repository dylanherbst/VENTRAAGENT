import Link from 'next/link';
import type { ReactNode } from 'react';
import { OutlineIcon } from './primitives';

// Shared states. Every one says what happened in words and what to do next; none relies on colour alone.
export function LoadingState({ children = 'Loading…' }: { children?: ReactNode }) {
  return <div className="v-state v-state-loading" role="status" aria-live="polite"><span className="v-spinner" aria-hidden="true" />{children}</div>;
}
export function ErrorState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="v-state v-state-error" role="alert"><OutlineIcon name="help" /><div><strong>{title}</strong><p>{children}</p>{action}</div></div>;
}
export function ConnectionRequired({ title = 'Connection required', children, href = '/settings?section=integrations' }: { title?: string; children: ReactNode; href?: string }) {
  return <div className="v-state v-state-connect" role="group" aria-label={title}><OutlineIcon name="lock" /><div><strong>{title}</strong><p>{children}</p><Link className="v-text-link" href={href}>See what is connected <OutlineIcon name="arrow" /></Link></div></div>;
}
export function SaveConfirmation({ children }: { children: ReactNode }) {
  return <div className="v-state v-state-saved" role="status" aria-live="polite"><OutlineIcon name="check" /><span>{children}</span></div>;
}

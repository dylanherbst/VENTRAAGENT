import type { ComponentPropsWithRef, InputHTMLAttributes, ReactNode } from 'react';
export function GlassCard({ children, className = '', strong = false }: { children: ReactNode; className?: string; strong?: boolean }) {
  return <section className={'v-glass ' + (strong ? 'v-glass-strong ' : '') + className}>{children}</section>;
}
export function GlassButton({ variant = 'secondary', className = '', loading = false, disabled, ...props }: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'icon'; loading?: boolean }) {
  return <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={'v-button v-button-' + variant + ' ' + className} />;
}
export function GlassInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={'v-input ' + (props.className ?? '')} />; }
const paths: Record<string, string> = {
 check:'m5 12 4 4 10-10', back:'M19 12H5m6-6-6 6 6 6', heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z', share:'M12 16V3m-5 5 5-5 5 5M4 13v8h16v-8',
 home: 'm3 10 9-7 9 7v10h-6v-7H9v7H3z', grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 plus: 'M12 4v16M4 12h16', people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 chart: 'M4 20V13M10 20V9M16 20V4M22 20H2', bolt: 'm13 2-9 12h7l-1 8 10-12h-7z', sales: 'M3 5h18v15H3zM3 10h18M7 15h4', box: 'm12 2 10 5-10 5L2 7zM2 7v10l10 5 10-5V7M12 12v10',
 trend: 'M3 3v18h18M6 16l5-5 4 3 6-8', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4', menu: 'M4 6h16M4 12h16M4 18h16', arrow: 'M5 12h14m-6-6 6 6-6 6', edit: 'M12 4H4v16h16v-8M15 3l6 6M10 14l2-6 5-5 4 4-5 5z',
 more:'M5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M17 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0', lock:'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z', mail:'M3 5h18v14H3zM3 6l9 7 9-7', video:'M3 6h12v12H3zM15 10l6-3v10l-6-3', image:'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M9 9h.01', receipt:'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2', rocket:'M5 19c0-3 2-5 4-5M14 4c4 0 6 2 6 6-3 4-6 6-10 6l-2-2c0-4 2-7 6-10zM9 14l-2 5 5-2', calendar: 'M4 5h16v16H4zM8 2v6M16 2v6M4 11h16M8 15h3', phone: 'M6 3H3c0 10 8 18 18 18v-5l-5-2-2 2a15 15 0 0 1-6-6l2-2-2-5z', account: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', close: 'm6 6 12 12M6 18 18 6',
};
export function OutlineIcon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name] ?? paths.grid} /></svg>; }

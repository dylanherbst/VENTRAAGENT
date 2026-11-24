import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import VentraShell from '../ui/ventra-shell';
export const metadata: Metadata = { title: 'VENTRA', appleWebApp: { capable: true, title: 'VENTRA', statusBarStyle: 'default' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{ media: '(prefers-color-scheme: light)', color: '#c3b4bb' }, { media: '(prefers-color-scheme: dark)', color: '#15121c' }] };
export default function Layout({children}:{children:ReactNode}){return <VentraShell>{children}</VentraShell>;}

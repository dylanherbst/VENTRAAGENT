import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import '../design-system/glass/ventra-glass.css';
import '../design-system/liquid-glass/app.css';

// Isolated showcase for glasscn components installed through the shadcn registry. Not linked from the app.
export const metadata: Metadata = { title: 'VENTRA glass showcase', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function ShowcaseLayout({ children }: { children: ReactNode }) { return children; }

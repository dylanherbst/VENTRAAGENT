import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import '../design-system/glass/ventra-glass.css';
import '../design-system/liquid-glass/app.css';

// UI lab: a bare page for trying glass effects in isolation (branch ui/lab). Not linked from the app.
export const metadata: Metadata = { title: 'VENTRA UI lab', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function LabLayout({ children }: { children: ReactNode }) { return children; }

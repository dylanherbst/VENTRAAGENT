import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import '../design-system/aimp-glass/tokens.css';
import '../design-system/aimp-glass/aimp-glass.css';
import './app.css';
import { WaveBackdrop } from '../design-system/aimp-glass';
import { site } from '../../lib/aimp/site-config';

// The owner workspace after launch (`/app/[business]`) on the Peach & Lavender Glass library. One backdrop for every owner page.
export const metadata: Metadata = {
  title: { default: `Your business · ${site.name}`, template: `%s · ${site.name}` },
  robots: { index: false, follow: false }, // owner pages are never indexed
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#d2d0f2' };

export default function OwnerAppLayout({ children }: { children: ReactNode }) {
  return <WaveBackdrop>{children}</WaveBackdrop>;
}

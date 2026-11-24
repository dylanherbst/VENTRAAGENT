import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import '../design-system/aimp-glass/tokens.css';
import '../design-system/aimp-glass/aimp-glass.css';
import '../app/[business]/carousel/tokens.css';
import '../app/[business]/workspace-skin.css';
import './start.css';
import '../app/[business]/theme-dark.css';
import { StartShell } from './start-shell';
import { WaveBackdrop } from '../design-system/aimp-glass';
import { site } from '../../lib/aimp/site-config';

// The customer entry flow (Welcome -> Create account -> Feature overview -> Goals) on the Peach & Lavender Glass
// library. One backdrop for the whole flow, so the waves stay put while the screens change.
export const metadata: Metadata = {
  title: { default: `Get started · ${site.name}`, template: `%s · ${site.name}` },
  description: 'Answer a few questions and see business ideas matched to your budget and time. No earnings promises.',
  robots: { index: false, follow: false }, // not approved for search yet (same as /plant-lab)
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#d2d0f2' };

export default function StartLayout({ children }: { children: ReactNode }) {
  return <WaveBackdrop><StartShell>{children}</StartShell></WaveBackdrop>;
}

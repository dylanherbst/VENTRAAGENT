import type { Metadata } from 'next';
import { Showcase } from './showcase';
import './showcase.css';

// Component showcase for the Peach & Lavender Glass library: the three reference compositions side by side and
// every component variant and state. It lives under /start (not /tools) because the tools layout wraps pages in the
// VENTRA shell, and the library needs its own full-bleed backdrop. /tools/aimp-glass links here.
export const metadata: Metadata = { title: 'Glass UI showcase' };

export default function StartShowcase() {
  return <Showcase />;
}

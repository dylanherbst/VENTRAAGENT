import type { Metadata, Viewport } from 'next';
import './globals.css';
import './agents.css';

export const metadata: Metadata = { title: { default: 'Studio · AiMoneyPrinter', template: '%s · Studio' }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#573496' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-AU"><body>{children}</body></html>;
}

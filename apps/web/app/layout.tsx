import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIMoneyPrinter',
  description: 'Find a side hustle, build it, and get your first customers. By Ventra.',
  // Added to the Home Screen on an iPhone it opens full screen like an app (the manifest covers Android and newer iOS).
  appleWebApp: { capable: true, title: 'AIMoneyPrinter', statusBarStyle: 'default' },
};

// Sets light or dark before the first paint (saved choice, else the device setting) so the page never flashes the wrong theme.
const THEME_SCRIPT = "try{var t=localStorage.getItem('aimp-theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head><body>{children}</body></html>;
}

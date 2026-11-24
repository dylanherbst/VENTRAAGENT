import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './site.css';
import { GetStartedProvider } from './_ui/get-started';
import { JourneyProvider } from './_ui/journey';

const url = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.aiventra.com.au';
export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: { default: 'VENTRA — Your AI launchpad for financial freedom', template: '%s · VENTRA' },
  description: 'Build your business with AI, then let AI employees answer enquiries and book appointments. Launch ideas, create courses, find customers and grow from one platform.',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'VENTRA', title: 'Build your business. Let AI handle the rest.', description: 'Launch ideas, create products, find customers, answer enquiries and book appointments, all from one intelligent platform.', url },
  twitter: { card: 'summary_large_image', title: 'VENTRA', description: 'Build your business. Let AI handle the rest.' },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <div className="vs"><JourneyProvider><GetStartedProvider>{children}</GetStartedProvider></JourneyProvider></div>;
}

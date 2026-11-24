import { Inter, Inter_Tight } from 'next/font/google';

// Self-hosted at build time by next/font (no runtime request to Google).
export const displayFont = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--amp-display' });
export const bodyFont = Inter({ subsets: ['latin'], display: 'swap', variable: '--amp-body' });
export const fontVars = `${displayFont.variable} ${bodyFont.variable}`;

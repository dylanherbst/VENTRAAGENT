import type { ReactNode, SVGProps } from 'react';

// Small line icons with one consistent 1.5px stroke. Decorative: always aria-hidden.
function Svg({ size = 20, children, ...rest }: { size?: number; children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}
type P = { size?: number; className?: string };

export const IconCheck = (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const IconCheckCircle = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.7 2.7L16 9.7" /></Svg>;
export const IconCircle = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /></Svg>;
export const IconArrowLeft = (p: P) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconArrowRight = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IconCompass = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;

export const modelIcons = {
  'digital-templates': (p: P) => <Svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></Svg>,
  'printable-art': (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="8.5" r="1.5" /></Svg>,
  'personalised-digital': (p: P) => <Svg {...p}><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></Svg>,
  'marketing-assets': (p: P) => <Svg {...p}><path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1z" /><path d="M18 9a4 4 0 0 1 0 6" /></Svg>,
} as const;

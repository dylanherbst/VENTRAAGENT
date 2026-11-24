// GlassIcon: one icon component for the Peach & Lavender Glass library.
//  - Control icons are simple line icons. Where the existing glass kit already has one (components/glass/icons.tsx)
//    it is reused; the rest are drawn on the same 24px grid with the same 1.8 stroke.
//  - Provider marks keep their brand colours.
//  - Feature icons are glossy, dimensional inline SVGs that repeat the tile's peach -> rose-lilac -> purple direction.
// Icons are decorative by default (aria-hidden). Pass `title` only when the icon is the sole content with meaning;
// icon-only buttons should carry their own aria-label instead.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { I } from '../../../components/glass/icons';

const line = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const controlIcons = {
  back: line(<path d="M19 12H5m6-6-6 6 6 6" />),
  forward: line(<path d="M5 12h14m-6-6 6 6-6 6" />),
  user: line(<><circle cx="12" cy="8.2" r="3.6" /><path d="M5 19.5c.8-3.4 3.5-5.2 7-5.2s6.2 1.8 7 5.2" /></>),
  lock: line(<><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.6" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2" /></>),
  eye: line(<><path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.8" /></>),
  eyeOff: line(<><path d="M4 4l16 16M9.9 6.1A8.6 8.6 0 0 1 12 5.8c5.8 0 9.2 6.2 9.2 6.2a15 15 0 0 1-2.6 3.3M6.2 7.9A14.6 14.6 0 0 0 2.8 12s3.4 6.2 9.2 6.2a8.7 8.7 0 0 0 3.4-.7" /><path d="M10 10.1a2.8 2.8 0 0 0 3.9 3.9" /></>),
  dollar: line(<><circle cx="12" cy="12" r="8.5" /><path d="M14.6 9.3c-.4-.9-1.3-1.4-2.6-1.4-1.6 0-2.7.8-2.7 2 0 2.9 5.5 1.3 5.5 4.2 0 1.2-1.2 2-2.8 2-1.4 0-2.4-.6-2.8-1.6M12 6.5v11" /></>),
  clock: line(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  heart: line(<path d="M12 19.5S4.5 15 4.5 9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7.5 1.6C19.5 15 12 19.5 12 19.5Z" />),
  tools: line(<><path d="M14.5 6.2a3.8 3.8 0 0 0-4.9 4.9L4.5 16.2a1.6 1.6 0 0 0 2.3 2.3l5.1-5.1a3.8 3.8 0 0 0 4.9-4.9l-2.3 2.3-1.9-.5-.5-1.9Z" /></>),
  // Reused from the existing glass kit (same grid and stroke).
  mail: I.mail,
  check: I.check,
  close: I.close,
  info: I.info,
  warn: I.warn,
  chevron: I.chevron,
} as const;

const providerIcons = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5Z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16.7 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.6-1-2.7-4.1ZM14.4 5.7c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2-.5 2.7-1.3Z" />
    </svg>
  ),
} as const;

export type ControlIconName = keyof typeof controlIcons;
export type ProviderIconName = keyof typeof providerIcons;
export const featureIconNames = ['spark', 'search', 'approve', 'store', 'bell', 'leaf', 'bars', 'shield'] as const;
export type FeatureIconName = (typeof featureIconNames)[number];
export type GlassIconName = ControlIconName | ProviderIconName | FeatureIconName;
export const controlIconNames = Object.keys(controlIcons) as ControlIconName[];
export const providerIconNames = Object.keys(providerIcons) as ProviderIconName[];

const isFeature = (n: GlassIconName): n is FeatureIconName => (featureIconNames as readonly string[]).includes(n);
const isProvider = (n: GlassIconName): n is ProviderIconName => n in providerIcons;

/**
 * `pearl` is for an icon sitting on the coloured highlight tile, where a gradient icon would disappear.
 * `deep` is a stronger rose-to-purple for small icons on the white primary button.
 */
export type FeatureTone = 'gradient' | 'pearl' | 'deep';

function FeatureArt({ name, tone }: { name: FeatureIconName; tone: FeatureTone }) {
  const raw = useId();
  const id = `plg-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const g = `url(#${id}-g)`;
  const gloss = `url(#${id}-s)`;
  // On the pearl tone the inner mark is drawn in purple; on the gradient tone it is white.
  const mark = tone === 'pearl' ? '#7d4fae' : '#ffffff';
  const shapes: Record<FeatureIconName, ReactNode> = {
    spark: <>
      <path fill={g} d="M20 6c1.7 10.8 6.2 15.3 17 17-10.8 1.7-15.3 6.2-17 17-1.7-10.8-6.2-15.3-17-17 10.8-1.7 15.3-6.2 17-17Z" />
      <path fill={g} d="M38 4c.7 4.4 2.6 6.3 7 7-4.4.7-6.3 2.6-7 7-.7-4.4-2.6-6.3-7-7 4.4-.7 6.3-2.6 7-7Z" />
      {tone === 'deep' ? null : <path fill={gloss} d="M20 11c1 5.5 3 9 7.5 11-5-1-10.5-.8-15 .2 4.5-2 6.5-5.2 7.5-11.2Z" />}
    </>,
    search: <>
      <path d="M31 31l9.5 9.5" stroke={g} strokeWidth="6" strokeLinecap="round" />
      <circle cx="21" cy="21" r="14" fill={g} />
      <circle cx="21" cy="21" r="9.5" fill="#ffffff" fillOpacity={tone === 'pearl' ? 0.55 : 0.3} />
      <ellipse cx="16" cy="13.5" rx="8" ry="4.5" fill={gloss} transform="rotate(-28 16 13.5)" />
      <path d="M15.5 21.5l4 4 7.5-8.5" fill="none" stroke={mark} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    approve: <>
      <circle cx="24" cy="24" r="18" fill={g} />
      <ellipse cx="18" cy="14.5" rx="10.5" ry="5.5" fill={gloss} transform="rotate(-28 18 14.5)" />
      <path d="M15.5 24.5l6 6L33 18" fill="none" stroke={mark} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    store: <>
      <path fill={g} d="M9 21h30v17a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4Z" />
      <path fill={g} d="M10.5 7h27a2 2 0 0 1 1.9 1.3L43 18a5 5 0 0 1-9.5 2.2 5 5 0 0 1-9.5 0 5 5 0 0 1-9.5 0A5 5 0 0 1 5 18l3.6-9.7A2 2 0 0 1 10.5 7Z" />
      <path fill={gloss} d="M11.5 9h25l1.2 3.2H10.3Z" />
      <rect x="19.5" y="28" width="9" height="14" rx="2.5" fill={mark} fillOpacity=".92" />
    </>,
    bell: <>
      <path fill={g} d="M24 5a3 3 0 0 1 3 3v.6c5.3 1.4 9 6.1 9 11.9v7.5l3.4 5.3a2 2 0 0 1-1.7 3.1H10.3a2 2 0 0 1-1.7-3.1L12 28v-7.5c0-5.8 3.7-10.5 9-11.9V8a3 3 0 0 1 3-3Z" />
      <path fill={g} d="M19 39.5h10a5 5 0 0 1-10 0Z" />
      <path fill={gloss} d="M17 15c2-3 5-4.5 8-4.5-3 2.5-5 6-5.5 11-.2 2-3.5 2-3.5 0 0-2.5.3-4.8 1-6.5Z" />
    </>,
    leaf: <>
      <path fill={g} d="M41 6c1.5 13-1 23-8.5 29.5C26.5 40.7 18 40 13.5 36 9 31 9.3 22.5 15 17 21.5 10.8 30 7 41 6Z" />
      <path fill={gloss} d="M37 9.5c-9 1.5-15.5 5-20 9.5-2 2-3 4.5-3.2 7 6-9 13.2-13.5 23.2-16.5Z" />
      <path d="M33 14C23 22 15 31 7.5 43" fill="none" stroke={mark} strokeOpacity=".9" strokeWidth="2.6" strokeLinecap="round" />
    </>,
    bars: <>
      <rect x="6" y="25" width="9" height="18" rx="4.5" fill={g} />
      <rect x="19.5" y="15" width="9" height="28" rx="4.5" fill={g} />
      <rect x="33" y="5" width="9" height="38" rx="4.5" fill={g} />
      <rect x="7.5" y="27" width="3" height="11" rx="1.5" fill={gloss} />
      <rect x="21" y="17" width="3" height="16" rx="1.5" fill={gloss} />
      <rect x="34.5" y="7" width="3" height="22" rx="1.5" fill={gloss} />
    </>,
    shield: <>
      <path fill={g} d="M24 4.5 40 10v12.5c0 9.8-6.3 17.3-16 21-9.7-3.7-16-11.2-16-21V10Z" />
      <path fill={gloss} d="M24 7.5 11 12v9c0 1.5.2 3 .5 4.4C14 17 18.5 11.5 24 7.5Z" />
      <path d="M17 24l5 5 9.5-10.5" fill="none" stroke={mark} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </>,
  };
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        {tone === 'pearl' ? (
          <linearGradient id={`${id}-g`} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" /><stop offset=".6" stopColor="#fbf3fb" /><stop offset="1" stopColor="#ecdcf6" />
          </linearGradient>
        ) : tone === 'deep' ? (
          <linearGradient id={`${id}-g`} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#c98dcb" /><stop offset=".5" stopColor="#9b6cc5" /><stop offset="1" stopColor="#5b3594" />
          </linearGradient>
        ) : (
          <linearGradient id={`${id}-g`} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f2b9ad" /><stop offset=".42" stopColor="#c98dcb" /><stop offset="1" stopColor="#8f5fbd" />
          </linearGradient>
        )}
        <linearGradient id={`${id}-s`} x1="10" y1="6" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity={tone === 'pearl' ? 0.95 : 0.7} /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {shapes[name]}
    </svg>
  );
}

export interface GlassIconProps {
  name: GlassIconName;
  /** Rendered size in px. Defaults: 20 for control and provider icons, 44 for feature icons. */
  size?: number;
  /** Feature icons only. */
  tone?: FeatureTone;
  /** Gives the icon an accessible name. Leave out for decorative icons (the default). */
  title?: string;
  className?: string;
}

export function GlassIcon({ name, size, tone = 'gradient', title, className = '' }: GlassIconProps) {
  const kind = isFeature(name) ? 'feature' : isProvider(name) ? 'provider' : 'control';
  const px = size ?? (kind === 'feature' ? 44 : 20);
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <span className={`plg-icon ${className}`.trim()} data-kind={kind} data-tone={kind === 'feature' ? tone : undefined} style={{ inlineSize: px, blockSize: px }} {...a11y}>
      {isFeature(name) ? <FeatureArt name={name} tone={tone} /> : isProvider(name) ? providerIcons[name] : controlIcons[name]}
    </span>
  );
}

// WaveBackdrop: the pearl canvas with broad, soft diagonal folds. One per view; every glass layer sits on top of it.
// It also sets the `.plg` scope that carries the tokens, so all library components must be rendered inside it.
// The waves are static, stretch with the viewport and are hidden from assistive technology.
import { useId } from 'react';
import type { ReactNode } from 'react';

export interface WaveBackdropProps {
  children?: ReactNode;
  /**
   * `page` (default): fills the viewport and stays put while content scrolls.
   * `contained`: fills its parent box instead (showcase phone frames, previews).
   */
  mode?: 'page' | 'contained';
  /**
   * `auto` (default): translucent, blurred glass where the browser supports backdrop-filter, solid fallback elsewhere.
   * `opaque`: force the solid light-lilac fallback (for testing it, or for low-power devices).
   */
  glass?: 'auto' | 'opaque';
  className?: string;
}

function Waves() {
  // Unique gradient ids, so several backdrops can share a page (the showcase has four).
  const id = `plg-wave-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Drawn on a 390 x 844 phone canvas and stretched to the box. The blur filter melts the shapes into folds.
  return (
    <svg className="plg-waves-art" viewBox="0 0 390 844" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--plg-wave-base-a)" /><stop offset=".5" stopColor="var(--plg-wave-base-b)" /><stop offset="1" stopColor="var(--plg-wave-base-c)" />
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--plg-blush)" /><stop offset=".55" stopColor="var(--plg-wave-mist)" /><stop offset="1" stopColor="var(--plg-pearl)" />
        </linearGradient>
        <linearGradient id={`${id}-fold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--plg-blush)" /><stop offset=".45" stopColor="var(--plg-pearl)" /><stop offset="1" stopColor="var(--plg-blush)" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      <rect x="-60" y="-60" width="510" height="964" fill={`url(#${id}-base)`} />
      <g filter={`url(#${id}-blur)`}>
        {/* pale haze above the first fold */}
        <ellipse cx="60" cy="40" rx="230" ry="90" fill="var(--plg-fold)" opacity=".75" />
        {/* first fold: a bright rim arching from the left edge up to the top right, blush on the left, pearl on the right */}
        <path d="M-70 300C10 226 110 112 250 92 330 82 410 100 460 120V182C400 152 330 134 256 146 140 168 40 276-70 362Z" fill={`url(#${id}-arc)`} opacity=".95" />
        {/* periwinkle shade tucked under the first fold */}
        <path d="M-70 372C40 286 140 178 256 156 330 144 400 162 460 192V282C390 248 320 236 262 250 160 276 50 380-70 452Z" fill="var(--plg-trough)" opacity=".55" />
        {/* second fold: sweeps from the right edge down to the left, with blush where it catches the light */}
        <path d="M460 296C400 306 330 378 250 430 160 488 60 482-70 544V612C60 550 170 554 262 500 340 452 400 384 460 370Z" fill={`url(#${id}-fold)`} opacity=".95" />
        {/* its shadow, and a cool glow lower right */}
        <path d="M460 384C400 396 340 462 262 512 170 566 60 562-70 624V700C60 640 170 640 266 586 344 540 400 480 460 466Z" fill="var(--plg-trough)" opacity=".6" />
        <ellipse cx="330" cy="520" rx="110" ry="50" fill="var(--plg-wave-cool)" opacity=".7" transform="rotate(-28 330 520)" />
        {/* third, softer fold and the reflections along the bottom */}
        <path d="M460 590C400 600 330 662 250 712 160 766 60 762-70 814V872C60 824 170 828 262 776 340 728 400 672 460 658Z" fill={`url(#${id}-fold)`} opacity=".8" />
        <ellipse cx="410" cy="610" rx="80" ry="50" fill="var(--plg-blush)" opacity=".85" />
        <ellipse cx="300" cy="800" rx="150" ry="40" fill="var(--plg-trough)" opacity=".45" transform="rotate(-24 300 800)" />
        <ellipse cx="392" cy="836" rx="120" ry="52" fill="var(--plg-blush)" opacity=".9" />
        <ellipse cx="-6" cy="842" rx="120" ry="46" fill="var(--plg-wave-mist)" opacity=".8" />
      </g>
    </svg>
  );
}

export function WaveBackdrop({ children, mode = 'page', glass = 'auto', className = '' }: WaveBackdropProps) {
  return (
    <div className={`plg plg-backdrop ${className}`.trim()} data-mode={mode} data-glass={glass}>
      <div className="plg-waves" aria-hidden="true"><Waves /></div>
      {children}
    </div>
  );
}

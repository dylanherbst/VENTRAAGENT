// GlassSurface: the shared quiet material (translucent white fill, thin light rim, optional blur).
// Rows, standard cards and notices all use it. Without backdrop-filter support it becomes a solid light-lilac card.
import type { CSSProperties, ElementType, ReactNode } from 'react';

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** Element to render. Defaults to a div. */
  as?: ElementType;
  /** Blur what is behind the surface. Turn off for surfaces nested inside another frosted surface. */
  frosted?: boolean;
  /** `raised` is a slightly milkier fill for content that needs a calmer backing (long text, forms). */
  tone?: 'quiet' | 'raised';
  /** `card` = 20px corners, `pill` = fully rounded. */
  shape?: 'card' | 'pill';
  padding?: 'none' | 'compact' | 'regular';
  className?: string;
  style?: CSSProperties;
  id?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-live'?: 'polite' | 'assertive' | 'off';
}

export function GlassSurface({ children, as: Tag = 'div', frosted = true, tone = 'quiet', shape = 'card', padding = 'regular', className = '', ...rest }: GlassSurfaceProps) {
  return (
    <Tag className={`plg-surface ${className}`.trim()} data-frosted={frosted ? 'true' : 'false'} data-tone={tone} data-shape={shape} data-padding={padding} {...rest}>
      {children}
    </Tag>
  );
}

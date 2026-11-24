'use client';
// Child cards use the real liquid-glass-react component (via the shared LiquidGlassBlock wrapper), in "standard" mode to start.
// Settings follow the package notes: displacementScale 100 for edge bending, blurAmount 0.12, saturation 120, aberrationIntensity 2,
// elasticity 0 so dashboard cards stay steady, cornerRadius 28 for a rounded card. A translucent colour wash keeps each card's lavender,
// peach, mint or blue showing through the refraction. Full edge bending is Chromium only; Safari and Firefox show blur and saturation.
import type { ReactNode } from 'react';
import { LiquidGlassBlock } from '../../../../components/ui/liquid-glass-card';
import './child-card.css';

export type CardTint = 'lavender' | 'peach' | 'mint' | 'blue' | 'neutral';
const WASH: Record<CardTint, string> = {
  lavender: 'linear-gradient(150deg, rgb(180 135 239 / .34), var(--cc-end, rgb(255 255 255 / .82)) 92%)',
  peach: 'linear-gradient(150deg, rgb(255 180 142 / .34), var(--cc-end, rgb(255 255 255 / .82)) 92%)',
  mint: 'linear-gradient(150deg, rgb(139 220 184 / .34), var(--cc-end, rgb(255 255 255 / .82)) 92%)',
  blue: 'linear-gradient(150deg, rgb(168 217 247 / .34), var(--cc-end, rgb(255 255 255 / .82)) 92%)',
  neutral: 'linear-gradient(150deg, var(--cc-neutral, rgb(255 255 255 / .6)), var(--cc-end, rgb(255 255 255 / .82)) 92%)',
};

export function ChildCard({ tint = 'neutral', children, padding = '14px', radius = 28, minHeight = 0, className }: { tint?: CardTint; children: ReactNode; padding?: string; radius?: number; minHeight?: number; className?: string }) {
  return (
    <LiquidGlassBlock
      className={`amg-child ${className ?? ''}`.trim()}
      mode="standard" displacementScale={100} blurAmount={0.12} saturation={120} aberrationIntensity={2} elasticity={0}
      cornerRadius={radius} padding={padding} height={minHeight} tint={WASH[tint]}
    >
      {children}
    </LiquidGlassBlock>
  );
}

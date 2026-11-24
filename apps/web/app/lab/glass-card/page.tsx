'use client';
// UI lab: Liquid Glass React cards (components/ui/liquid-glass-card.tsx) on the Obsidian Chrome background. Branch ui/lab only.
import { useRef } from 'react';
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card';
import '../../glass-showcase/glasscn-original.css';
import './glass-card.css';
import { AiSetterCardBody } from './ai-setter-card';
import { HomeBottomNav } from './bottom-nav';

// Grape Cotton Candy: Royal Plum #76335C, Soft Periwinkle #A592EE, Bubblegum Tint #FE86AA (translucent so the glass still reads)
const GRAPE_COTTON_CANDY =
  'linear-gradient(170deg, rgba(118,51,92,.62) 0%, rgba(165,146,238,.55) 48%, rgba(254,134,170,.6) 100%)';

export default function GlassCardLab() {
  const stage = useRef<HTMLElement>(null);
  return (
    <div className="glasscn-original">
      <main ref={stage} className="gcl-stage">
        <div className="gcl-slot"><LiquidGlassCard mouseContainer={stage} width="min(320px, calc(100vw - 80px))" /></div>
        <div className="gcl-slot"><LiquidGlassCard mouseContainer={stage} tint={GRAPE_COTTON_CANDY} width="min(380px, calc(100vw - 72px))" height={0} padding="20px"><AiSetterCardBody /></LiquidGlassCard></div>
        <HomeBottomNav tint={GRAPE_COTTON_CANDY} mouseContainer={stage} />
      </main>
    </div>
  );
}

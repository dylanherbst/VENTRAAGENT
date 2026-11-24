'use client';
// VENTRA wrapper around the real Liquid Glass React component (rdev/liquid-glass-react 1.1.1, MIT). No custom glass here:
// the optical effect is entirely the library's. Notes:
//  - loaded client-only (the library reads navigator.userAgent while rendering);
//  - the library renders sibling layers centred with top/left 50% + translate(-50%,-50%), so the card is centred inside
//    its nearest positioned ancestor (give the parent `position: relative` and a height);
//  - do not put this inside an ancestor that has both overflow:hidden and border-radius: Chromium then draws the glass
//    backdrop as a hard rectangle. Clip backgrounds on their own layer instead;
//  - full edge refraction is Chromium only (Chrome, Edge, Android). Safari/iOS and Firefox show blur + saturation only.
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

const LiquidGlass = dynamic(() => import('liquid-glass-react'), { ssr: false });

export type LiquidGlassCardProps = {
  children?: ReactNode;
  /** Size of the card body when it has no content yet. */
  width?: number | string;
  height?: number;
  mode?: 'standard' | 'polar' | 'prominent' | 'shader';
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  elasticity?: number;
  cornerRadius?: number;
  overLight?: boolean;
  padding?: string;
  /** Optional colour wash laid over the glass (keep it translucent so the refraction still shows through). */
  tint?: string;
  /** Element whose mouse movement drives the elastic effect (defaults to the card itself). */
  mouseContainer?: RefObject<HTMLElement | null>;
};

// Dylan's chosen settings (overLight is off by default; turn it on for white backgrounds).
export function LiquidGlassCard({
  children, width = 320, height = 200,
  mode = 'prominent', displacementScale = 7, blurAmount = 0, saturation = 170, aberrationIntensity = 20,
  elasticity = 0.1, cornerRadius = 24, overLight = false, padding = '24px', tint, mouseContainer,
}: LiquidGlassCardProps) {
  return (
    <LiquidGlass
      mode={mode} displacementScale={displacementScale} blurAmount={blurAmount} saturation={saturation}
      aberrationIntensity={aberrationIntensity} elasticity={elasticity} cornerRadius={cornerRadius}
      overLight={overLight} padding={tint ? '0' : padding} mouseContainer={mouseContainer}
      style={{ position: 'absolute', top: '50%', left: '50%' }}
    >
      {tint
        ? <div style={{ width, minHeight: height, padding, borderRadius: cornerRadius, background: tint, boxSizing: 'content-box' }}>{children}</div>
        : <div style={{ width, minHeight: height }}>{children}</div>}
    </LiquidGlass>
  );
}

/**
 * A Liquid Glass card that takes part in normal page flow: it fills its parent's width and grows with its content.
 * (The library itself always centres absolutely inside a positioned box, so this measures the glass and sizes the box.)
 */
export function LiquidGlassBlock({ padding = '20px', className, ...props }: LiquidGlassCardProps & { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const pad = parseFloat(padding) || 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let glassRo: ResizeObserver | undefined;
    const watchGlass = () => {
      const g = el.querySelector<HTMLElement>('.glass');
      if (!g || glassRo) return;
      glassRo = new ResizeObserver(() => setH(g.offsetHeight));
      glassRo.observe(g);
    };
    const boxRo = new ResizeObserver(() => setW(el.clientWidth));
    boxRo.observe(el);
    const mo = new MutationObserver(watchGlass);
    mo.observe(el, { childList: true, subtree: true });
    watchGlass();
    return () => { boxRo.disconnect(); mo.disconnect(); glassRo?.disconnect(); };
  }, []);
  return (
    <div ref={box} className={className} style={{ position: 'relative', height: h || undefined, minHeight: h ? undefined : 80 }}>
      {w > 0 && <LiquidGlassCard {...props} padding={padding} width={Math.max(0, w - pad * 2)} height={props.height ?? 0} />}
    </div>
  );
}

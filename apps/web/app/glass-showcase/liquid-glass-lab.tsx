'use client';
// Liquid Glass React (rdev/liquid-glass-react 1.1.1, MIT): the real component, unmodified, in three panels plus a settings panel.
// Integration notes (from the library source):
//  - it reads navigator.userAgent during render, so it is loaded client-only (dynamic import, ssr: false);
//  - it renders several sibling layers positioned top/left 50% and translated -50%, so each instance sits in a positioned panel;
//  - its layers use Tailwind classes, so Tailwind scans node_modules/liquid-glass-react/dist (see ventra-glass.css @source).
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

const LiquidGlass = dynamic(() => import('liquid-glass-react'), { ssr: false });
type Mode = 'standard' | 'polar' | 'prominent' | 'shader';
type Settings = { mode: Mode; displacementScale: number; blurAmount: number; saturation: number; aberrationIntensity: number; elasticity: number; cornerRadius: number; overLight: boolean; padding: string };

// Settings from the official demo (liquid-glass-example/src/pages/index.tsx, User Info card)
const DEMO: Settings = { mode: 'standard', displacementScale: 100, blurAmount: 0.5, saturation: 140, aberrationIntensity: 2, elasticity: 0, cornerRadius: 32, overLight: false, padding: '24px 32px' };
// Dylan's approved settings
const APPROVED: Settings = { mode: 'prominent', displacementScale: 7, blurAmount: 0, saturation: 170, aberrationIntensity: 20, elasticity: 0.1, cornerRadius: 24, overLight: true, padding: '24px' };

function UserInfo() {
  return (
    <div className="lgr-userinfo">
      <h3>User Info</h3>
      <div className="lgr-person"><span className="lgr-avatar">JD</span><span><b>John Doe</b><small>Software Engineer</small></span></div>
      <dl><dt>Email:</dt><dd>john.doe@example.com</dd><dt>Location:</dt><dd>San Francisco, CA</dd><dt>Joined:</dt><dd>March 2023</dd></dl>
    </div>
  );
}
function VentraBody() {
  return <div className="lgr-ventra"><h2>VENTRA</h2><p>This must use real optical liquid glass.</p></div>;
}

function Panel({ title, note, bg, s, children }: { title: string; note: string; bg: 'photo' | 'ventra'; s: Settings; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <figure className="lgr-figure">
      <figcaption><strong>{title}</strong><span>{note}</span></figcaption>
      {/* The background is clipped on its own layer: overflow:hidden + border-radius on an ancestor of the glass makes
          Chromium draw the glass backdrop as a hard rectangle around the rounded card. */}
      <div ref={ref} className="lgr-panel">
        <div className={'lgr-bg ' + (bg === 'photo' ? 'lgr-photo' : 'lgr-ventra-bg')} aria-hidden="true">
          {bg === 'ventra' && <div className="lgr-ventra-detail"><b>Bookings today</b><span>12</span><i /></div>}
        </div>
        <LiquidGlass {...s} mouseContainer={ref as RefObject<HTMLElement | null>} style={{ position: 'absolute', top: '50%', left: '50%' }}>{children}</LiquidGlass>
      </div>
    </figure>
  );
}

function engine(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Firefox (Gecko): blur only, no edge refraction';
  if (/(Chrome|Chromium|Edg)\//.test(ua)) return 'Chromium: full refraction supported';
  if (/AppleWebKit\//.test(ua)) return 'WebKit (Safari / iOS): blur only, no edge refraction';
  return ua;
}

export default function LiquidGlassLab() {
  const [s, setS] = useState<Settings>(APPROVED);
  const [eng, setEng] = useState('');
  useEffect(() => { setEng(engine()); }, []);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(x => ({ ...x, [k]: v }));
  const slider = (k: 'displacementScale' | 'blurAmount' | 'saturation' | 'aberrationIntensity' | 'elasticity' | 'cornerRadius', label: string, min: number, max: number, step: number) => (
    <label className="lgr-ctl"><span>{label}<output>{s[k]}</output></span><input type="range" min={min} max={max} step={step} value={s[k]} onChange={e => set(k, Number(e.target.value) as never)} /></label>
  );
  return (
    <div className="lgr-page">
      <header className="lgr-head"><h1>Liquid Glass React: comparison</h1><p>The real <code>liquid-glass-react</code> component (rdev/liquid-glass-react 1.1.1). Engine: <b>{eng || '…'}</b></p></header>
      <div className="lgr-layout">
        <div className="lgr-panels">
          <Panel title="1 · Official demo card" note="Demo settings: standard, displacement 100, blur 0.5, saturation 140" bg="photo" s={DEMO}><UserInfo /></Panel>
          <Panel title="2 · Your settings" note={`${s.mode}, displacement ${s.displacementScale}, blur ${s.blurAmount}, saturation ${s.saturation}, aberration ${s.aberrationIntensity}`} bg="photo" s={s}><VentraBody /></Panel>
          <Panel title="3 · Your settings on VENTRA light" note="White with VENTRA's purple, peach and aqua" bg="ventra" s={s}><VentraBody /></Panel>
        </div>
        <aside className="lgr-settings" aria-label="Glass settings (panels 2 and 3)">
          <h2>Settings</h2>
          <fieldset><legend>Refraction mode</legend>{(['standard', 'polar', 'prominent', 'shader'] as Mode[]).map(m => <label key={m} className="lgr-radio"><input type="radio" name="mode" checked={s.mode === m} onChange={() => set('mode', m)} />{m}</label>)}</fieldset>
          {slider('displacementScale', 'Displacement', 0, 200, 1)}
          {slider('blurAmount', 'Blur', 0, 1, 0.01)}
          {slider('saturation', 'Saturation', 100, 300, 1)}
          {slider('aberrationIntensity', 'Aberration', 0, 20, 1)}
          {slider('elasticity', 'Elasticity', 0, 1, 0.01)}
          {slider('cornerRadius', 'Corner radius', 0, 100, 1)}
          <label className="lgr-radio"><input type="checkbox" checked={s.overLight} onChange={e => set('overLight', e.target.checked)} />Over light background</label>
          <div className="lgr-buttons">
            <button type="button" onClick={() => setS(APPROVED)}>Your settings</button>
            <button type="button" onClick={() => setS({ ...APPROVED, displacementScale: 70 })}>Debug: displacement 70</button>
            <button type="button" onClick={() => setS(DEMO)}>Demo settings</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

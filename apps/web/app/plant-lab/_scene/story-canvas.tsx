'use client';
import { useEffect, useRef } from 'react';
import { track } from '../../../lib/aimp/analytics';
import { stageAt, type StageId } from '../../../lib/aimp/plant/timeline';

/**
 * Binds the 3D scene to the story section's scroll position. Progressive enhancement: the page shows authored still
 * frames until the scene has loaded; with reduced motion, no WebGL, or a load failure, the stills simply stay.
 */
export function StoryCanvas({ storyId }: { storyId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const story = document.getElementById(storyId);
    const root = story?.closest<HTMLElement>('.amp');
    if (!canvas || !story || !root) return;
    const params = new URLSearchParams(window.location.search);
    const still = params.get('still');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced && still === null) { root.dataset.scene = 'static'; return; }
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) { root.dataset.scene = 'static'; return; }

    const finePointer = window.matchMedia('(pointer: fine)').matches;
    let disposed = false;
    let cleanup = () => {};

    import('./plant-scene').then(async ({ PlantScene }) => {
      if (disposed) return;
      // Transmission glass is affordable on current phones at a capped pixel ratio; 'low' is the fallback for WebGL1-only
      // devices or ?quality=low.
      const webgl2 = !!document.createElement('canvas').getContext('webgl2');
      const quality = params.get('quality') === 'low' || !webgl2 ? 'low' : 'high';
      const scene = new PlantScene(canvas, quality);
      const layout = () => {
        const r = canvas.parentElement!.getBoundingClientRect();
        scene.resize(r.width, r.height, window.matchMedia('(max-width: 899px)').matches ? 'mobile' : 'desktop');
      };
      layout();
      try { await scene.load(); } catch { root.dataset.scene = 'static'; scene.dispose(); return; }
      if (disposed) { scene.dispose(); return; }

      if (still !== null) {                                    // capture mode for authored stills and QA
        scene.renderStill(Math.min(1, Math.max(0, Number(still) || 0)));
        (window as unknown as { __plantPNG: string }).__plantPNG = canvas.toDataURL('image/png'); // transparent still
        root.dataset.scene = 'on'; root.dataset.capture = '1';
        (window as unknown as { __plantReady: boolean }).__plantReady = true;
        cleanup = () => scene.dispose();
        return;
      }

      let lastStage: StageId | null = null;
      let lastFade = '';
      const cue = story.querySelector<HTMLElement>('.amp-cue');
      const progress = () => {
        const r = story.getBoundingClientRect();
        const total = Math.max(1, story.offsetHeight - window.innerHeight);
        const p = Math.min(1, Math.max(0, -r.top / total));
        scene.setProgress(p);
        // Touch only the cue's own style; a custom property on the page root would restyle the whole page every frame.
        if (cue) cue.style.opacity = String(Math.max(0, 1 - p * 12));
        // Once the story ends, the plant drifts over the next section; fade it to a soft backdrop behind that content.
        const past = Math.min(1, Math.max(0, (window.innerHeight - r.bottom) / (window.innerHeight * 0.5)));
        const fade = (1 - Math.round(past * 0.4 * 50) / 50).toFixed(2);   // written only when it changes, so most scroll events cost nothing
        if (fade !== lastFade) { lastFade = fade; canvas.style.setProperty('--amp-plant-fade', fade); }
        const stage = stageAt(p);
        if (stage !== lastStage) { lastStage = stage; root.dataset.stage = stage; track('story_stage_view', { stage }); }
      };
      const onPointer = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      };
      const onTap = (e: PointerEvent) => {
        if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return;
        scene.tap();
      };
      const onVisibility = () => scene.setVisible(!document.hidden);
      const ro = new ResizeObserver(layout);
      ro.observe(canvas.parentElement!);
      const io = new IntersectionObserver(([entry]) => scene.setVisible(entry.isIntersecting && !document.hidden));
      io.observe(story);
      window.addEventListener('scroll', progress, { passive: true });
      if (finePointer) window.addEventListener('pointermove', onPointer, { passive: true });
      story.addEventListener('pointerdown', onTap);
      document.addEventListener('visibilitychange', onVisibility);
      progress();
      root.dataset.scene = 'on';
      cleanup = () => {
        ro.disconnect(); io.disconnect();
        window.removeEventListener('scroll', progress);
        window.removeEventListener('pointermove', onPointer);
        story.removeEventListener('pointerdown', onTap);
        document.removeEventListener('visibilitychange', onVisibility);
        scene.dispose();
      };
    }).catch(() => { root.dataset.scene = 'static'; });

    return () => { disposed = true; cleanup(); };
  }, [storyId]);

  return <canvas ref={canvasRef} className="amp-canvas" aria-hidden="true" />;
}

// Seed-to-tree story as a pure function of one normalised scroll progress p ∈ [0, 1] (brief: "drive all geometry and
// material changes from a single progress scalar; deterministic, reversible, never accumulating elapsed time").
// The 3D scene, the static fallbacks and the tests all read the same pose, so every intermediate value is continuous.

export const stages = [
  { id: 'potential', from: 0, to: 0.2 },
  { id: 'foundation', from: 0.2, to: 0.4 },
  { id: 'creation', from: 0.4, to: 0.7 },
  { id: 'growth', from: 0.7, to: 1 },
] as const;
export type StageId = (typeof stages)[number]['id'];

/** Trunk fraction reached at the sprout stage; the left branch starts exactly here (see build_plant.py). */
export const SPROUT = 0.42;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => { const t = seg(x, a, b); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface LeafPose { scale: number; unfurl: number }
export interface Pose {
  stage: StageId;
  seed: {
    x: number; y: number; z: number; rotZ: number; rotY: number; open: number; shellOpacity: number; coreOpacity: number; coreGlow: number; coreScale: number; visible: boolean;
    /** 0 while the seed floats, 1 once it rests on the ground (blends the floating pose into the planted pose). */
    settle: number;
    /** 0 while planted, 1 once the seed has gone into the ground as the sprout takes over. */
    sink: number;
    /** Small scroll-linked downward drift while floating; fades out as the seed settles. */
    drift: number;
  };
  terrain: { wave: number; mound: number };
  growth: { trunk: number; left: number; right: number };
  /** 0 while the plant is a sprout, 1 when it has resolved into the tree. Blends leaf directions. */
  tree: number;
  leaves: { a: LeafPose; b: LeafPose; c: LeafPose };
  /** Overall inner luminosity of stem and leaves. */
  glow: number;
  /** Ground light under the subject: x position and strength. */
  ground: { x: number; strength: number; spread: number };
}

export function stageAt(p: number): StageId {
  const q = clamp01(p);
  return (stages.find((s) => q < s.to) ?? stages[stages.length - 1]).id;
}

const FLOAT = { x: 0.32, y: 1.72, z: 0, rotZ: -0.62 };
const PLANTED = { x: 0.08, y: 0.66, z: 0, rotZ: -0.86 };
const SUNK = { x: 0.04, y: -0.5, z: 0, rotZ: -0.9 };

export function poseAt(progress: number): Pose {
  const p = clamp01(progress);
  const descend = ease(seg(p, 0.2, 0.4));
  const sink = ease(seg(p, 0.44, 0.7));
  const hover = 0.06 * seg(p, 0, 0.2);           // a slight scroll-linked drift while floating (no idle motion)
  const x = sink > 0 ? mix(PLANTED.x, SUNK.x, sink) : mix(FLOAT.x, PLANTED.x, descend);
  const y = sink > 0 ? mix(PLANTED.y, SUNK.y, sink) : mix(FLOAT.y - hover, PLANTED.y, descend);
  const rotZ = sink > 0 ? mix(PLANTED.rotZ, SUNK.rotZ, sink) : mix(FLOAT.rotZ, PLANTED.rotZ, descend);
  const rotY = 0.95 + 0.3 * seg(p, 0, 0.2) + 0.2 * descend;

  const trunk = SPROUT * ease(seg(p, 0.42, 0.66)) + (1 - SPROUT) * ease(seg(p, 0.7, 0.92));
  return {
    stage: stageAt(p),
    seed: {
      x, y, z: 0, rotZ, rotY,
      open: ease(seg(p, 0.46, 0.64)),
      shellOpacity: 1 - smooth(0.56, 0.68, p),
      coreOpacity: 1 - smooth(0.6, 0.69, p),
      coreGlow: smooth(0.3, 0.46, p) * (1 - smooth(0.6, 0.69, p)),
      coreScale: 1 - 0.45 * smooth(0.5, 0.68, p),
      visible: p < 0.695,
      settle: descend, sink, drift: hover * (1 - descend),
    },
    terrain: {
      wave: smooth(0.16, 0.36, p) * (1 - 0.75 * smooth(0.5, 0.85, p)),
      mound: smooth(0.24, 0.4, p) * (1 - 0.7 * smooth(0.46, 0.75, p)),
    },
    growth: { trunk, left: ease(seg(p, 0.7, 0.94)), right: ease(seg(p, 0.78, 0.97)) },
    tree: ease(seg(p, 0.7, 0.97)),
    leaves: {
      a: { scale: 0.42 * ease(seg(p, 0.52, 0.68)) + 0.33 * ease(seg(p, 0.72, 0.95)), unfurl: ease(seg(p, 0.54, 0.7)) },
      b: { scale: 0.5 * ease(seg(p, 0.48, 0.67)) + 0.5 * ease(seg(p, 0.72, 0.97)), unfurl: ease(seg(p, 0.52, 0.7)) },
      c: { scale: 0.62 * ease(seg(p, 0.8, 1)), unfurl: ease(seg(p, 0.82, 1)) },
    },
    glow: 0.25 + 0.35 * smooth(0.45, 0.65, p) + 0.4 * smooth(0.82, 1, p),
    ground: { x: mix(x, 0, smooth(0.4, 0.6, p)), strength: 0.55 + 0.45 * smooth(0.3, 1, p), spread: mix(0.85, 1.35, smooth(0.6, 1, p)) },
  };
}

/** Terrain height, mirrored exactly by the GLSL in the scene so ground lights sit on the surface. */
export function terrainHeight(x: number, z: number, wave: number, mound: number): number {
  const r = Math.hypot(x - 0.06, z);
  const flat = Math.min(1, Math.max(0, (r - 0.7) / 2.4));
  const w = 0.36 * Math.sin(0.42 * x + 0.3 * z + 0.6) + 0.16 * Math.sin(0.85 * x - 0.55 * z + 1.3) + 0.07 * Math.sin(1.7 * x + 1.2 * z);
  return wave * w * flat * flat * (3 - 2 * flat) + mound * 0.3 * Math.exp(-(r * r) / 0.8);
}

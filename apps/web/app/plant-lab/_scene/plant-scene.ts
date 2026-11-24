// Real-time seed-to-tree scene (three.js) for the Blender asset public/plant/seed-to-tree.glb, which packs the four
// "Seed to Tree" stage models into one file (assets-src/plant/build_seed_to_tree.py): the seed carries a morph target
// from its floating pose to its planted pose, and the sprout carries one to the three-leaf tree.
// Rendering is on demand: a frame is drawn only when scroll progress, pointer springs, size or a tap pulse change, and
// the RAF loop stops as soon as everything has settled (brief: no continuous RAF while the scene is still).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { poseAt, clamp01, SPROUT, type Pose } from '../../../lib/aimp/plant/timeline';

export type Quality = 'high' | 'low';
export type LayoutMode = 'desktop' | 'mobile';

const LAVENDER = new THREE.Color('#a685ff');
const PEACH = new THREE.Color('#ffc9a3');

/** The asset is authored about 3.2 units tall; this brings the tree to the height the page was laid out for. */
const SCALE = 0.85;
/** Seed centre in asset space while floating and once planted (the morph target moves the vertices between them). */
const SEED_FLOAT = new THREE.Vector3(-0.026, 1.585, 0.011);
const SEED_PLANTED = new THREE.Vector3(0.039, 0.906, 0.051);
/** Trunk top in asset space at the sprout and at the tree. */
const TRUNK_TOP_SPROUT = 1.05; const TRUNK_TOP_TREE = 1.48;
/** Height of the planted seed in asset space: how far it travels to go fully into the ground. */
const SEED_HEIGHT = 1.68;
/** The seed is drawn slightly smaller than authored so it sits beside the hero copy rather than against it. */
const SEED_SIZE = 0.92;
/** Timeline x of the planted seed; anything beyond it is the floating seed's sideways offset. */
const SEED_REST_X = 0.08;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

class Spring {
  value = 0; velocity = 0; target = 0;
  constructor(private stiffness = 120, private damping = 18) {}
  step(dt: number) {
    const a = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
    this.velocity += a * dt; this.value += this.velocity * dt;
    if (Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-4) { this.value = this.target; this.velocity = 0; return false; }
    return true;
  }
}

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Per-part shader inputs: a growth front that reveals the part from the ground up, inner glow and the tap pulse. Nothing is drawn below ground level. */
interface PartUniforms { uReveal: { value: number }; uFront: { value: number }; uGlow: { value: number }; uPale: { value: number }; uPulseY: { value: number }; uPulse: { value: number } }
const partUniforms = (glow: number, pale: number): PartUniforms => ({ uReveal: { value: 1e3 }, uFront: { value: 0 }, uGlow: { value: glow }, uPale: { value: pale }, uPulseY: { value: -10 }, uPulse: { value: 0 } });

/**
 * Adds the shared behaviour to a stock material. The asset's vertex colours (its "Tint" attribute) tint the surface
 * and its inner glow. 'lit' is for glass and porcelain; 'line' is for the unlit luminous seams, lips and veins.
 */
function patch<M extends THREE.Material>(mat: M, u: PartUniforms, kind: 'lit' | 'line'): M {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvH = (modelMatrix * vec4(transformed, 1.0)).y;');
    const light = 'float front = uFront * exp(-pow((uReveal - vH) * 6.0, 2.0));\nfloat band = uPulse * exp(-pow((uPulseY - vH) * 4.0, 2.0));';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal; uniform float uFront; uniform float uGlow; uniform float uPale; uniform float uPulseY; uniform float uPulse;\nvarying float vH;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vH > uReveal || vH < 0.0) discard;');
    shader.fragmentShader = kind === 'lit'
      ? shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 tint = diffuseColor.rgb;\ndiffuseColor.rgb = mix(tint, vec3(1.0), uPale);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${light}\ntotalEmissiveRadiance += tint * uGlow + vec3(1.0, 0.8, 0.66) * (0.9 * front + 0.6 * band);`)
      : shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>\n${light}\ndiffuseColor.rgb = diffuseColor.rgb * uGlow + vec3(1.0, 0.85, 0.72) * (0.5 * front + 0.5 * band);`);
  };
  return mat;
}

interface Leaf { group: THREE.Group; meshes: THREE.Mesh[]; pivot: THREE.Vector3; pivotTree: THREE.Vector3; fold: number }

export class PlantScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private rig = new THREE.Group();        // pointer tilt only, around the plant's base
  private plant = new THREE.Group();      // asset space: trunk base at the origin
  private seed = new THREE.Group();
  private seedMeshes: THREE.Mesh[] = [];
  private shellMat?: THREE.MeshPhysicalMaterial; private bodyMat?: THREE.MeshPhysicalMaterial; private seamMat?: THREE.MeshBasicMaterial;
  private stem: THREE.Mesh[] = [];        // trunk and its spiral filaments (sprout pose, morph target = tree pose)
  private roots?: THREE.Group;
  private leaves: Leaf[] = [];            // a = left, b = the sprout's right leaf that becomes the crown, c = the tree's third leaf
  private seedU = partUniforms(0.22, 0.12);
  private stemU = partUniforms(0.3, 0.3);
  private leafU = partUniforms(0.3, 0.3);
  private seedLineU = partUniforms(1, 0); private stemLineU = partUniforms(1, 0); private leafLineU = partUniforms(1, 0);
  private terrainUniforms = { uWave: { value: 0 }, uShow: { value: 0 } };
  private groundGlow: THREE.Mesh; private seedGlow: THREE.Mesh; private terrain: THREE.Mesh;
  private progress = 0;          // what is drawn
  private target = 0;            // where the scroll position is
  private tiltX = new Spring(60, 14); private tiltY = new Spring(60, 14); private pulse = new Spring(40, 7);
  private raf = 0; private last = 0; private dirty = true; private visible = true; private disposed = false;
  private mode: LayoutMode = 'desktop';
  private width = 1; private height = 1;
  // Adaptive resolution: if frames run slow while scrolling, step the pixel ratio down (never up mid-session).
  private resScale = 1; private slowFrames = 0; private lastRender = 0;
  // scratch objects for the per-frame transforms
  private m1 = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3();
  readonly quality: Quality;

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.transmissionResolutionScale = 0.35;   // the glass refraction pass is the most expensive part; low-res is invisible here
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    // No fog or backdrop: the canvas is transparent and the object sits directly on the page background.

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcbb8ff, 0.55));
    const key = new THREE.DirectionalLight(0xfffaf5, 2.6); key.position.set(-6, 3.2, 4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8c8ff, 0.7); fill.position.set(5, 1, 4); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9c2, 1.4); rim.position.set(3, 4, -5); this.scene.add(rim);

    this.camera.position.set(0, 1.5, 7);
    this.camera.lookAt(0, 1.35, 0);
    this.scene.add(this.rig);
    this.plant.scale.setScalar(SCALE);
    this.rig.add(this.plant);
    this.seed.matrixAutoUpdate = false;
    this.plant.add(this.seed);
    this.terrain = this.makeTerrain();
    this.scene.add(this.terrain);

    const tex = radialTexture();
    const glowMat = (color: THREE.Color, opacity: number) => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.NormalBlending, fog: false });
    this.groundGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glowMat(LAVENDER, 0.55));
    this.seedGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glowMat(PEACH, 0.5));
    this.groundGlow.renderOrder = 1; this.seedGlow.renderOrder = 2;
    this.scene.add(this.groundGlow, this.seedGlow);
  }

  async load(url = '/plant/seed-to-tree.glb'): Promise<void> {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    if (this.disposed) return;
    const high = this.quality === 'high';
    const byName = (n: string) => {
      const m = gltf.scene.getObjectByName(n) as THREE.Mesh | undefined;
      if (!m?.isMesh) throw new Error(`seed-to-tree.glb: missing ${n}`);
      m.frustumCulled = false;   // morphing and growing parts outgrow their authored bounds
      return m;
    };
    // Each part sits in a holder group so its own node transform (glTF quantisation scale/offset) is preserved.
    const hold = (parent: THREE.Object3D, ...meshes: THREE.Mesh[]) => { const g = new THREE.Group(); g.add(...meshes); parent.add(g); return g; };

    // Opalescent glass. Low quality (touch fallback / WebGL1): no transmission pass; a glossy iridescent solid reads the same.
    const glass = (u: PartUniforms, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => patch(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.16, metalness: 0, ior: 1.45, iridescence: 0.7, iridescenceIOR: 1.3, iridescenceThicknessRange: [220, 620],
      clearcoat: 1, clearcoatRoughness: 0.08, specularIntensity: 1, side: THREE.DoubleSide,
      ...(high ? { transmission: 0.55, thickness: 0.3, attenuationColor: new THREE.Color('#b9a3ff'), attenuationDistance: 0.8 } : { roughness: 0.2, sheen: 0.8, sheenColor: new THREE.Color('#ffd7c4') }),
      ...extra,
    }), u, 'lit');
    const lines = (u: PartUniforms, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) => patch(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, ...extra }), u, 'line');

    // seed: pearl porcelain shells around an opalescent body, with luminous seams
    this.shellMat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.25,
      sheen: 0.6, sheenColor: new THREE.Color('#e4d8ff'), sheenRoughness: 0.5, side: THREE.DoubleSide, transparent: true }), partUniforms(0.06, 0), 'lit');
    this.bodyMat = patch(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, iridescence: 0.8, iridescenceIOR: 1.3, iridescenceThicknessRange: [220, 620],
      clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5, sheenColor: new THREE.Color('#ffd7c4'), side: THREE.DoubleSide, transparent: true }), this.seedU, 'lit');
    this.seamMat = lines(this.seedLineU, { transparent: true });
    const body = byName('Seed_Body'), seams = byName('Seed_Lines'), shell = byName('Seed_Shell');
    body.material = this.bodyMat; seams.material = this.seamMat; shell.material = this.shellMat;
    body.renderOrder = 3; seams.renderOrder = 4; shell.renderOrder = 5;     // fixed order so the fade-out never flickers
    this.seedMeshes = [body, seams, shell];
    hold(this.seed, body, seams, shell);

    // plant: glass trunk, roots and leaves, with warm filaments, lips and veins
    const trunk = byName('Trunk'), filaments = byName('Filaments'), roots = byName('Roots');
    const stemGlass = glass(this.stemU);
    trunk.material = stemGlass; roots.material = stemGlass; filaments.material = lines(this.stemLineU);
    this.stem = [trunk, filaments];
    hold(this.plant, trunk, filaments);
    this.roots = hold(this.plant, roots);
    const leafGlass = glass(this.leafU), leafLines = lines(this.leafLineU);
    const vec = (a: unknown) => new THREE.Vector3(...(a as [number, number, number]));
    for (const [id, fold] of [['A', -1], ['B', 1], ['C', 1]] as const) {
      const blade = byName(`Leaf_${id}_Body`), detail = byName(`Leaf_${id}_Lines`);
      blade.material = leafGlass; detail.material = leafLines;
      const group = hold(this.plant, blade, detail);
      group.visible = false;
      this.leaves.push({ group, meshes: [blade, detail], pivot: vec(blade.userData.pivot), pivotTree: vec(blade.userData.pivotTree), fold });
    }
    await this.warmUp();
    this.dirty = true; this.kick();
  }

  /**
   * Compile every shader up front (seed, leaves, stem, ground and the glass transmission pass), so nothing stalls the
   * first time the plant appears mid-scroll. Without this the first sprout frame took ~600 ms on an M1.
   */
  private async warmUp() {
    this.applyPose(poseAt(0.9));
    for (const l of this.leaves) l.group.visible = true;
    this.seed.visible = true; this.terrain.visible = true;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);   // also allocates the transmission render target
  }

  private makeTerrain(): THREE.Mesh {
    const seg = this.quality === 'high' ? 110 : 80;
    const geo = new THREE.PlaneGeometry(9, 9, seg, seg).rotateX(-Math.PI / 2);   // only the soft island is ever visible
    // No depth write: the ground lights lie on this surface and must never be cut off by a dune. What goes below ground
    // (the sinking seed, the foot of the trunk) is clipped in the part shaders instead.
    const mat = new THREE.MeshStandardMaterial({ color: '#fbf9ff', roughness: 0.92, metalness: 0, transparent: true, depthWrite: false });
    const u = this.terrainUniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      // Level where the plant stands (the asset's seed and roots rest on flat ground), soft dunes further out.
      const fn = `uniform float uWave; uniform float uShow;
      float terrainH(vec2 p) {
        float r = length(p - vec2(0.06, 0.0));
        float f = clamp((r - 0.7) / 2.4, 0.0, 1.0); f = f * f * (3.0 - 2.0 * f);
        float w = 0.36 * sin(0.42 * p.x + 0.3 * p.y + 0.6) + 0.16 * sin(0.85 * p.x - 0.55 * p.y + 1.3) + 0.07 * sin(1.7 * p.x + 1.2 * p.y);
        return uWave * w * f;
      }`;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${fn}`)
        .replace('#include <beginnormal_vertex>', `vec2 tp = position.xz; float e = 0.04;
          float hx = terrainH(tp + vec2(e, 0.0)) - terrainH(tp - vec2(e, 0.0));
          float hz = terrainH(tp + vec2(0.0, e)) - terrainH(tp - vec2(0.0, e));
          vec3 objectNormal = normalize(vec3(-hx, 2.0 * e, -hz));
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += terrainH(position.xz);\nvSlope = objectNormal.y;\nvXZ = position.xz;');
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSlope;\nvarying vec2 vXZ;');
      // Soft lavender shading in the dune troughs and slopes, as in the reference landscape.
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uShow;\nvarying float vSlope;\nvarying vec2 vXZ;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.8, 0.76, 0.95), vec3(1.0), smoothstep(0.93, 1.0, vSlope));\n// The landscape is a soft island that fades to fully transparent: no horizon, no backdrop box.\ndiffuseColor.a *= uShow * (1.0 - smoothstep(0.9, 3.4, length(vXZ - vec2(0.06, 0.0))));');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Scroll progress 0..1. Deterministic: the frame depends on p (and pointer springs) only. */
  // Mouse wheels move in coarse steps; the drawn progress glides to the scroll position in ~150 ms and then stops
  // exactly on it, so the final state is still a pure function of scroll and nothing moves once scrolling ends.
  setProgress(p: number) { if (p !== this.target) { this.target = p; this.kick(); } }

  /** Pointer in -1..1 (desktop only). Springs ease toward it, then rendering stops. */
  setPointer(x: number, y: number) { this.tiltX.target = x; this.tiltY.target = y; this.kick(); }

  /** Tap or click on the plant: a light pulse travels up the stem and the leaves lift slightly. */
  tap() { this.pulse.value = 0; this.pulse.velocity = 2.2; this.pulse.target = 0; this.kick(); }

  setVisible(v: boolean) { this.visible = v; if (v) { this.dirty = true; this.kick(); } }

  resize(width: number, height: number, mode: LayoutMode) {
    this.width = Math.max(1, width); this.height = Math.max(1, height); this.mode = mode;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * this.resScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    // Keep the whole tree (about 2.7 units wide) in frame on narrow screens by widening the vertical field of view.
    const dist = mode === 'mobile' ? 7.8 : 7;          // a little further back on phones so the whole tree clears the header
    this.camera.position.set(0, 1.5, dist); this.camera.lookAt(0, 1.35, 0);
    const halfW = mode === 'mobile' ? 1.75 : 2.4;
    const needV = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect) * 180 / Math.PI;
    this.camera.fov = Math.max(30, needV);
    // Shift the subject without moving the camera: right of the copy on desktop, above the copy on mobile.
    const w = this.width, h = this.height;
    if (mode === 'desktop') this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.18, w, h);
    this.camera.updateProjectionMatrix();
    this.dirty = true; this.kick();
  }

  private applyPose(pose: Pose) {
    const pulse = Math.max(0, this.pulse.value);
    const pulseY = (1 - Math.min(1, pulse)) * 3.1, pulseOn = pulse > 0.001 ? Math.min(1, pulse * 3) : 0;

    // seed: floats, settles onto the ground (morph target), then goes down into it while the sprout breaks out of it
    const s = pose.seed;
    const down = smooth(0, 0.62, s.sink);
    this.seed.visible = s.visible && down < 1 && this.seedMeshes.length > 0;
    if (this.seed.visible) {
      for (const m of this.seedMeshes) m.morphTargetInfluences![0] = s.settle;
      const c = this.v1.lerpVectors(SEED_FLOAT, SEED_PLANTED, s.settle);
      const yaw = (s.rotY - 0.95 - 0.2 * s.settle) * (1 - s.settle);       // a slow scroll-linked turn while it floats; none once planted
      const size = SEED_SIZE * mix(1, 0.72, down);
      const aside = Math.max(0, s.x - SEED_REST_X);                       // floats a little to the right, clear of the copy; drifts in as it lands
      // down by drift and sink · shrink toward the spot it stands on · turn about its own vertical axis
      this.seed.matrix.makeTranslation(c.x + aside, -s.drift - SEED_HEIGHT * down, c.z)
        .multiply(this.m1.makeScale(size, size, size))
        .multiply(this.m1.makeTranslation(0, c.y, 0))
        .multiply(this.m1.makeRotationY(yaw))
        .multiply(this.m2.makeTranslation(-c.x, -c.y, -c.z));
      const opacity = 1 - smooth(0.7, 1, down);
      this.shellMat!.opacity = opacity; this.shellMat!.depthWrite = opacity > 0.98;
      this.bodyMat!.opacity = opacity; this.seamMat!.opacity = opacity;
      this.seedU.uGlow.value = 0.22 + 0.4 * s.coreGlow;
      this.seedLineU.uGlow.value = 0.85 + 0.15 * s.coreGlow;
    }

    // terrain: level where the plant stands, dunes further out
    this.terrainUniforms.uWave.value = pose.terrain.wave;
    this.terrainUniforms.uShow.value = Math.min(1, pose.terrain.wave * 1.6 + pose.terrain.mound * 1.2);
    this.terrain.visible = this.terrainUniforms.uShow.value > 0.002;   // no ground pass while the seed floats

    // sprout: trunk and filaments are revealed from the ground up, the roots spread, then everything morphs into the tree
    const rise = clamp01(pose.growth.trunk / SPROUT);
    const tree = pose.tree;
    const revealY = rise * (mix(TRUNK_TOP_SPROUT, TRUNK_TOP_TREE, tree) + 0.1);       // asset space
    const glow = 0.16 + 0.3 * pose.glow;
    for (const m of this.stem) { m.visible = rise > 0; m.morphTargetInfluences![0] = tree; }
    for (const u of [this.stemU, this.stemLineU]) {
      u.uReveal.value = rise >= 1 ? 1e3 : revealY * SCALE;
      u.uFront.value = rise > 0 ? 1 - smooth(0.88, 1, rise) : 0;                         // light rides the growing tip
    }
    for (const u of [this.stemU, this.leafU, this.stemLineU, this.leafLineU]) { u.uPulseY.value = pulseY; u.uPulse.value = pulseOn; }
    this.stemU.uGlow.value = glow; this.leafU.uGlow.value = glow;
    this.stemLineU.uGlow.value = this.leafLineU.uGlow.value = 0.8 + 0.2 * pose.glow;
    if (this.roots) { this.roots.visible = rise > 0; this.roots.scale.setScalar(Math.max(0.001, smooth(0, 0.45, rise))); }

    // leaves grow out of the point where their branch leaves the trunk, unfolding as they come
    const lift = 1 + 0.05 * pulse;                                                       // tap: leaves lift a touch, then settle
    const grown = [clamp01(pose.leaves.a.scale / 0.42), clamp01(pose.leaves.b.scale / 0.5), clamp01(pose.leaves.c.scale / 0.62)];
    this.leaves.forEach((leaf, i) => {
      const pivot = this.v1.lerpVectors(leaf.pivot, leaf.pivotTree, tree);
      const reached = rise >= 1 ? 1 : smooth(pivot.y - 0.02, pivot.y + 0.14, revealY);   // not before the trunk gets there
      const k = grown[i] * reached;
      leaf.group.visible = k > 0.002;
      if (!leaf.group.visible) return;
      for (const m of leaf.meshes) if (m.morphTargetInfluences) m.morphTargetInfluences[0] = tree;
      const size = k * lift;
      leaf.group.scale.setScalar(size);
      leaf.group.rotation.set(0, 0, leaf.fold * 0.7 * (1 - k) * (1 - k));
      // keep the pivot fixed: position = pivot - R·S·pivot
      leaf.group.position.copy(pivot).sub(this.v2.copy(pivot).multiplyScalar(size).applyEuler(leaf.group.rotation));
    });

    // ground lights sit on the level ground under the subject
    this.groundGlow.position.set(0, 0.01, 0);
    this.groundGlow.scale.set(4.6 * pose.ground.spread, 1, 1.5 * pose.ground.spread);
    (this.groundGlow.material as THREE.MeshBasicMaterial).opacity = 0.75 * pose.ground.strength;
    this.seedGlow.position.set(0, 0.015, 0);
    this.seedGlow.scale.set(1.9 * pose.ground.spread, 1, 0.7 * pose.ground.spread);
    (this.seedGlow.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * pose.glow;
    // pointer tilt around the plant's base
    this.rig.rotation.set(this.tiltY.value * 0.05, this.tiltX.value * 0.22, 0);
  }

  private kick() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    let moving = false;
    for (const sp of [this.tiltX, this.tiltY, this.pulse]) moving = sp.step(dt) || moving;
    if (this.progress !== this.target) {
      const d = this.target - this.progress;
      // big jumps (fast flick, anchor link) still arrive quickly: the glide is a fraction of the distance per frame
      this.progress = Math.abs(d) < 0.0005 ? this.target : this.progress + d * (1 - Math.exp(-dt / 0.06));
      this.dirty = true; moving = moving || this.progress !== this.target;
    }
    if ((this.dirty || moving) && this.visible) {
      this.applyPose(poseAt(this.progress));
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      const gap = now - this.lastRender; this.lastRender = now;
      if (gap > 0 && gap < 120) {                       // only judge consecutive frames, not the first after a pause
        this.slowFrames = gap > 20 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
        if (this.slowFrames > 12 && this.resScale > 0.55) {
          this.resScale = Math.max(0.55, this.resScale - 0.15); this.slowFrames = 0;
          this.resize(this.width, this.height, this.mode);
        }
      }
    }
    if (moving) this.kick();
  };

  /** Render one frame synchronously at progress p (used for static stills and tests). */
  renderStill(p: number) { this.progress = p; this.target = p; this.applyPose(poseAt(p)); this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { Object.values(x).forEach((v) => { if (v instanceof THREE.Texture) v.dispose(); }); x.dispose(); });
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

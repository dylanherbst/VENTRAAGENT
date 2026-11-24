# VENTRA — Scroll-Driven Seed-to-Tree Website

**Destination:** aiventra.com.au
**Goal:** Create an Apple-calibre, minimalist website experience in which a floating white glass seed lands in a white field, grows into a tiny lavender sprout and becomes an elegant three-leaf luminous tree. The animation is controlled by scroll position, reverses when scrolling back, and stays in its exact state when scrolling stops.

## Reference files (in this package)

1. `references/01_seed_floating.jpg` — the seed floats, camera right, negative space left.
2. `references/02_seed_planted.jpg` — same seed planted in flowing white landscape.
3. `references/03_small_sprout.jpg` — small thin stem and two lavender/peach glass leaves.
4. `references/04_luminous_tree.jpg` — mature sculptural tree with three leaves.

**Strict visual requirements:** reproduce the composition and visual language of the references, but use one coherent camera, scale, geometry, light direction, white/lavender environment, soft reflections, subtle purple-to-peach internal glow, no excessive neon or particles. The final tree should remain elegant and recognisably match the three-leaf reference, not turn into a generic bush or botanical tree.

## Before doing anything

- Audit the *existing* VENTRA website codebase, website worktree and running local preview. Report framework, routes, dependencies and existing auth/CTA/demos. Reuse the current stack; do not create a parallel production site.
- Keep changes isolated in the dedicated VENTRA website branch/worktree. Do not change VENTRA app, backend, AI Setter/Receptionist, payment logic or production.
- Build an isolated `/plant-lab` route and share a local browser preview for approval. Do not push or deploy without approval.

## Preferred production workflow: two phases

**Phase 1: high-fidelity rendered image-sequence animation (fastest reliable match to visual references)**
- Recreate a unified continuous scene in Blender: white seed with layered shell and iridescent translucent interior, flowing white terrain, growing stem, petals/leaves, and final sculptural tree.
- Model animation on a *single timeline* with precise transition timing, maintaining identical fixed camera and light setup. Use shape keys, growth curves, scaling, rigging or geometry nodes as appropriate.
- Render ~120–180 sequential intermediate frames as compressed WebP/AVIF for desktop and a separate mobile composition; do not simply crossfade the four JPG references as the final effect. Start with lower-resolution proof before full rendering. Choose frame count and budget based on measured performance.
- Display frames with a performant HTML Canvas image-sequence player in a pinned/sticky section, bound to scroll through GSAP ScrollTrigger or native position mapping. Preload current/nearby frames progressively, show a quick first frame, avoid huge eager memory use and decode costs, preserve aspect ratio and avoid blank frames.

**Phase 2: true interactive 3D (after visual approval)**
- Export optimized `.glb` geometry from Blender, plus editable `.blend` file and source scripts.
- Load in Three.js / React Three Fiber and animate shell position/rotation, burial, stem extension, curved leaf meshes, growth targets, changing transmissive materials, limited purple-peach lighting, and small responsive tilt. Avoid camera movement that breaks correspondence to the art references.
- Drive all geometry/material changes from a single normalized progress scalar `p ∈ [0,1]`; the update function must be deterministic and reversible and not depend on accumulating elapsed time.
- Use quality/performance fallbacks on mobile; compare side by side with the approved rendered sequence before replacing it.

## The four animation stages

**0–20%: POTENTIAL** — floating white seed, same shape as first reference; faint lavender visible inside but no strong glow. Short headline: 'Every big thing starts small.'

**20–40%: FOUNDATION** — seed descends, rotates slightly to a natural planting angle and enters a softly rippling white landscape. The terrain gently rises at the point of contact. Headline: 'Plant the idea.'

**40–70%: CREATION** — same seed splits/submerges, translucent stem grows smoothly upward, two unfurling leaf meshes emerge, peach/lavender internal light travels along the stem. Headline: 'Turn potential into possibility.'

**70–100%: GROWTH** — stem thickens/extends, a third leaf unfolds; leaves become taller, broader and gently luminous, resolving into the final uploaded tree reference. Do NOT add a forest, extra leaves, distracting orbiting spheres, or a shower of particles. Headline: 'Grow beyond what you imagined.'

All four stages must be continuous—not abrupt cuts. There must be smooth matching geometry/camera/lighting at intermediate values; seek to any progress immediately.

## Website design and conversion

- Maintain white/high-key background with controlled lavender, pearl and peach accents; exceptionally clean typography.
- Desktop: content and CTA on left, sculpture on right, generous negative space. On mobile, use a separate composition and stack concise text with the central animation; protect legibility.
- One pinned animation story section (about 300–400vh of scroll distance, tune by feel), followed by the existing three VENTRA paths, real demo(s), clear offer/pricing, and final CTA. Preserve working navigation, auth and conversions; do not invent working capabilities.
- Avoid aggressive scroll-jacking, mandatory autoplay, confusing gestures or unnecessary flashy effects. Hide UI chrome from the render itself; real headings/buttons must be semantic HTML overlays.

## Scroll contract

- Scroll downward advances the timeline continuously.
- Scroll upward reverses it, including returning the tree all the way to the floating seed.
- If scroll position stops changing, the animation stays at precisely that state (disable idle movement in the story scene).
- Fast flicks should seek to the right stage without stutter or broken animation.
- No snapping between four reference keyframes.
- Subtle cursor/gyro tilt is optional and must not interfere with the scroll progress or impair touch UX.
- When `prefers-reduced-motion: reduce` is active, show an accessible static representative frame or simple static stage sections instead of pinned motion.
- Include a visible scroll cue, stage captions only where useful, keyboard/tab navigation and a working Skip Animation/Skip to Content path.

## Quality and engineering

- Do not run expensive WebGL effects or continuous RAF when scene is still. Implement disposal and resize cleanup. Progressive media loading and persistent final visuals.
- Use semantic markup and make sure hero copy and CTAs render even if JavaScript or WebGL fails.
- Aim for visually fluid desktop and practical mobile performance; measure memory/network, Lighthouse/Core Web Vitals and actual iPhone Safari behaviour, not only desktop Chrome.
- Responsive checks: 320/375/390/430px mobiles, 768 tablet, 1280/1440 desktop; verify no crop of seed/tree, blocked CTA, or horizontal overflow.
- Verify every 0%, 20%, 40%, 55%, 70%, 85%, 100% scroll checkpoint, and scroll all the way back. Screenshot intermediate points.
- Run project lint, typecheck, tests and build; preserve any existing test suite.

## Expected work and deliverables

1. Audit of existing VENTRA website worktree, routes and dependencies, with plan before modifications.
2. Design breakdown of the uploaded references; camera/lighting/layout decisions and proposed asset pipeline.
3. `plant-lab` desktop/mobile working preview with a functioning scroll-to-progress timeline.
4. First playable seed→plant image-sequence proof (not four-image crossfade), plus render proof and size/performance report.
5. Editable Blender model/timeline, source scripts, and production assets, or explicit blocker if tooling/assets unavailable.
6. Integration into existing homepage only after preview approval; maintain working site paths.
7. Functional/mobile/accessibility/performance evidence with screenshot or short screen recording and a remaining-work checklist.

**Do not stop after a plan or static mockup. Create the local playable prototype. Only ask for action when an essential external credential/approval or actual access blocker prevents progress.**

## Relevant implementation docs

- https://gsap.com/docs/v3/Plugins/ScrollTrigger/
- https://r3f.docs.pmnd.rs/advanced/scaling-performance
- https://threejs.org/docs/pages/GLTFLoader.html
- https://motion.edokstudio.com/guides/canvas-image-sequence-nextjs

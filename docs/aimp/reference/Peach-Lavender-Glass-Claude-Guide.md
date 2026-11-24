# AI MONEY PRINTER Glass UI Library — implementation guide for Claude

Owner-supplied guide (14 Nov 2026), saved as given. Companion visual source of truth:
`Peach-Lavender-Glass-UI-Library.pdf` in this folder (page 1 = approved three-screen mockup, page 2 = crops of it).

**Use the Ventra Glass Effect we made recently.**
The Plant Doctor screen names in the PDF are sample content. Use the target app's brand, copy, icons and real auth
options while keeping the reference composition, material, proportions and interaction hierarchy.

## Prompt

> Build a reusable UI library from the attached Peach & Lavender Glass visual guide. Match the three approved mobile
> screens first. Recreate the same broad, soft waves across each screen, with a pearl-white base and pale
> lilac/periwinkle folds. Keep the open areas on the first two screens free of imagery. Use translucent cards and
> controls, continuous thin white rims and glossy dimensional icons. The only strong colour treatment is the
> peach-to-purple gradient on the selected feature tile and the small matching icons. Keep the main call-to-action a
> milky-white pill with dark plum text.
>
> Inspect the existing theme, primitives, responsive shell and auth routes before editing. Reuse accessible
> primitives and expose the appearance through a single set of shared tokens and variants. Create a component
> showcase using the app's preview route or story system. Include the three reference compositions, every component
> variant below and its relevant states. Apply the library to the existing onboarding or welcome route named in the
> task while preserving working logic.
>
> Compare the showcase with the PDF at a phone width before rolling the style out. Follow the acceptance checks, then
> return the preview route, the shared components you changed and the comparison screenshots.

## 1. Visual rules

- **Canvas:** Pearl white and silver-lavender are the dominant values. Sweep two or three broad, soft, curved bands
  diagonally across the screen. Keep a faint blush reflection in a fold and cool periwinkle in the shadows. The wave
  should read as one flowing backdrop through the glass.
- **Glass:** Use a translucent white fill, a fine pale rim, a bright top/left edge and a restrained violet shadow.
  Quiet cards and inputs sit close to the backdrop. The background should remain visible through them.
- **Accents:** The selected tile carries a warm peach highlight in the upper left, a dusty rose-lilac transition, and
  muted purple in the lower right. Repeat the same colour direction on dimensional feature icons. Keep regular
  labels, compact control icons and navigation restrained.
- **Hierarchy:** The primary action is a pearl pill with dark plum text. The selected feature tile uses the coloured
  gradient. Keep the two roles visually distinct.
- **Composition:** Rounded phone rims in the mockup are part of the presentation frame. Use the app's native safe
  areas and device chrome in production. The mockup's open upper areas are intentional. Preserve the generous spacing
  with layout, leaving room for content to grow on small screens and when the keyboard opens.

## 2. Design tokens

Proposed starting values matched by eye to the reference. Compare them against the screenshot after compositing the
surfaces.

| Role | Value |
| --- | --- |
| Pearl canvas / bright rim | `#F9F8FF` / `#FFFFFF` |
| Silver-lilac fold / periwinkle trough | `#E8E3F6` / `#C2C2E4` |
| Soft blush reflection | `#F3DFF1` |
| Highlight peach / rose-lilac / purple | `#F2B9AD` / `#C98DCB` / `#9B6CC5` |
| Primary action ink / accessible body ink | `#241340` / `#3F365A` |
| Keyboard focus | `#5B3594` |
| Quiet glass fill | White at 9–22% opacity |
| Quiet glass outline | White at 35–65% opacity, 1 px |
| Quiet glass blur | 12–16 px, 115% saturation |
| Card shadow | `0 8px 24px rgba(52,35,90,.10)` |
| Spacing scale | 4, 8, 12, 16, 20, 24, 32, 40, 48 px |
| Radius | 18–22 px cards, 999 px buttons and fields |
| Type | Existing rounded sans-serif or Inter. 28–34 px heading, 15–16 px body, 13–14 px compact labels |
| Touch targets | 44 × 44 px minimum. Main action 48–52 px tall. |

The screenshot uses white text on pale glass. Check contrast on the final composited screen. Where white labels fall
below 4.5:1 for normal text or 3:1 for large text, use the plum text token or deepen the immediate backing behind the
label. Check visible control boundaries, selected indicators and focus outlines at 3:1 where required. Keep the peach
sheen on the rim of the selected tile if the label needs a deeper backing.

## 3. Shared components

| Component | Appearance | Behaviour and states |
| --- | --- | --- |
| `WaveBackdrop` | Full-bleed pearl canvas with continuous diagonal folds. One backdrop per view, visible behind every glass layer. | Static by default. Scale the wave composition with the viewport and keep it out of the accessibility tree. |
| `GlassSurface` | Shared translucent fill, thin light rim and optional blur. Use the same material for rows and standard cards. | Use a solid light-lilac fallback where backdrop blur is unsupported. Limit layered filters on mobile. |
| `GlassButton` | **Primary:** milky-white pill with plum label, optional leading sparkle. **Secondary/provider:** clear pill, fine rim, optional leading provider mark. **Compact:** circular back button or small Skip pill. | Native button or link as appropriate. Include hover on pointer devices, pressed, focus, loading and disabled. Keep the width stable during loading and preserve a 44 px target for compact controls. |
| `GlassField` | Thin glass pill, leading 18–20 px icon, visually quiet interior. | Show an accessible label, error message and visible focus. Preserve autocomplete, password manager and keyboard behaviour. Set `aria-invalid` and link errors with `aria-describedby`. |
| `FeatureTile` | Quiet tile: pale glass. Selected tile: peach upper-left edge, rose-lilac middle, purple lower-right, soft halo. Title and supporting line above a dimensional icon. | For a genuine choice, use a labelled radio group or equivalent native selection. For a fixed marketing highlight, use a static card. Use a check or other cue alongside colour for interactive selection. |
| `FeatureRow` | Wide translucent card, two lines of copy left, glossy icon right. | Use a static card for informational content and a semantic link for navigation. Let content wrap and the row grow. |
| `GlassIcon` | Compact controls use a simple line icon. Feature icons use peach reflections, lilac shading and a soft shadow. | Reuse the existing icon family for controls. Provide accessible names for icon-only actions and hide decorative icons. Keep provider marks in their brand colours. |
| `OnboardingHeader` | Round glass back action, three dots on a thin centre track, small Skip pill. | Give Back and Skip accessible names. Expose the progress as "Step 2 of 3" and mark the current step. Use buttons for steps only if jumping is supported. |
| `AuthDivider` | Short centred copy between two fine horizontal rules. | Use text when the label gives context. Hide decorative rules from assistive technology. |
| `OnboardingLayout` | Welcome CTA group or bottom-anchored primary action. Same background, side gutters and safe-area spacing on all three screens. | Use a scrollable layout on short displays. Keep focused fields and actions reachable with the keyboard open. |

## 4. Reference compositions

| Screen | Top to bottom | Details to match |
| --- | --- | --- |
| Welcome | Open wave area, centred heading and intro, primary phone CTA, secondary Apple CTA, legal copy. | Keep the copy and actions in the lower portion. Preserve the white primary pill and the clear provider pill. |
| Create account | Back / progress / Skip, open wave area, left-aligned title and intro, three input pills, primary CTA, divider and provider actions. | Align the fields and main CTA to one gutter. Keep provider buttons side by side where labels fit, then stack them on narrow layouts. |
| Feature overview | Back / Skip, left-aligned title and intro, three compact feature tiles, two wide feature rows, bottom primary CTA. | Use a single coloured tile, with the other two quiet. Show three tiles at normal phone widths where text fits. Reflow to two or one column as needed and keep visual and reading order aligned. |

On phones, start with 20–24 px side gutters and 8–12 px between adjacent glass controls. At tablet and desktop sizes,
let the waves extend across the viewport and centre the onboarding content in a roughly 400–460 px column. The
showcase can arrange the three screens side by side for comparison.

## 5. CSS starting point

The background gradients are an editable approximation of the image. Tune their scale, angle and stops against the
approved mockup. Keep the backdrop independent of the card styles.

```css
:root {
  --pearl: #f9f8ff;
  --fold: #e8e3f6;
  --trough: #c2c2e4;
  --blush: #f3dff1;
  --peach: #f2b9ad;
  --rose-lilac: #c98dcb;
  --violet: #9b6cc5;
  --plum: #241340;
  --text: #3f365a;
  --focus: #5b3594;
  --glass-edge: rgb(255 255 255 / .52);
  --glass-fill: linear-gradient(145deg, rgb(255 255 255 / .22), rgb(255 255 255 / .09));
  --glass-shadow: 0 8px 24px rgb(52 35 90 / .10), inset 0 1px 0 rgb(255 255 255 / .50);
  --glass-radius: 20px;
  --pill-radius: 999px;
  --highlight-fill: linear-gradient(142deg, var(--peach) 0%, var(--rose-lilac) 37%, var(--violet) 80%);
}

.wave-backdrop {
  position: relative;
  isolation: isolate;
  overflow: clip;
  min-block-size: 100svh;
  color: var(--text);
  background: var(--pearl);
}

.wave-backdrop::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -10%;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 7% 83%, rgb(243 223 241 / .82), transparent 41%),
    radial-gradient(ellipse 96% 54% at 73% 116%,
      var(--fold) 44%, rgb(194 194 228 / .80) 65%,
      rgb(243 223 241 / .72) 76%, transparent 86%),
    radial-gradient(ellipse 93% 55% at 24% -12%,
      var(--pearl) 42%, var(--fold) 59%,
      rgb(194 194 228 / .78) 73%, transparent 86%),
    linear-gradient(151deg, var(--pearl), #efecfa 34%, #e2ddf4 63%, var(--pearl));
  transform: rotate(-9deg) scale(1.12);
  filter: blur(6px);
}

.glass-surface {
  border: 1px solid var(--glass-edge);
  border-radius: var(--glass-radius);
  background: #efebf9;
  box-shadow: var(--glass-shadow);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-surface {
    background: var(--glass-fill);
  }
  .glass-surface[data-frosted="true"] {
    -webkit-backdrop-filter: blur(14px) saturate(115%);
    backdrop-filter: blur(14px) saturate(115%);
  }
}

.glass-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-block-size: 44px;
  min-inline-size: 44px;
  padding: 0 16px;
  border: 1px solid var(--glass-edge);
  border-radius: var(--pill-radius);
  background: var(--glass-fill);
  color: var(--plum);
  font: inherit;
  font-weight: 650;
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.glass-button[data-variant="primary"] {
  min-block-size: 50px;
  background: linear-gradient(165deg, #fff 0%, #f6f1ff 48%, #e6def4 100%);
  box-shadow: 0 6px 16px rgb(54 38 93 / .14), inset 0 1px 1px #fff;
}

.glass-button[data-variant="icon"] {
  inline-size: 44px;
  padding: 0;
}

.glass-button:enabled:active {
  transform: translateY(1px);
}

.glass-button:disabled {
  color: #686078;
  background: #e8e3ee;
  box-shadow: none;
}

.glass-field {
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: 44px;
  padding: 0 16px;
  border: 1px solid #887a9c;
  border-radius: var(--pill-radius);
  background: var(--glass-fill);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}

.glass-field[aria-invalid="true"] {
  border-color: #9c2850;
}

.feature-tile[data-highlighted="true"] {
  border-color: rgb(255 255 255 / .78);
  background: var(--highlight-fill);
  color: var(--plum);
  box-shadow: 0 8px 24px rgb(110 65 154 / .20), inset 0 1px 1px rgb(255 255 255 / .75);
}

.glass-button:focus-visible,
.glass-field:focus-visible,
.feature-tile:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .glass-button { transition: none; }
  .glass-button:enabled:active { transform: none; }
}
```

## 6. Acceptance checks

1. Compare screenshots of all three compositions with the reference at 390 px. Verify the wave direction, quiet
   glass, white CTA, single peach-purple feature tile and empty illustration areas.
2. Check at 320 px, 390 px and desktop width. Exercise long labels, large text and the software keyboard. Confirm no
   horizontal scrolling, clipped labels or unreachable controls.
3. Verify keyboard focus, accessible names, 44 px touch targets and the current step announcement. Check field errors
   and all genuinely interactive selection, loading and disabled states.
4. Check contrast on the actual pale waves, behind each label and through each surface. Compare both the blurred and
   opaque versions.
5. Check the mobile result in Safari and Chrome where available. Confirm scrolling stays smooth with backdrop blur
   enabled and that native safe areas are respected.

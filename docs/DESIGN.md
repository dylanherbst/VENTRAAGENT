# VENTRA design reference (DESIGN.md)

Single source for design agents (`ventra-frontend`, plugins `frontend-design`, `impeccable`, `taste-skill`, `web-design-guidelines`). Values below were read from the code on 2026-11-03; they describe what exists, they do not invent a new look. If a new request conflicts with this file, keep the approved design and tell the owner.

## Approved direction: V5 subtle teal glass

Light, white-dominant, pastel, frosted glass with one teal accent. Beginner-friendly, calm, minimal. Applies to the new shell (`.ventra-app`, `apps/web/app/design-system/tokens.css`). Do not restyle it into neon.

Update 2026-11-05 (OWNER OVERRIDE, latest): the **default theme is soft lavender glass** (reference image 18): pastel lilac to light-blue gradient with large pale curved shapes, white frosted-glass cards and pills, deep indigo text, purple accent, big rounded corners (cards 24 to 26px, pills 999px, desktop frame 34px). The **warm dark frosted glass** (reference image 14/16: brown glass over a warm blurred backdrop, blue accent card, gold card, dark card) is the Dark alternative. The sidebar Theme button cycles Light (lavender), Dark (warm), Match device; the choice is stored in this browser only. The theme is the `data-theme` attribute on `.ventra-app` (`light` = lavender, `dark` = warm). The old teal V5 look is retired.

Lavender tokens (`[data-theme=light]` in `theme.css`): `--v-text #1E1B4B`, `--v-text-muted #45447A` (7.4:1 on the page), `--v-text-faint #62608F` (5.2:1), `--v-accent/--v-blue #6D28D9`, `--v-blue-soft/--v-link #5B21B6`, `--v-primary-grad #5B21B6 -> #7C3AED` (white text 5.7 to 9:1), glass `rgba(255,255,255,.55/.78)`, stroke `rgba(255,255,255,.88)`, `--v-focus #5B21B6`, chart series `#7C3AED #0EA5E9 #DB2777 #A78BFA`. Right-column cards in light: purple gradient accent card (white text), pale pink-lilac card (indigo text), indigo card with a white area chart.

Floating orbs (both themes): two soft gradient discs (large and small) drift slowly and change size, diffused by one frosted-glass layer. Pure CSS in `theme.css` (`.v-orbs`, `.v-orb-a` 22s and `.v-orb-b` 31s, `ease-in-out infinite alternate`, transform only, `will-change: transform`, fixed layer behind the app with `pointer-events: none`, `contain: strict`). No filter blur on the discs (soft radial-gradient edges instead); the glass layer blur is capped at 14px (8px on phones). `prefers-reduced-motion` stops the animation and leaves the orbs static. Two elements only, so it stays light on an 8GB Mac and on phones.

The earlier warm dark description below still applies to the Dark theme. Reference structure applied in both themes: one large rounded frame holding a left sidebar (workspace tile, five destinations, Settings and Support pinned at the bottom) and the page; page header with title, muted subtitle and an outlined Export button (opens Settings, where the real data export lives); four glass stat cards; chart panels; a right column of tall accent cards. The reference's names and numbers are never used; every figure comes from saved data or shows an honest empty state, and the dark card's area chart counts contacts and deals by the month they were last saved (omitted when there are none).

Mobile first: design at 375/390/430, then 768, 1024, 1440. Five destinations in a bottom bar (safe-area aware, 56px targets) and the same five in the desktop sidebar: Home, Create, Grow, Customers, More. Developer `/tools` pages are not in customer navigation.

Feature availability is one registry (`apps/web/lib/feature-registry.ts`, checked against `docs/agents/FEATURES.md` by `test/feature-registry.test.ts`). Tiles: Working opens; Local draft opens with a "Draft only" label; Blocked and Not started are greyed, dashed, not actionable, with the reason printed ("Needs setup" / "Coming soon") and `aria-disabled`.

## Tokens (`tokens.css`, scoped to `.ventra-app`)

| Token | Value | Use |
| --- | --- | --- |
| `--v-accent` | `#14BAB8` | the single accent: glows, highlights |
| `--v-ink-teal` / `--v-ink-deep` | `#07393D` / `#071F24` | primary button and active nav gradient (`#071F24 -> #07565A`) |
| `--v-text` / `--v-text-muted` / `--v-text-faint` | `#111D21` / `#5A696F` / `#7D8B91` | text |
| `--v-bg` / `--v-bg-cool` | `#E8EFF1` / `#DBE8EA` | page background gradient `#F0F5F5 -> #DCE8EA` |
| `--v-glass` / `--v-glass-strong` | `rgba(255,255,255,.42)` / `.68` | frosted surfaces |
| `--v-glass-stroke` / `-subtle` | `rgba(255,255,255,.72)` / `rgba(112,146,153,.15)` | 1px borders |
| `--v-success` / `--v-warning` / `--v-danger` | `#138969` / `#AC7728` / `#C84D56` | status |

Type: Inter, system fallbacks; body 14px/1.5; page title 28/36 weight 600; section titles 18/25 weight 600; overline 10px.
Shape: pill buttons (radius 999px, min height 44px), cards 18 to 24px radius, icon tiles 13px, nav rows 14px.
Depth: `0 12px 36px rgba(15,49,54,.08)` plus 1px inner white highlight. Layout: 248px sidebar, content max 1600px, 16 to 24px gaps.
Focus: 3px solid `#08777b`, offset 4px. Never remove it.

## Dark theme, the warm alternative (`[data-theme=dark]`)

Warm blurred backdrop, translucent brown panels with soft borders, rounded corners, light text, a soft-blue accent, and a serif display face for page titles and big numbers. All colours below are tokens in `tokens.css`; components use tokens, never raw hex.

| Token | Dark value | Use |
| --- | --- | --- |
| `--v-page` | warm radial glows over `#3a2f28 -> #221b16` | page background (also `body`) |
| `--v-text` / `--v-text-muted` / `--v-text-faint` | `#F6F1EC` / `#CBC0B5` / `#A99D91` | text (muted >= 7:1, faint >= 4.5:1 on panels) |
| `--v-glass` / `--v-glass-strong` | `rgba(255,255,255,.07)` / `.12` | panel fill (with blur 22px) |
| `--v-glass-stroke` / `-subtle` | `rgba(255,255,255,.16)` / `.10` | 1px borders |
| `--v-blue` / `--v-blue-soft` | `#8FB0FF` / `#B9CCFF` | soft-blue accent: bars, links, focus |
| `--v-blue-card` | gradient `#4C6BDB -> #7690EA` (accent card uses `#3f58c4 -> #7c95ea`) | tall accent card (white text, >= 5:1) |
| `--v-field` | `rgba(255,255,255,.08)` | inputs and chips |
| `--v-nav-on` | `rgba(255,255,255,.16)` + 5px blue left bar (`#4F7BF2`) | active nav pill |
| `--v-success` / `--v-warning` / `--v-danger` | `#6FD3AE` / `#E5BC76` / `#F08A92` | status text |
| `--v-focus` | `#B9CCFF` | 3px focus ring, offset 4px |

Light values: the table at the top of this file (`--v-blue` is `#0A6A70`; `--v-blue-card` and `--v-primary-grad` are the teal ink gradient `#071F24 -> #07565A`).

Type scale (dark and light): display `--v-font-display` = serif stack (`Iowan Old Style`, `Palatino`, `Georgia`, serif; no webfont, so no network request) for page titles (clamp 30 to 40px, weight 500), stat numbers (30px) and card numbers (40px). Body stays Inter 14px. Labels 12px, chips 11px.

Shape: panels 22px radius, stat cards 20px, pills 999px, sidebar 24px outer frame on desktop. Depth: `0 18px 48px rgba(0,0,0,.28)` plus 1px inner highlight (dark).

### Dashboard components (`design-system/charts.tsx`)

`StatCard` (icon tile, label, serif number, status chip), `Panel`, `BarChart`, `Donut`, `ProgressRow`, `FunnelBars`, `AccentCard`. All charts are inline SVG or CSS, take real numbers as props, and render an honest empty state when given no data. Rules: never draw a chart from invented, sample or estimated numbers; every chart has a text equivalent (numbers printed next to it or a `role="img"` label); meaning is never colour only (values and labels are always printed); no delta chip unless a real prior value exists, otherwise the chip states the data source ("From your saved data", "No data yet").

## Legacy authoring screens (`app/globals.css`)

Older course-authoring pages still use a dark purple palette (`--canvas #040217`, accent `#c2b4ff`, gradient indigo to purple to amber, DM Sans). It is legacy and scoped separately. New work uses the teal glass tokens; do not mix the two in one screen. Whether to migrate legacy screens is an owner decision.

## Rules for any UI work

1. Reuse components in `apps/web/app/design-system/primitives.tsx` and `apps/web/app/ui/` before creating new ones.
2. Use tokens, not new hex values. Add a token here first if one is truly missing.
3. Touch targets at least 44px; WCAG AA contrast; visible focus; honor `prefers-reduced-motion`.
4. Mobile first: check 375px, 768px and desktop. No horizontal scroll.
5. Plain beginner language. Show connection state (DEMO / LIVE) on tool pages.
6. Verify in a real browser (Playwright plugin), not only by reading code.

## Plugins that support design (all off until needed)

`frontend-design`, `impeccable`, `taste-skill`, `figma` (needs sign-in), `web-design-guidelines` (project skill), Playwright and Chrome DevTools. Generic skill output is advisory; this file and the existing screens win.

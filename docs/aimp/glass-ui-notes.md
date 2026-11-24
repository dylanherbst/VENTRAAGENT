# Peach & Lavender Glass UI: implementation notes

Spec: `docs/aimp/reference/Peach-Lavender-Glass-Claude-Guide.md`. Built 14 Nov 2026.

## Where things are

| What | Path |
| --- | --- |
| Tokens (single source of truth, scoped to `.plg`) | `apps/web/app/design-system/aimp-glass/tokens.css` |
| Component styles | `apps/web/app/design-system/aimp-glass/aimp-glass.css` |
| Components (import from `index.ts`) | `apps/web/app/design-system/aimp-glass/` |
| Showcase | `/start/showcase` (`apps/web/app/start/showcase/`) |
| Pointer page in the tools list | `/tools/aimp-glass` |
| Entry flow | `/start`, `/start/account`, `/start/tour`, `/start/goals` |
| Pure logic and tests | `app/start/flow.ts`, `app/design-system/aimp-glass/{steps,contrast}.ts`, `test/aimp-glass-*.test.ts` |

## How to use the library

Import `tokens.css` and `aimp-glass.css` once in the route layout, wrap the view in `<WaveBackdrop>` (it sets the
`.plg` scope that carries every token) and compose the components. Nothing leaks outside `.plg`, except one
`body:has(.plg-backdrop[data-mode="page"])` rule that swaps the app's dark page colour while a backdrop is on screen.

## Decisions

- **Ink is plum, not white.** The mockup's white labels fail contrast on the pale waves (under 2:1), so text uses
  the plum and body-ink tokens, as the guide allows. Field borders and progress dots use a darker
  `--plg-control-border` so control boundaries reach 3:1. `test/aimp-glass-contrast.test.ts` checks every pair.
- **Showcase lives at `/start/showcase`.** `app/tools/layout.tsx` wraps every tool page in the VENTRA shell and cannot
  be escaped without editing it, so `/tools/aimp-glass` is a short pointer page.
- **Auth options.** Email and password only, posted to the existing `/api/workspace` endpoint (`action: 'signup'` or
  `'login'`). Google and Apple appear in `/start/account` as disabled buttons marked "Coming soon". The showcase shows
  working-looking provider buttons as component samples only; they do nothing.
- **No Name field in the real form.** The auth endpoint takes email and password only. The showcase composition
  keeps the three-field layout from the mockup.
- **Account is skippable.** Skip on the account screen goes to the overview. Goal answers are saved in the browser
  (`lib/aimp/onboarding/store`, key `this-browser/start-flow`), not on the account, because the endpoint returns no
  user id.
- **Opaque fallback.** Without `backdrop-filter`, with `prefers-contrast: more`, or with `glass="opaque"` on the
  backdrop, surfaces use a solid light-lilac fill. The switch is three `--plg-mat-*` variables in `tokens.css`.
- **Wave art** is one inline SVG (blurred paths) stretched to the box, coloured from the tokens, static and hidden
  from assistive technology.

## Not done or not verified

- Not tested on real Safari or on a phone with the software keyboard open. Checked in headless Chromium only.
- Sign-up and sign-in were exercised against the endpoint without Supabase configured (the 503 "not connected"
  path). The signed-in and confirm-email paths are covered by unit tests of the response handling only.
- Routes are `noindex` and not linked from the public site.

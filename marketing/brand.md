# VENTRA brand kit (marketing)

Direction approved by the owner: minimal, premium, futuristic. Source of truth for colours and fonts is
`docs/design/UI_BIBLE.md`; this page applies it to social content. Templates: `marketing/templates/`; renderer:
`marketing/render.mjs` (stills) and `marketing/reel.mjs` (video).

## Palette

| Role | Name | Hex | Use in content |
| --- | --- | --- | --- |
| Primary | Royal Plum | `#76335C` | Background glow (top), highlight-cover base |
| Primary | Soft Periwinkle | `#A592EE` | Glow orbs, start of the accent gradient |
| Accent | Bubblegum / peach | `#FE86AA` | Eyebrow labels, end of the accent gradient, bullets |
| Action | Action purple | `#6d3df0 → #9b6bff` | CTA pills only ("Join the waitlist") |
| Base | White | `#FFFFFF` | Headlines on dark; light-theme canvas |
| Contrast | Onyx | `#0A0A0A` | Dark canvas base, "Concept demonstration" label |

Accent gradient for one highlighted word per headline: Periwinkle → Peach (`*word*` in template slots).
Do not introduce new hues. Success/warning/error colours are for the app, not for social content.

Themes: `dark` (Onyx with plum/purple glows, white type) is the default; `light` (white with periwinkle/peach glows,
near-black type `#1B1020`) for variety in the grid. Alternate deliberately; do not mix both inside one carousel.

## Type

| Role | Font | Weight | Size on 1080 px canvas |
| --- | --- | --- | --- |
| Headline | Outfit | 600 | 80–104 px, tracking -0.02em, line-height 1.04 |
| Eyebrow / label | Hanken Grotesk | 700, uppercase | 24 px, tracking 0.14em |
| Body | Hanken Grotesk | 400 | 32–34 px, line-height 1.5 |
| Meta (page no., footer) | Hanken Grotesk | 400 | 24 px |
| Wordmark | Outfit | 600, uppercase | 26 px, tracking 0.22em |

Both fonts are free (SIL Open Font License) and are loaded from Google Fonts in every template
(`fonts.googleapis.com`, `display=block`). They are not installed locally on this Mac, so rendering needs network
access. The renderer checks that both fonts actually loaded and prints `FALLBACK` if not; a FALLBACK render must not be
shipped. No paid fonts.

## Logo

- File: `apps/web/public/brand/ventra-mark.png` (ribbon-V, purple → peach). Use the file as is: never redraw, recolour,
  stretch, rotate, outline or add effects to it.
- Lock-up in content: mark + the word `VENTRA` in Outfit 600 uppercase, letter-spaced. Mark height 44 px on a 1080 px canvas
  (22 px CSS), at least one mark-height of clear space around it.
- Only on calm backgrounds: the dark canvas, the light canvas, or a glass card. Never on photos, busy screenshots or
  patterns.
- Minimum size: 32 px tall in the final image.
- Highlight covers may use the mark alone, centred in the glass disc.
- Open for the owner: a white single-colour mark and an SVG version do not exist yet (needed for very small or
  one-colour uses).

## Layout

- Sizes (template CSS × 2 = output pixels): carousel 1080×1350, square post 1080×1080, story/reel 1080×1920,
  highlight cover 1080×1080.
- Margins: 88 px on all sides (44 px CSS). Stories and reels: keep text out of the top 250 px and bottom 340 px
  (Instagram UI); reel captions sit above the bottom UI.
- One idea per slide: eyebrow, one headline, at most one short paragraph or three bullets, one CTA.
- Glass cards: white 8 % fill (55 % on light), 1 px white 22 % border, 28 px CSS radius, blur 22 px, soft shadow.
- Highlight covers: all content inside the centre 600 px circle.

## Words

- Speak in business outcomes for service businesses: answered calls, faster replies, booked jobs, follow-ups,
  fewer no-shows, time back. Avoid AI jargon (LLM, agentic, tokens, models).
- Short sentences. Australian English spelling.
- Truth: no invented testimonials, customers, revenue or statistics; industry numbers only with a checkable source.
  Any frame that is not real product footage carries the label **Concept demonstration** (`label` slot in every
  template; set by default in the reel sample).

## Do

- Keep plenty of empty space; let one headline carry the slide.
- Use the accent gradient on one word per headline at most.
- Use the action-purple pill for the single CTA.
- Check every render log line says `OK` and `Outfit+Hanken Grotesk loaded`.

## Don't

- No clip art, stock-photo clichés (handshakes, headsets, robots), emoji walls or 3D robot heads.
- No more than one CTA per slide; no engagement bait ("comment YES").
- No new colours, drop shadows on text, outlines on the logo, or the logo on busy backgrounds.
- No claims of features that do not work today; no "AI-powered" filler.

## Commands

```
node marketing/render.mjs --check            # one PNG per template -> ~/Developer/VENTRA-MARKETING/samples/
node marketing/render.mjs --spec post.json   # a whole post/carousel
node marketing/reel.mjs --check              # 5 s 1080x1920 H.264 sample with burned-in captions
node marketing/reel.mjs --spec reel.json     # a reel (<= 60 s)
node marketing/reel.mjs --probe file.mp4     # codec, size, fps, duration (no ffprobe needed)
```

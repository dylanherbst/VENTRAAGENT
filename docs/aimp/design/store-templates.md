# Store templates: art direction (rebuilt 22 Nov 2026)

Brief: 15 shop looks for small digital-product sellers that do not read as generated pages. Built with the frontend-design guidance.

## System
- Every template = palette (8 tokens) + its own typeface pair (self-hosted via next/font, only the used files download) + one **signature** element. Everything else stays quiet.
- Removed generated-page tells from the shared shop CSS: all-caps eyebrows and meta labels, middle-dot meta strings, the radial gradient hero wash, hover lifts on every card.
- Real info in the hero: the hero product's price, title, format and page count sit beside the button.
- Covers redrawn as a printed page: colour title band in the display face, then the page's pattern (lines, grid, dots, arch).
- Static decoration only; nothing animates on its own. Tilts are flattened for reduced-motion users. No sideways scroll on phones.

## The 15
| Template | Type pair | Signature | Palette idea |
|---|---|---|---|
| Clean Launch | Bricolage Grotesque | Price set huge beside the headline | White, ink, cobalt |
| Sage Studio | Fraunces (soft) + Work Sans | Large cover, turned like a planner on a desk | Sage paper, deep green |
| Blush Boutique | Young Serif + Figtree | Round "Instant download" sticker | Pink, raspberry |
| Midnight Shop | Syne + Manrope | Covers fanned out like app windows | Graphite, periwinkle |
| Paper & Ink | Libre Caslon (italic heads) + Karla | Catalogue as a contents page with dotted leaders | Cool paper, navy ink |
| Sunny Bundle | Unbounded + Rubik | Colour slab behind the hero, bundle filled with colour | Butter yellow, tomato |
| Ocean Planner | Archivo (expanded) | Graph-paper hero | Pale blue, strong blue |
| Kraft & Stamp | Gloock + Schibsted Grotesk | Covers taped onto kraft paper | Kraft brown, stamp red |
| Mono Minimal | Instrument Serif + Instrument Sans | Heavy black frame, huge type | True black and white |
| Berry Pop | Fredoka + Nunito Sans | Cards at angles like worksheets on a wall | Pink, berry |
| Forest Study | DM Serif Display + DM Sans | Ruled notebook page with margin line | Pale green, forest |
| Sky Soft | Nunito | One product standing on a shelf | Pale sky, blue |
| Gold Standard | Cormorant Garamond (italic) + Mulish | Double-ruled certificate border | Navy, gold |
| Lemon Fresh | Sora | Bold strip of reasons to buy | Lemon, leaf green |
| Lavender Glow | Epilogue | Product in an arched window | Lavender, violet |

Template ids are unchanged (stored shop configs keep working); "Terracotta Craft" was renamed "Kraft & Stamp" because cream + terracotta is a generated-page default.

# UI preservation guide

- **Design system.** Do not change the shared design system: `app/design-system/aimp-glass/*`, `tokens.css`, the `--amg-*` variables, `workspace-skin.css`, `workspace-nav.css`, the carousel and the theme files. New pages compose those components (`AppLayout`, `AppIntro`, `GlassCard`, `GlassNotice`, glass buttons) or the agent styles in `ai-team/team.css`.
- **Status colours:** purple means the AI agent is working (`--amg-accent`), blue means loading (`--amg-blue`), green means completed (`--amg-done`), red means it needs you (`--amg-attn`). Growth Home uses them in `home/growth-home.css`.
- **Navigation:**
  - Change only the data in `workspace-nav-items.ts` (desktop bar, drawer, search, Settings links), `lib/aimp/entry.ts` (tabs) and `DOCK` in `workspace-nav.tsx` (phone dock: Home, AI Sales, Social, Marketing, Search).
  - The markup and CSS of the bars are unchanged.
  - Two icons were added in the same stroke style: sales and social.
- **Copy:** plain Australian English, no earnings claims, and "Not measured yet" instead of a zero.
- **Before merging UI work:** screenshots at 390 px and 1440 px of Home, Sales, Social, Marketing, Profile, Settings, `/start`, `/start/existing` and `/app/<id>/activate`, in light and dark.

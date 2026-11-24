# Plugin setup for VENTRA (checked 2026-11-03)

Everything is installed at **local scope** (this project only, nothing in the shared repo settings). Default-on tools are the cheap ones; the rest are switched on per task.

## Switching a plugin on for one task

```bash
claude plugin enable NAME@MARKETPLACE --scope local     # before the task
claude plugin disable NAME@MARKETPLACE --scope local    # after
```
Or use `--settings '{"enabledPlugins":{"NAME@MARKETPLACE":true}}'` for a single headless run. A plugin enabled mid-session needs `/reload-plugins`.

## Always on

typescript-lsp, context7 (needs sign-in), Serena MCP server `serena` (hardened: read-only navigation, 9 tools; mode file `scripts/agents/serena-readonly-mode.yml`, installed by `scripts/agents/install.sh`).

## On demand

| Task | Enable |
| --- | --- |
| New UI / visual polish | frontend-design, impeccable, taste-skill, web-design-guidelines (project skill, always listed) |
| Browser test, screenshots | playwright (or chrome-devtools-mcp for performance and console) |
| Feature work, reviews | feature-dev, superpowers, code-review, pr-review-toolkit, code-simplifier |
| Commits | commit-commands (still go through `ventra-git`) |
| Memory/docs upkeep | claude-md-management, claude-code-setup |
| Building agents or plugins | agent-sdk-dev, plugin-dev |
| Design files | figma (sign-in) |
| Security hints | security-guidance (hooks add startup cost) |

## Keep OFF until MCP deny rules exist

github, supabase, vercel, stripe, notion, context-mode. Their MCP tools can push, merge, run SQL, deploy or charge **without passing the Bash/Edit guard**. Needed first: owner unlock (`ventra-guard unlock 10`) to add MCP deny/ask rules to `.claude/settings.json`. Stripe: test mode only.

## Not installed / not supported here

Ralph Loop: evaluated, not installed (unbounded loops conflict with the usage policy). Marketing and Brand Voice: Cowork only. Gmail, Google Calendar, Google Drive: connect in Claude Desktop under Customize > Connectors (needs your sign-in).

## Token notes (measured with headless runs, see final report)

Baseline trivial prompt 67,123 input+cache tokens. Foundation set (typescript-lsp, context7, Serena) +352. Skipping user-level config (282 unrelated agents, `rea` MCP) saves about 32.8k per session. Context Mode: no saving observed on a 328 KB log task (+6.4k to +6.7k tokens), about 325 MB RAM, Elastic-2.0 licence: kept off.

## Known limits

- TypeScript LSP launched from the repo root cannot find `typescript` (it lives in `apps/web/node_modules`); open Claude in `apps/web` or set `tsserver.path`.
- Guard false positive: `cmd 2>&1 | tail` mentioning a control file is blocked (`lib/rules.mjs`); fix needs owner unlock.

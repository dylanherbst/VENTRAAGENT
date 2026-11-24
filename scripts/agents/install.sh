#!/bin/bash
# Installs the VENTRA agent commands as real copies (so they survive branch switches):
#   ~/.local/bin/ventra-handoff, ventra-claude, ventra-codex, ventra-guard   plain scripts
#   ~/.local/share/ventra-agents/   the guard hooks, ventra-git, ventra-approval and their libraries
#   ~/.local/bin/ventra-git, ventra-approval                                 small launchers for the above
# The Claude Code hooks run from ~/.local/share/ventra-agents, outside any repository, so an ordinary
# edit in a project cannot change them. Re-run this after the owner changes a guard script.
set -euo pipefail
d="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
share="$HOME/.local/share/ventra-agents"
NODE="$(command -v node)" || { echo "Node is required." >&2; exit 1; }
mkdir -p "$bin" "$share/lib"

for f in ventra-handoff ventra-claude ventra-codex ventra-guard ventra-backup ventra-statusline ventra-remote ventra-verify ventra-coordinator ventra-coord ventra-master; do install -m 755 "$d/$f" "$bin/$f"; done
for f in guard-bash.mjs guard-edit.mjs ventra-git.mjs ventra-approval.mjs; do install -m 755 "$d/$f" "$share/$f"; done
for f in "$d"/lib/*.mjs; do install -m 644 "$f" "$share/lib/$(basename "$f")"; done
install -m 644 "$d/serena-readonly-mode.yml" "$share/serena-readonly-mode.yml"

for tool in ventra-git ventra-approval; do
  printf '#!/bin/bash\nexec "%s" "%s/%s.mjs" "$@"\n' "$NODE" "$share" "$tool" > "$bin/$tool"
  chmod 755 "$bin/$tool"
done

# Fingerprint of what is installed, so the Command Center can tell if it differs from the repository.
( cd "$share" && find . -type f -name '*.mjs' | sort | xargs shasum -a 256 > "$share/MANIFEST.sha256" )
echo "Installed: ventra-handoff ventra-claude ventra-codex ventra-guard ventra-git ventra-approval -> $bin"
echo "Guard scripts: $share"

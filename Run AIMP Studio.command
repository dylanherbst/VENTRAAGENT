#!/bin/bash
# AiMoneyPrinter Studio on this Mac: your own brands, Marketing + Social agents and AI Setter. Private: only this Mac can open it
# (127.0.0.1), so no password is asked here. Data is saved in apps/studio/.studio-data. Close this window to stop it.
export PATH="/opt/homebrew/bin:$HOME/.homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")/apps/studio" || { echo "Could not find apps/studio"; read -r -p "Press Return to close."; exit 1; }
command -v node >/dev/null || { echo "Node.js was not found."; read -r -p "Press Return to close."; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
# Your AI keys from the main app (ANTHROPIC_API_KEY etc.), without copying them anywhere.
[ -f ../web/.env.local ] && { set -a; . ../web/.env.local; set +a; }
export STUDIO_LOCAL_OPEN=1 STUDIO_STORAGE=file NEXT_TELEMETRY_DISABLED=1
echo; echo "  AiMoneyPrinter Studio:  http://127.0.0.1:3070"; echo
( sleep 6; open "http://127.0.0.1:3070" ) &
npx next dev --hostname 127.0.0.1 -p 3070
read -r -p "Server stopped. Press Return to close."

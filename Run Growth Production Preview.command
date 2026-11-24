#!/bin/bash
# AiMoneyPrinter - production build preview you can also open on your phone.
# Separate from the dev server (port 3040): own port, own build folder (.next-growth-prod).
# It listens on your Wi-Fi network so a phone on the SAME Wi-Fi can open it. Close this window to stop it.
export PATH="/opt/homebrew/bin:$HOME/.homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")/apps/web" || { echo "Could not find apps/web"; read -r -p "Press Return to close."; exit 1; }
command -v node >/dev/null || { echo "Node.js was not found on this Mac's PATH."; read -r -p "Press Return to close."; exit 1; }

PORT=3150
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
export NEXT_DIST_DIR=.next-growth-prod
# Lets the guided setup steps run on demo storage in this preview (sample data only, nothing live).
export AIMP_TOOLS_ENABLED=1

echo "Building the production version (takes a minute or two)..."
# CI=1 stops Next.js asking interactive questions (upgrade / coding-agent prompts) that would block the build.
if ! CI=1 NEXT_TELEMETRY_DISABLED=1 npx next build; then
  echo; echo "BUILD FAILED - copy the error above and send it to Claude."
  read -r -p "Press Return to close."; exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
NAME=$(scutil --get LocalHostName 2>/dev/null)
echo
echo "=================================================================="
echo "  On this Mac:    http://127.0.0.1:$PORT/start"
[ -n "$IP" ]   && echo "  ON YOUR PHONE:  http://$IP:$PORT/start"
[ -n "$NAME" ] && echo "  (or)            http://$NAME.local:$PORT/start"
[ -z "$IP" ]   && echo "  No Wi-Fi address found. Connect this Mac to Wi-Fi, then run this again."
echo "  The phone must be on the same Wi-Fi as this Mac."
echo "  Leave this window open. Ctrl+C or closing it stops the preview."
echo "=================================================================="
( sleep 3; open "http://127.0.0.1:$PORT/start" ) &
npx next start --hostname 0.0.0.0 -p $PORT
read -r -p "Server stopped. Press Return to close."

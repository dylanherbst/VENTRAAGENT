#!/bin/bash
# AIMoneyPrinter Test Lab: a separate local copy for testing features with a filled-in mock customer.
# Own port (3060 or the next free one) and own build folder (.next-lab), so it never touches the production preview (3050) or dev (3040).
# Uses the development server: it starts in seconds and updates as code changes. Demo data only: no real payments or email.
# Close this window to stop it.
export PATH="/opt/homebrew/bin:$HOME/.homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")/apps/web" || { echo "Could not find apps/web"; read -r -p "Press Return to close."; exit 1; }
command -v node >/dev/null || { echo "Node.js was not found on this Mac's PATH."; read -r -p "Press Return to close."; exit 1; }

PORT=3060
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
export NEXT_DIST_DIR=.next-lab
export AIMP_TOOLS_ENABLED=1
export CI=1
export NEXT_TELEMETRY_DISABLED=1

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
NAME=$(scutil --get LocalHostName 2>/dev/null)
export AIMP_DEV_ORIGINS="${IP:-127.0.0.1},${NAME:-localhost}.local"
echo
echo "=================================================================="
echo "  AIMoneyPrinter TEST LAB (demo data only)"
echo "  On this Mac:    http://127.0.0.1:$PORT/test-lab"
[ -n "$IP" ]   && echo "  ON YOUR PHONE:  http://$IP:$PORT/test-lab"
[ -n "$NAME" ] && echo "  (or)            http://$NAME.local:$PORT/test-lab"
echo "  Press 'Build the mock customer' on that page. The first page load compiles, so give it a moment."
echo "  The phone must be on the same Wi-Fi as this Mac. Close this window to stop."
echo "=================================================================="
( sleep 6; open "http://127.0.0.1:$PORT/test-lab" ) &
npx next dev --hostname 0.0.0.0 -p $PORT
read -r -p "Server stopped. Press Return to close."

#!/bin/bash
# Starts SiteForge on this Mac and opens it at http://127.0.0.1:4400 . Close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js is not installed. Install it from https://nodejs.org and try again."; read -r; exit 1; fi
# Installs dependencies when needed, starts the app and opens the browser when it is ready.
node scripts/start-siteforge.mjs --open || { echo "SiteForge stopped. Press Return to close."; read -r; }

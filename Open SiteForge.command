#!/bin/bash
# Starts the SiteForge app on this Mac and opens it at http://127.0.0.1:4400 . Close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js is not installed. Install it from https://nodejs.org and try again."; read -r; exit 1; fi
if [ ! -d node_modules ]; then echo "Installing dependencies (first run only)..."; npm install || { echo "npm install failed. Press Return to close."; read -r; exit 1; }; fi
(sleep 12; open "http://127.0.0.1:4400") &
npm run siteforge

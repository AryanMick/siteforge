#!/bin/bash
# Starts the SiteForge app on this Mac and opens it at http://127.0.0.1:4400 . Close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js is not installed. Install it from https://nodejs.org and try again."; read -r; exit 1; fi
# Install dependencies on the first run, and again whenever package.json or package-lock.json changed since the last
# install (node_modules/.package-lock.json is written by npm at the end of every install).
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies..."
  npm install || { echo "npm install failed. Press Return to close."; read -r; exit 1; }
  touch node_modules/.package-lock.json
fi
(sleep 12; open "http://127.0.0.1:4400") &
npm run siteforge

#!/usr/bin/env bash
# Generate a test site and load it into the Docker WordPress.
set -euo pipefail
cd "$(dirname "$0")/.."

SITE=outputs/library

rm -rf "$SITE"                                        # the generator won't overwrite an existing folder
node src/cli.mjs generate examples/library.yaml --out "$SITE"
npm run wordpress:docker -- up
npm run wordpress:docker -- load "$SITE"

echo "Done: http://localhost:8080  (admin login is in docker/.env)"
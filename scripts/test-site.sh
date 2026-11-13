#!/usr/bin/env bash
# Generate a test site and load it into the Docker WordPress.
#   bash scripts/test-site.sh                          maximum-noise site (examples/wordpress-max-noise.yaml)
#   bash scripts/test-site.sh examples/library.yaml    any other settings file; the site is written to outputs/<file name>
set -euo pipefail
cd "$(dirname "$0")/.."

SETTINGS="${1:-examples/wordpress-max-noise.yaml}"
NAME="$(basename "$SETTINGS" .yaml)"
SITE="outputs/$NAME"

rm -rf "$SITE"                                        # the generator won't overwrite an existing folder
node src/cli.mjs generate "$SETTINGS" --out "$SITE"
npm run wordpress:docker -- up
npm run wordpress:docker -- load "$SITE"

echo "Done: http://localhost:8080  (admin login is in docker/.env)"
echo "Answer key: $SITE/private/answer-key.json"

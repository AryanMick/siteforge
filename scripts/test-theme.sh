#!/usr/bin/env bash
# Generate a test site and push its content into a real WordPress theme in Docker (the realistic-site test).
# The companion of test-site.sh, which loads the site with SiteForge's own noisy theme instead.
#   bash scripts/test-theme.sh                                 Astra theme, library site (examples/library.yaml)
#   bash scripts/test-theme.sh kadence                         another wordpress.org theme (or a theme .zip file or URL)
#   bash scripts/test-theme.sh kadence examples/adversarial-library.yaml   another settings file; the site is written to outputs/<file name>
# Starts from an empty WordPress each time, so nothing from an earlier test is left on the site.
set -euo pipefail
cd "$(dirname "$0")/.."

THEME="${1:-astra}"
SETTINGS="${2:-examples/library.yaml}"
NAME="$(basename "$SETTINGS" .yaml)"
SITE="outputs/$NAME"

rm -rf "$SITE"                                        # the generator won't overwrite an existing folder
node src/cli.mjs generate "$SETTINGS" --out "$SITE"
npm run wordpress:docker -- reset                     # empty WordPress: no pages or types from an earlier test
npm run wordpress:docker -- theme "$THEME"            # installs WordPress, the importer plugin and the theme; shows its content types
npm run wordpress:docker -- push "$SITE"

echo "Done: http://localhost:8080  (the content types are in the left menu of http://localhost:8080/wp-admin)"
echo "Answer key: $SITE/private/wordpress-answer-key.json"

#To stop, use 'npm run wordpress:docker -- down'

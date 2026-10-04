#!/usr/bin/env bash
# Copy the shop to the web root. No sudo needed after install.sh.
# Cloudflare tells browsers to keep .js/.css for 4 hours whatever nginx says,
# so the published index.html points at each file with ?v=<content hash>:
# a changed file gets a new URL and no browser can mix old and new files.
set -euo pipefail
src="$(cd "$(dirname "$0")/../public" && pwd)"
dst=/var/www/nelin-store
for f in "$src"/*.js; do node --check "$f"; done
rsync -a --delete "$src"/ "$dst"/
for f in styles.css motifs.js app.js; do
  v=$(sha1sum "$dst/$f" | cut -c1-10)
  sed -i "s#\"/$f\"#\"/$f?v=$v\"#" "$dst/index.html"
done
grep -o '"/[a-z]*\.\(css\|js\)?v=[0-9a-f]*"' "$dst/index.html" | tr '\n' ' '; echo
echo "published $(ls "$dst" | wc -l) files"

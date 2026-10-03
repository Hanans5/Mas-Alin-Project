#!/usr/bin/env bash
# Copy the shop to the web root. No sudo needed after install.sh.
set -euo pipefail
src="$(cd "$(dirname "$0")/../public" && pwd)"
for f in "$src"/*.js; do node --check "$f"; done
rsync -a --delete "$src"/ /var/www/nelin-store/
echo "published $(ls /var/www/nelin-store | wc -l) files"

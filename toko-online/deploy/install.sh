#!/usr/bin/env bash
# One-time setup, run as root (pkexec): web root owned by hanan + nginx site.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
install -d -o hanan -g hanan -m 755 /var/www/nelin-store
install -m 644 "$here/nginx-nelin-store.conf" /etc/nginx/sites-available/nelin-store
ln -sf /etc/nginx/sites-available/nelin-store /etc/nginx/sites-enabled/nelin-store
nginx -t
systemctl reload nginx
echo installed

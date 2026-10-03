#!/usr/bin/env bash
# Install Nelin Batik as a service behind nginx. Run with sudo.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
pkill -u hanan -f 'pocketbase serve --http=127.0.0.1:8090' || true   # the dev copy started by hand
install -m 644 "$here/nelin-batik.service" /etc/systemd/system/nelin-batik.service
install -m 644 "$here/nginx-nelin-batik.conf" /etc/nginx/sites-available/nelin-batik
ln -sf /etc/nginx/sites-available/nelin-batik /etc/nginx/sites-enabled/nelin-batik
nginx -t
systemctl daemon-reload
systemctl enable --now nelin-batik
systemctl reload nginx
sleep 2
systemctl is-active nelin-batik
curl -s -H 'Host: nelin.home' http://127.0.0.1/api/health
echo

#!/usr/bin/env bash
# Install the home-server tunnel and the updated nginx vhost. Run as root.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
install -m 644 "$here/nginx-nelin-batik.conf" /etc/nginx/sites-available/nelin-batik
install -m 644 "$here/home-tunnel.service" /etc/systemd/system/home-tunnel.service
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now home-tunnel
sleep 4
systemctl is-active home-tunnel

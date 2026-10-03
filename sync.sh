#!/usr/bin/env bash
# Copy the two live project folders into this repo, leaving out everything
# that must never be committed: the database, account passwords, backups and
# the PocketBase binary. Then review with `git status` and commit.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rsync -a --delete \
  --exclude pb_data/ --exclude backups/ --exclude ACCOUNTS.md --exclude /pocketbase \
  --exclude .gitignore --exclude '*.db' --exclude '*.db-*' \
  ~/nelin-batik/ "$here/kasir/"
rsync -a --delete --exclude backups/ ~/nelin-store/ "$here/toko-online/"
git -C "$here" status --short

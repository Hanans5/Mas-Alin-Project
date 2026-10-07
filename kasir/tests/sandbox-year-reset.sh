#!/bin/bash
# Prepare a SANDBOX for the one-year simulation: a read-only snapshot of the
# live DB with its sales history cleared, stock at 0 and assumed kodian
# prices (halfway between HPP and the normal price). The live DB is only read.
#   tests/sandbox-year-reset.sh <sandbox dir>   (holds pocketbase + creds.env with SU_EMAIL/SU_PASS)
# Then serve it on 127.0.0.1:8099 with every path explicit (see CLAUDE.md) and run, in order:
#   simulate-year.mjs → simulate-year-backdate.mjs → check-year.mjs → ui-year.mjs
set -e
SB=$(cd "${1:?usage: $0 <sandbox dir>}" && pwd); LIVE=$HOME/nelin-batik
[ "$SB" = "$LIVE" ] && { echo "refusing: that is the live folder"; exit 1; }
mkdir -p $SB/pb_data
rm -f $SB/pb_data/data.db* $SB/pb_data/auxiliary.db*
sqlite3 "file:$LIVE/pb_data/data.db?mode=ro" "VACUUM INTO '$SB/pb_data/data.db'"
sqlite3 "file:$LIVE/pb_data/auxiliary.db?mode=ro" "VACUUM INTO '$SB/pb_data/auxiliary.db'"
sqlite3 $SB/pb_data/data.db "
BEGIN;
DELETE FROM sale_payments; DELETE FROM sale_items; DELETE FROM receivable_payments; DELETE FROM receivables; DELETE FROM sales;
DELETE FROM stock_moves; DELETE FROM expenses; DELETE FROM cash_entries; DELETE FROM web_orders;
UPDATE products SET stock = 0;
UPDATE products SET price_kodi = (((price + hpp) / 2) / 500) * 500 WHERE active = 1;
UPDATE users SET points = 0;
COMMIT;"
. $SB/creds.env
$SB/pocketbase superuser upsert "$SU_EMAIL" "$SU_PASS" --dir $SB/pb_data

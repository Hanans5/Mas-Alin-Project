#!/bin/bash
# Rehearse the old-system import on a SANDBOX, never on live:
#   tools/migrasi/simulate.sh <sandbox dir> [fresh|live] [--sales] [--keep]
#     fresh  a brand-new database from pb_migrations, as on a new server (default)
#     live   a read-only snapshot of the live database
#     --sales  also rebuild the old history as receipts (gen_sales.py)
# NB_CODE = folder with the pb_hooks/pb_migrations/pb_public to test (default: live's).
# Runs the import twice (the second run proves it can be repeated), checks
# every total after each run, compares the result with live (read-only), then
# serves the sandbox on a spare port and runs the API check and the three test
# suites. The sandbox is removed at the end unless --keep.
# The data stays in the private folder NB_MIGRASI_DATA (default
# ~/nelin-batik/backups/migrasi-data), never in git.
set -euo pipefail
LIVE=$HOME/nelin-batik
HERE=$(cd "$(dirname "$0")" && pwd)
SB=${1:?usage: $0 <sandbox dir> [fresh|live] [--sales] [--keep]}
MODE=fresh; KEEP=; SALES=
for a in "${@:2}"; do case $a in fresh|live) MODE=$a;; --keep) KEEP=1;; --sales) SALES=1;; *) echo "unknown: $a"; exit 1;; esac; done
CODE=${NB_CODE:-$LIVE}
DATA=${NB_MIGRASI_DATA:-$LIVE/backups/migrasi-data}
mkdir -p "$SB"; SB=$(cd "$SB" && pwd)
[ "$SB" = "$LIVE" ] || [ "$SB" = "$LIVE/pb_data" ] && { echo "refusing: that is the live folder"; exit 1; }
[ -f "$DATA/expected.json" ] || { echo "no expected.json in $DATA"; exit 1; }
chmod 700 "$SB"
step() { printf '\n== %s\n' "$*"; }

step "sandbox $SB ($MODE)"
rm -rf "$SB/pb_data" "$SB/pb_hooks" "$SB/pb_migrations" "$SB/pb_public"
mkdir -p "$SB/pb_data"
cp -r "$CODE/pb_hooks" "$CODE/pb_migrations" "$CODE/pb_public" "$SB/"
cp "$LIVE/pocketbase" "$SB/pocketbase"
if [ "$MODE" = live ]; then
  sqlite3 "file:$LIVE/pb_data/data.db?mode=ro" "VACUUM INTO '$SB/pb_data/data.db'"
  sqlite3 "file:$LIVE/pb_data/auxiliary.db?mode=ro" "VACUUM INTO '$SB/pb_data/auxiliary.db'"
  cp -r "$LIVE/pb_data/storage" "$SB/pb_data/" 2>/dev/null || true
fi
PB() { "$SB/pocketbase" "$@" --dir "$SB/pb_data" --hooksDir "$SB/pb_hooks" --migrationsDir "$SB/pb_migrations"; }
PB migrate up >/dev/null

# Test logins, sandbox only (an owner first, so the import can sign its rows).
PASS="Sim$(head -c 12 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
printf 'SU_EMAIL=sim@local.test\nSU_PASS=%s\n' "$PASS" > "$SB/creds.env"; chmod 600 "$SB/creds.env"
PB superuser upsert sim@local.test "$PASS" >/dev/null
sqlite3 "$SB/pb_data/data.db" "UPDATE users SET disabled = 1 WHERE role != 'pelanggan'"   # snapshot logins out of the way
PORT=$(for p in $(seq 8140 8199); do ss -ltn | grep -q ":$p " || { echo $p; break; }; done)
"$SB/pocketbase" serve --http 127.0.0.1:$PORT --dir "$SB/pb_data" --hooksDir "$SB/pb_hooks" --migrationsDir "$SB/pb_migrations" --publicDir "$SB/pb_public" > "$SB/serve.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; sleep 0.2; done
ST=$(curl -s -X POST "http://127.0.0.1:$PORT/api/collections/_superusers/auth-with-password" -H 'content-type: application/json' \
  -d "{\"identity\":\"sim@local.test\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
for u in owner admin kasir; do
  curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/api/collections/users/records" -H "Authorization: $ST" -H 'content-type: application/json' \
    -d "{\"username\":\"sim$u\",\"password\":\"$PASS\",\"passwordConfirm\":\"$PASS\",\"role\":\"$u\",\"name\":\"Sim $u\",\"disabled\":false}"
done
kill $SRV; wait $SRV 2>/dev/null || true
FAIL=0

run_import() {
  sqlite3 "$SB/pb_data/data.db" "DELETE FROM _migrations WHERE file = '1799999990_migrasi_sistem_lama.js'"
  cp "$HERE/import.js" "$SB/pb_migrations/1799999990_migrasi_sistem_lama.js"
  local t0=$(date +%s)
  NB_MIGRASI_DATA="$DATA" PB migrate up
  rm "$SB/pb_migrations/1799999990_migrasi_sistem_lama.js"
  [ -z "$SALES" ] || python3 "$HERE/gen_sales.py" "$SB/pb_data/data.db" "$DATA" || FAIL=1
  echo "import took $(( $(date +%s) - t0 ))s"
}
step "import, run 1"; run_import
step "check, run 1"; python3 "$HERE/check.py" "$SB/pb_data/data.db" "$DATA/expected.json" || FAIL=1
step "import, run 2 (repeat on the same database)"; run_import
step "check, run 2, and compare with live (read-only)"
python3 "$HERE/check.py" "$SB/pb_data/data.db" "$DATA/expected.json" --live "$LIVE/pb_data/data.db" || FAIL=1

step "API and test suites on http://127.0.0.1:$PORT"
"$SB/pocketbase" serve --http 127.0.0.1:$PORT --dir "$SB/pb_data" --hooksDir "$SB/pb_hooks" --migrationsDir "$SB/pb_migrations" --publicDir "$SB/pb_public" > "$SB/serve.log" 2>&1 &
SRV=$!
for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; sleep 0.2; done
export PB="http://127.0.0.1:$PORT" SU_EMAIL=sim@local.test SU_PASS="$PASS" OWNER_USER=simowner OWNER_PASS="$PASS" ADMIN_USER=simadmin KASIR_USER=simkasir
SIM_SALES=$SALES node "$HERE/api-check.mjs" "$DATA/expected.json" || FAIL=1
for t in smoke finance store-smoke preorder; do
  [ -f "$LIVE/tests/$t.mjs" ] || continue
  printf '%-12s ' "$t"; node "$LIVE/tests/$t.mjs" > "$SB/test-$t.log" 2>&1 && tail -1 "$SB/test-$t.log" || { FAIL=1; echo "FAILED, see $SB/test-$t.log"; grep -m5 FAIL "$SB/test-$t.log" || true; }
done
kill $SRV; wait $SRV 2>/dev/null || true; trap - EXIT

if [ -z "$KEEP" ]; then rm -rf "$SB"; echo; echo "sandbox removed"; else echo; echo "sandbox kept at $SB (holds real customer data: remove it when done)"; fi
[ $FAIL = 0 ] && echo "SIMULATION PASSED" || { echo "SIMULATION FAILED"; exit 1; }

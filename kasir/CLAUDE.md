# Nelin Batik — kasir/POS + backend (PocketBase 0.40.4)

Read `~/nelin-store/REPORT.md` first: the full handoff for both apps (they share this database).

## Run & deploy
- systemd `nelin-batik` serves `pb_public/` (the kasir app) on :8090 → https://nelin.necutbarber.shop. No publish step: saving `pb_public/index.html` is live.
- Saving any `pb_hooks/*.js` reloads PocketBase and applies new `pb_migrations/`; a new migration alone waits for that or `pkexec systemctl restart nelin-batik`.
- Route handlers can't see top-level functions of their own `.pb.js` file: helpers go in `lib.js` / `store_lib.js` via ``require(`${__hooks}/lib.js`)``.
- No `Intl` in pb_hooks (use `L.idr()`); read JSON fields with `SL.json(rec, field)`. Root commands: `pkexec …` (sudo can't prompt).
- Before overwriting live files, `cmp` them with `~/mas-alin-project/kasir/…`: other sessions edit these folders too.

## Test on a sandbox copy first (tests create real records)
- Copy the DB: `sqlite3 "file:$PWD/pb_data/data.db?mode=ro" "VACUUM INTO '<sb>/pb_data/data.db'"` (same for `auxiliary.db`), plus `pb_hooks`, `pb_migrations`, `pb_public` and a copy of the `pocketbase` binary.
- Serve it with every path explicit, so nothing defaults to the live `pb_data`: `<sb>/pocketbase serve --http 127.0.0.1:8099 --dir <sb>/pb_data --hooksDir <sb>/pb_hooks --migrationsDir <sb>/pb_migrations --publicDir <sb>/pb_public`. Create test logins with `pocketbase superuser upsert … --dir <sb>/pb_data`.
- Suites: `PB=… SU_EMAIL=… SU_PASS=… node tests/smoke.mjs` (47 checks) and `tests/finance.mjs` (37, same env); `PB=… OWNER_USER=… OWNER_PASS=… node tests/store-smoke.mjs` (22).
- Money changes: compare `/api/reports/cashbook` totals with the old SQL before and after (history must not move).
- Browser checks: headless Chrome over CDP (`google-chrome --headless=new --remote-debugging-port=…`), logged in, at 390/820/1440px, light and dark.
- Back up the live DB before any schema or data change: `sqlite3 "file:$PWD/pb_data/data.db?mode=ro" "VACUUM INTO 'backups/data-before-<what>-<date>.db'"`. Never `cp` the live DB.

## Rules the code relies on
- Till money = `sale_payments` rows (one per method, cash net of change); `sales.paid` = what was kept at the till (the DP for a bon). Bon payments live only in `receivable_payments`: never add them to `sales.paid`, or Buku Kas counts them twice.
- Only Tunai and Transfer are active. Points and vouchers are retired; voiding an old sale still reverses them.
- Prices are decided server-side (`lib.priceCart`): kodian per full 20 pcs (`splitPrice`); `kodian: true` on an item = whole line at the kodian price, owner-only (the cart's "Harga" button); custom unit price (`price`) owner-only, API only.
- Buku Kas / Laporan tables render 200 rows at a time (`CB_PAGE`); never render a whole year of rows at once.
- Swap (tukar barang) = sale `kind: "tukar"` + `ref_sale`; returned lines have negative qty (`tier: "retur"`). A sale with a live swap can't be voided.
- Karyawan per sale: `employee` = id or `"toko"`; required once any karyawan is active.
- The kasir role can't read `receivables` through the records API; staff routes such as `/api/bon/open` serve it.
- The kasir role (one shared login for the karyawan) also gets Pelanggan (no spending), Pesanan Online/Pengiriman (`/api/store/admin` actions ship/resi/ready/complete only) and Stok (`/api/stock/move`). Money decisions stay owner/admin.

## Secrets & privacy
- `ACCOUNTS.md` (mode 600) holds passwords in plain text, without backticks: never print its lines; read values straight into shell variables.
- The GitHub copy is public: no customer/employee names or phone numbers, no business figures, nothing from `ACCOUNTS.md`.

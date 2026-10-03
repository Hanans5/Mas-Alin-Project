# Mas Alin Project: Nelin Batik

Software for **Nelin Batik**, Mas Alin's batik shop at Jl. Gatot Subroto,
Banyurip Alit, Pekalongan. Two parts share one PocketBase database:

| Folder | What it is | Live (demo) address |
|---|---|---|
| [`kasir/`](kasir) | POS / kasir and back office: sales, stock, members and points, vouchers, debts, expenses, reports (Laporan, Laba Rugi, Buku Kas), online-order handling. PocketBase backend with JS hooks, plus a single-page web app. | https://nelin.necutbarber.shop |
| [`toko-online/`](toko-online) | Public online store and home page: live stock, cart, checkout with courier estimates, QRIS/transfer with a unique code, proof upload, WhatsApp confirmation, order tracking. Plain HTML/CSS/JS. | https://toko-nelin.necutbarber.shop |

Read **[`toko-online/REPORT.md`](toko-online/REPORT.md)** first. It's the full
handoff covering how everything runs, the order flow, roles, gotchas and next steps.

## Run it locally

1. Download **PocketBase 0.40.4** for your OS from
   https://github.com/pocketbase/pocketbase/releases and put the `pocketbase`
   binary in `kasir/`.
2. Start it:
   ```bash
   cd kasir
   ./pocketbase serve
   ```
   This creates a new empty `pb_data/`, applies the migrations in
   `pb_migrations/`, and serves the kasir app at http://127.0.0.1:8090.
   Create the first superuser when it asks.
3. Serve `toko-online/public/` from any static server that forwards `/api/` to
   PocketBase (see `toko-online/deploy/nginx-nelin-store.conf`).

## Not in this repository

- **The database** (`pb_data/`) holds real settings and orders. Back it up
  with `sqlite3 "file:pb_data/data.db?mode=ro" "VACUUM INTO 'backup.db'"`.
- **Passwords** are kept only in `ACCOUNTS.md` on the server.
- **The PocketBase binary**: download it as in step 1.

## Updating this repository

The live copies run from `~/nelin-batik` and `~/nelin-store` on the shop's
server. After changing them:

```bash
./sync.sh                 # copy both projects in, without secrets
git add -A && git commit -m "…" && git push
```

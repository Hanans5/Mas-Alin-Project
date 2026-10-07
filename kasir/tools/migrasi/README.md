# Migrasi sistem lama → kasir baru

Rebuilds everything that came from Mas Alin's old system in one transaction:
categories, products with their opening stock, pelanggan, karyawan,
pengeluaran (Tabungan goes to Buku Kas), the old daily sales (`legacy_sales`),
the old totals per pelanggan/karyawan/produk (`legacy_totals`), and the struk
details and logo. Any total that doesn't match `expected.json` stops the import,
and nothing is saved.

The data is private and never goes into git. It lives in
`~/nelin-batik/backups/migrasi-data/` (mode 700): `data-induk.txt`,
`laporan-penjualan.txt`, `total-per-pelanggan-karyawan-produk.txt`,
`logo-struk.png`, `struk-header.txt`, `expected.json`.

| File | What it does |
|---|---|
| `import.js` | The import, as a PocketBase migration. Reads the folder in `NB_MIGRASI_DATA`. |
| `check.py` | PASS/FAIL per total against `expected.json`; `--live <db>` compares with another database, read-only. |
| `api-check.mjs` | The report routes as owner, admin and kasir must show the same totals. |
| `simulate.sh` | The rehearsal: sandbox, import twice, checks, compare with live, test suites, cleanup. |

## Rehearse (safe: sandbox only, live is only read)

```bash
tools/migrasi/simulate.sh ~/nelin-sim fresh   # brand-new database, as on a new server
tools/migrasi/simulate.sh ~/nelin-sim live    # over a snapshot of the live database
```

Add `--keep` to keep the sandbox for a look. It holds real customer data,
so delete it afterwards. The script ends with `SIMULATION PASSED` or `SIMULATION FAILED`.

## On a deploy (new server, before anyone uses the kasir)

The import **replaces** sales, stock history, pelanggan, pengeluaran and Buku Kas
entries. Run it only on a new, empty install, never on a kasir that is already in use.

1. Run the rehearsal there first: `tools/migrasi/simulate.sh ~/nelin-sim fresh`.
2. Stop the service, back up `pb_data`, then:
   ```bash
   cp tools/migrasi/import.js pb_migrations/1799999990_migrasi_sistem_lama.js
   NB_MIGRASI_DATA=$HOME/nelin-batik/backups/migrasi-data ./pocketbase migrate up
   rm pb_migrations/1799999990_migrasi_sistem_lama.js
   python3 tools/migrasi/check.py pb_data/data.db backups/migrasi-data/expected.json
   ```
3. Start the service.

PocketBase records the migration as done; to run it again, delete its row from
`_migrations` first, as `simulate.sh` does.

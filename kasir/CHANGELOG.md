# Nelin Batik kasir: changelog

## 2026-10-08: Tukar barang for the same product
- Swapping a product for the same product (e.g. another size of a model) no longer leaves the stock 1 low: the returned pcs go back on the shelf first, then the new items are checked and taken off. The last pcs on the shelf can now be swapped for itself (the Tukar window counts the returned pcs as available). Test: `tests/swap-same-product.mjs`.

## 2026-10-08: Harga kodian for the kasir
- The kasir login now gets the **Harga** button on cart lines (Kasir and Pre-Order) with **Harga per pcs** and **Harga kodian** only. A product without a kodian price shows Harga kodian greyed out ("Minta pemilik mengisinya di Produk"). Admin gets the same.
- Harga jumbo and Harga kustom stay owner/superadmin only; the server still refuses them for kasir and admin (403).

## 2026-10-08: Harga per pcs, jumbo, kustom
- The owner's **Harga** button on a cart line (Kasir and Pre-Order) offers: **Harga per pcs** (default), **Harga kodian**, **Harga jumbo** (only when the product has one) and **Harga kustom** (type any price per pcs, more than 0). The choice covers the whole line.
- "Otomatis" is gone: there's no more automatic kodian price per 20 pcs. Every line starts at the normal price; kodian is the owner's choice per line.
- **Harga jumbo per pcs**: a new optional product price, set in Produk → Ubah. It shows as "jumbo Rp …" on the product card. Migration `1791200000_price_jumbo`.
- Receipts and nota mark the line "(jumbo)" or "(harga kustom)". The server checks every price; kasir can't pick kodian, jumbo or kustom.

## 2026-10-07 / 08

### Data from the old system
- **Migration tooling** (`tools/migrasi/`): one rerunnable import that rebuilds categories, products with their opening stock, pelanggan, karyawan, pengeluaran (Tabungan goes to Buku Kas), struk details and logo, and kodian prices. It stops on the first total that doesn't match. The private data and the expected totals live outside git (`backups/migrasi-data/`).
- **`simulate.sh`** rehearses the import on a sandbox: it runs the import twice, checks every total, compares the result with live (read-only), then runs the API checks and all test suites. Use it before a deploy to a new server.
- **Old-system history as receipts** (`gen_sales.py`): the old system only exported totals, so the history is rebuilt as receipts numbered like the old system (TRX0001…). They add up exactly per day, pelanggan, karyawan and produk. Real bons keep their own numbers and payments. Each receipt is marked "Sistem lama (rincian disimulasikan)", carries a "sistem lama" badge, and can't be voided or swapped. Stock doesn't move.
- Until the receipts exist, the reports add the old daily and per-pelanggan/karyawan/produk totals, labelled "sistem lama" (tables `legacy_sales`, `legacy_totals`).

### Struk
- The logo sits on top, then the store name in capitals and the header lines from Pengaturan.
- The karyawan line now reads "Staf:".

### Kasir and money
- The payment choice "Pecah pembayaran" is renamed "Split".
- **Buku Kas** is split into Tunai, Transfer and Split sections (a Split section holds a sale paid with both methods). Each section has its own running balance and subtotal, and a TOTAL table sits at the bottom.
- **Kodian prices** can be set per product from the old kasir. Products with no kodian price sell at the normal price only.

### Look
- **Colour theme picker** (Pengaturan → Tampilan): Mahogany (default), Tema awal (the first orange look) and 12 mahogany shades. The owner picks, and it applies to every device. Text colours are computed to stay readable (WCAG AA) in light and dark mode.
- **Logo watermark** in the middle of the screen, very faint and never in the way of clicks. It isn't printed. The owner can switch it on or off for every device.
- The logo appears in the sidebar and top bar.

### Pre-Order (BETA)
- A new menu item under Kasir. The customer pays a DP first: Tunai, Transfer or Split, with a minimum percentage the owner sets (default 30 %). Prices are locked at order time, kodian rules included. Owner and admin can add custom items.
- Statuses: Menunggu → Siap diambil → Selesai, or Batal. Each pre-order prints a "Nota Pre-Order" (print or WhatsApp). The DP can be topped up.
- At pelunasan the goods leave stock and the order becomes a normal sale. The receipt shows the DP, and Buku Kas never counts the DP twice.
- Cancelling is owner/admin only: either the DP is refunded (cash out in Buku Kas) or it is kept (other income in Laba Rugi).
- Dasbor gets a "Pre-order aktif" card, and Laporan a "Pre-Order" tab. Tests: `tests/preorder.mjs`.

### Housekeeping
- `ACCOUNTS.txt` is excluded from sync and git, alongside `ACCOUNTS.md`.

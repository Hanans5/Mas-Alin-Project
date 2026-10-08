# Nelin Batik kasir: changelog

## 2026-10-08: Transaksi search, copyable rows
- Search box in Transaksi: receipt number, pelanggan, karyawan, kasir (not for the kasir login), product on the receipt, or an amount (`56000`, `56.000`, `Rp 56.000`). It searches the chosen period; ✕ clears it. While searching, the cards give way to the number of matches.
- Transaksi rows and the struk text can be selected and copied: dragging over a row selects text instead of opening the struk; a plain click (or Enter) still opens it.

## 2026-10-08: Delete a voided transaction
- Owner and superadmin get a trash icon on BATAL rows in Transaksi (and "Hapus permanen" in a BATAL receipt). It asks twice: "Hapus permanen …?", then the receipt number must be typed before the button unlocks.
- `POST /api/pos/delete/{id}` with `{ confirm: number }` removes the sale, its items, payments and bon rows. A void already took the sale out of stock, Buku Kas and the reports, so nothing moves. Its stock moves stay as the audit trail, and the PocketBase log records who deleted which number. Refused for a sale that isn't voided, old-system and pre-order sales, online-order sales, and a sale another (swap) sale points to. Test `tests/delete-void.mjs`.

## 2026-10-08: Pelanggan "Toko" for walk-in sales; pelanggan password optional
- New pelanggan **Toko** (username `cus0130`, the old system's CUS0130), named in `settings.walkin_customer`. A sale with no pelanggan is booked on Toko, including online orders from an unregistered phone. The kasir can also pick Toko by hand: it's the top row of "Pilih pelanggan". Its password is random, so nobody logs in with it.
- Existing sales and bons without a pelanggan moved to Toko. Money totals didn't move. Laporan Pelanggan and Dasbor say "Toko" instead of "Umum (tanpa member)". The struk prints no "Member:" line for Toko.
- Bon/DP and Pre-Order still need a real pelanggan; the server refuses Toko.
- Adding a pelanggan (Pengguna → Pelanggan, and "+ Daftar member baru" at the Kasir) no longer asks for a password. If it's left blank, a random one is stored. Staff logins still need a password.
- Migration `1791210000_walkin_toko`; test `tests/walkin.mjs`. The migration tools (`import.js`, `rebuild_real.py`, `gen_sales.py`, `add_cashflow_extra.py`, `check.py`) book walk-in receipts on Toko too.

## 2026-10-08: Old-system receipts from the real receipt list
- `tools/migrasi/rebuild_real.py` rebuilds receipts TRX0001… from the old system's Laporan Kas (cashflow page). Every receipt now has its real amount, day, pelanggan and Tunai/Transfer, and bons keep their own data. The items on each receipt, the karyawan and the time are still fitted, so the totals per day, pelanggan, karyawan and produk match the old reports exactly. Only "Sistem lama" receipts are replaced; kasir sales and pre-orders stay. Totals, Buku Kas and Laba Rugi don't move. Rerunnable; run `add_cashflow_extra.py` again afterwards, never `fix_methods.py`.

## 2026-10-08: "Toko" instead of the owner's name on receipts
- A receipt made from an owner login, or with no cashier (old-system receipts), shows "Toko" on screen, in print, on ESC/POS and in Transaksi. Receipts without a karyawan print "Staf: Toko". Internal reports keep the real name.

## 2026-10-08: Superadmin role
- New role `superadmin` with the owner's rights everywhere (hooks map it to owner; API rules allow it). The badge reads "SUPERADMIN". Limits: a superadmin can't edit, disable or delete an owner account, or give anyone the owner or superadmin role. A Superadmin tab sits in Pengguna. Migration `1791180000_superadmin`; tests `tests/superadmin.mjs`.

## 2026-10-08: Kasir sees only this week's Pengeluaran
- The kasir login's Pengeluaran shows "Minggu ini" (Monday to today) only. The records API no longer lists expenses to a kasir; `GET /api/expenses/week` serves them. A kasir can still add one and see what it saved today. Migration `1791190000_kasir_week_expenses`; tests `tests/kasir-expenses.mjs`.

## 2026-10-08: Transaksi per period, Karyawan page
- Transaksi uses the same period chips as Laporan (plus a date range and a karyawan filter). The cards come from `GET /api/tx/summary`; the list loads 100 at a time.
- Sidebar **Karyawan** is its own page: sales per karyawan for a period (Laba for the owner only), a Toko row and a Total. A name opens that karyawan's transactions. Pengguna → Karyawan stays user settings only.

## 2026-10-08: Tunai / Transfer for the old-system history
- From the old system's cashflow page (Laporan Kas, saved privately in `backups/migrasi-data/`): every day up to 7 Okt now has the old system's exact Tunai and Transfer in Buku Kas. The import had booked all old sales as Tunai. Only the payment method of "Sistem lama" receipts changed (`tools/migrasi/fix_methods.py`); amounts, items and totals did not. Two receipts are split over both methods (they show under Split).
- The sales made in the old system after the import (8 Okt) were added as "Sistem lama" receipts with their real number, amount, method and pelanggan; the old return is a manual Buku Kas entry; one old bon payment moved to its cashflow day (`tools/migrasi/add_cashflow_extra.py`).
- Still different from the old cashflow, on purpose (Hanan, 2026-10-08): two bon payments made with the old "U" method count as Tunai in the kasir.

## 2026-10-08: Printer langsung (port COM)
- New print mode in **🖨 Printer**: **Printer langsung (port COM)** sends the ESC/POS struk straight to a COM port through Web Serial (Chrome / Edge on a PC), e.g. a Rongta RPP02N over Bluetooth ("Standard Serial over Bluetooth link", the outgoing port). No driver, no print window. **🔌 Sambungkan printer** grants the port once; Chrome remembers it, so auto-print works.
- ESC/POS struk (port COM and RawBT): the shop name prints double size and bold, TOTAL bold and double height.

## 2026-10-08: Printer struk (USB and Bluetooth)
- **🖨 Printer** button on the Kasir screen (also Pengaturan → Tampilan), saved per device: **Jendela cetak** (PC/laptop, USB printer such as the Blueprint BP-ECO58D, 58 mm) or **Printer Bluetooth (RawBT)** (Android: the struk is sent as ESC/POS through the RawBT app, 32 columns, logo as a 1-bit image, no print window).
- **Cetak struk otomatis setelah bayar** prints right after a sale (checkout, Pre-Order pickup, Tukar); an old struk never prints by itself. **Cetak uji** prints a sample struk.
- PC without the print window: make the struk printer the default printer and start Chrome with `--kiosk-printing`.

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

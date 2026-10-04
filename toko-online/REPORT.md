# Nelin Batik — handoff report

Written 2026-10-04 so the work can continue in a new Claude Code session; the
earlier sessions ran from the NeCut project. Read this first, then
`docs/design-research.md`.

## What this is

Mas Alin owns **Nelin Batik**, a batik shop selling ready-made tunics and
blouses at Jl. Gatot Subroto, Banyurip Alit, Pekalongan. Two projects, one
database:

| Project | Folder | What it is |
|---|---|---|
| Kasir / back office | `~/nelin-batik` | PocketBase backend + kasir/admin web app. Rebuild of his old Laravel system (billing.nelinbatik.my.id). |
| Online store | `~/nelin-store` (this folder) | Public shop: browse live stock, cart, checkout, QRIS/transfer, proof upload, WhatsApp confirm, order tracking. |

Both run on this Debian 13 desktop. It's a **demo for Mas Alin**: payment
details and product photos are placeholders.

## Addresses (temporary, on the NeCut domain)

| | |
|---|---|
| Store | https://toko-nelin.necutbarber.shop |
| Kasir / admin app | https://nelin.necutbarber.shop |
| PocketBase panel | https://nelin.necutbarber.shop/_/ (returns 404 on the store address on purpose) |
| Source code | https://github.com/Hanans5/Mas-Alin-Project (public). `kasir/` and `toko-online/` are copies of `~/nelin-batik` and `~/nelin-store`, without the database, passwords or backups. After a change: `cd ~/mas-alin-project && ./sync.sh && git add -A && git commit -m "…" && git push` |
| Flow charts | https://claude.ai/artifact/MKW4gWxktiNjCuKw5QH57F, source `~/nelin-batik/docs/alur-sistem.html` (not yet updated for the store) |

To move to his own domain:
1. Add the host to `server_name` in both nginx configs.
2. Run `cloudflared --config ~/.cloudflared/home-server.yml tunnel route dns home-server <host>`.

The `--config` part matters: without it cloudflared reads NeCut's `config.yml` and routes the domain to NeCut's tunnel.

## Accounts

Passwords live only in `~/nelin-batik/ACCOUNTS.md` (mode 600). Never copy them
into reports or chat.

- **PocketBase superusers:** `alin@nelinbatik.my.id` (Mas Alin) and `dev@nelinbatik.local` (used by the test scripts).
- **App, role owner:** `alin`. This is the only app account that can log in.
- **Disabled accounts:** test and simulation logins (`dewi`, `rina`, the 40 simulated members, `uji.*`, smoke-test users). They're disabled on purpose because the site is public. Their sales stay in the reports.

## How it runs

```
visitor ─► Cloudflare ─► tunnel "home-server" ─► nginx :80
   toko-nelin.* ─► /var/www/nelin-store (static)  +  /api/ ─► PocketBase
   nelin.*      ─► PocketBase :8090 (pb_public = kasir app)
PocketBase 0.40.4 ─► SQLite ~/nelin-batik/pb_data/data.db
NeCut: its own tunnel "necut" + service on :5000. Separate, don't touch.
```

- **systemd services:** `nelin-batik` (PocketBase), `home-tunnel` (cloudflared) and `nginx`, all enabled.
- **Sleep:** idle suspend on AC is turned off.
- **Root commands:** use `pkexec <script or command>`, which opens a password window. The `!` prompt in Claude Code can't ask for a sudo password.
- **Web root:** `/var/www/nelin-store` is owned by `hanan`, so publishing needs no sudo. The home folder is 700, so nginx can't read it directly.

## The store (`~/nelin-store`)

```
public/index.html   page shell
public/styles.css   design tokens + layout (phone first, light + dark)
public/app.js       hash-routed app
public/motifs.js    canvas batik illustrations (product image fallback; motifOf() drives the motif collections)
deploy/             nginx-nelin-store.conf, install.sh (one-time, pkexec), publish.sh
docs/design-research.md   reference sites + UX research behind the design
```

**Publish a change:** edit `public/`, then run `~/nelin-store/deploy/publish.sh`. It syntax-checks the JS and copies the files to `/var/www/nelin-store`.

**Pages:**
- `#/`: the home page, top to bottom:
  1. **Header, modelled on bateeq.com:** a dark utility strip (location, opening hours, "Kirim ke seluruh Indonesia", Instagram and WhatsApp icons) that scrolls away. Below it, a sticky bar with the logo, a spaced-capitals menu (Beranda · Koleksi · Produk · Cerita · Kunjungi toko · Pesanan saya), and the search and cart icons. The menu jumps to sections of the home page and highlights the one in view. Below 1024px it collapses into a ☰ dropdown. Scroll restoration is manual (`history.scrollRestoration`), because the browser's own restoring fought the section jumps.
  2. **Campaign hero (bateeq):** full width, with a heavy indigo wash over the motif and the collection name very large in white, centred. The hang tag sits bottom-left. Set `CONTENT.campaign.photo` to a wide photo URL and it replaces the motif, with a lighter wash.
  3. **"Pilih dari motifnya" band (bateeq "Latest collections"):** a night-indigo band of five edge-to-edge motif tiles, with the model count, name and note centred. They swipe on phones and filter the product grid.
  4. **"Paling laris" rail:** real best sellers from sales data.
  5. **"Semua produk" grid:** category tabs, search, sort, live stock, real "terjual" counts, and a "Sisa N" flag when stock is low.
  6. **"Cerita kami" (bateeq "Our story"):** an oversized headline on white, beside an image.
  7. **Mosaic (bateeq gallery):** a big tile for the largest category, a wide one for the next, and small ones for "Datang ke toko" and Instagram.
  8. **WhatsApp band** in the place of bateeq's newsletter band: a full-width motif with "Tanya dulu lewat WhatsApp".
  9. **Instagram strip.**
  10. **"Datang ke toko":** address, hours, open/closed now, a Google Maps link, WhatsApp, and payment and courier badges.
  11. **Footer (bateeq):** night indigo, four columns (shop, contact, payment and shipping, consumer complaints), then a copyright strip.

  The structure was taken from bateeq.com, HIJUP and Zoya, which were studied top to bottom (see `docs/design-research.md`).
- `#/p/{id}`: product page with quantity, add to cart / buy now, shipping estimate by province, and a buy bar pinned to the bottom on phones.
- `#/checkout`: one page in three steps (Penerima, Pengiriman, Cara bayar), with guest checkout and the form remembered on the device.
- `#/pesanan`: orders placed from this device.
- `#/pesanan/{number}/{token}`: pay, upload proof, confirm on WhatsApp, track, cancel.

**Order flow:**
1. **Order placed:** stock is reserved immediately (stock move `pesanan`). Status is `menunggu_bayar` with a 24-hour deadline, and a unique code of Rp101–499 is added to the total.
2. **Customer pays:** they pay, upload proof (status becomes `menunggu_verifikasi`) and tap "Konfirmasi lewat WhatsApp". Email is sent too when SMTP is configured.
3. **Admin checks:** in the kasir app under **Pesanan Online**, the admin can correct the shipping cost, then confirm payment with a deliberate second tap. Confirming creates a normal sale (status `diproses`), so it appears in Laporan, Laba Rugi and Buku Kas. A member whose phone number matches earns points.
4. **Fulfilment:** either `dikirim` with a tracking number, or `siap_diambil` for pickup. Then `selesai`.
5. **Expiry and cancellation:** unpaid orders expire after 24 hours through a cron job every 5 minutes, and their stock comes back. A customer can cancel while unpaid. The admin can cancel before shipping, which returns the stock and voids the sale.

**Order tracking (added 2026-10-04):**
- Every web order has `track`, an 8-character code without look-alikes (no 0/O, 1/I/L), made with crypto randomness and unique. The buyer's link is `toko…/t/{code}`.
- `/t/{code}` is a **tracker-only page**: status, a four-step bar with times, courier and resi (Salin, "Cek posisi paket" via cekresi.com), parcel contents and history. It hides the shop's menus and refreshes every minute. The public API `GET /api/store/track/{code}` returns only first name, city, items, courier, resi and history: no phone, street, prices, payment details or staff names.
- The shop menu item "Lacak pesanan" (`#/pesanan`) has a box for a code or pasted link, then the orders made on this device. The order page shows the tracking link, and the buyer's WhatsApp to the shop carries the tracking link plus "Untuk admin: {pos_url}/#/o/{number}" instead of the secret order link.
- Kasir app: the **Pengiriman** menu (owner and admin) has the groups Perlu dikirim, Dalam perjalanan, Ambil di toko and Selesai, with search. Type the resi and press Kirim, and a pop-up offers the WhatsApp to the buyer with the resi and tracking link. Each order also has "WhatsApp pembeli", "Salin link lacak", "Paket diterima" and Detail. A shipped order's resi can be corrected (action `resi`).
- Links like `nelin…/#/o/WEB-…` open that order in the kasir app after login.
- The two base addresses are in Pengaturan → Toko Online ("Alamat toko online", "Alamat aplikasi kasir"; settings `store_url`, `pos_url`). Change them there when moving to Mas Alin's domain.
- Migration `1791070000_order_tracking.js`; the database backup from before it is `~/nelin-batik/backups/data-before-tracking-20261004-0713.db`.
- The store's `index.html` loads `/styles.css`, `/motifs.js` and `/app.js` from the root (so `/t/…` works), and `publish.sh` stamps them with `?v=<hash>`.

**Shipping:** couriers are J&T EZ, JNE REG and YES, Ninja Xpress, SiCepat and AnterAja, plus pickup at the shop. Costs are an **estimate** from a zone table in `~/nelin-batik/pb_hooks/store_lib.js`: six zones from Pekalongan, by province, per kg with a 0.3 kg tolerance, using each product's `weight` (default 250 g). The admin rechecks over WhatsApp. For live rates, replace `estimateShipping()` with a call to Biteship or RajaOngkir; both need a paid API key.

**Store API** (in `~/nelin-batik/pb_hooks/store.pb.js`):
- **Public:**
  - `GET /api/store/catalog`: products without cost prices, plus store info.
  - `GET /api/store/shipping?province=&weight=`
  - `POST /api/store/orders`: limited to 6 per IP per 15 minutes, and at most 3 open orders per phone number.
- **Customer** (number + secret token): `GET /api/store/orders/{no}?t=`, plus `POST …/proof` (multipart) and `POST …/cancel`.
- **Staff** (owner/admin): `POST /api/store/admin/{id}/{shipping|confirm|reject|ship|ready|complete|cancel}`.

**Design:**
- **Colours:** Pekalongan pesisiran (coastal batik) colours. Indigo for text, tosca for the main action, yellow hang tags for prices, a celadon page background.
- **Type:** Gloock for the display text and Plus Jakarta Sans for everything else.
- **Product images:** canvas illustrations of Jlamprang (Pekalongan's own motif), Parang, Kawung, Mega Mendung and Truntum. The motif and colours are picked from the SKU number, so neighbouring products always differ. Each is labelled "Ilustrasi motif …, foto produk asli menyusul". An uploaded product photo replaces it automatically. Images are 4:5 so photos of tunics fit uncropped.
- **Indonesian shop conventions:** a floating WhatsApp button, the "terjual" counts, a unique code on transfers, and a Layanan Pengaduan Konsumen block in the footer.

**Heatmaps:** Microsoft Clarity is built in and **off** until a project ID is entered in kasir app → Pengaturan → Toko Online. Get a free ID at clarity.microsoft.com. Clarity masks typed text by default. Consider a short cookie/privacy note before turning it on with real customers.

## The kasir app and backend (`~/nelin-batik`)

```
pb_migrations/  init_schema, admin_sees_kasir, owner_manages_users, web_store, store_clarity
pb_hooks/       lib.js (WIB dates, moveStock, priceCart, vouchers, idr())
                pos.pb.js (preview, checkout, void) · stock.pb.js (stock move, debt payment)
                reports.pb.js (dashboard, sales, profit-loss, cashbook)
                store.pb.js + store_lib.js (online store API, expiry cron)
pb_public/index.html   the whole kasir/admin app
tests/          smoke.mjs (36 checks) · store-smoke.mjs (21 checks) · simulate*.mjs (demo data)
deploy/         systemd units, nginx vhost, installers
docs/alur-sistem.html  flow charts
backups/        database snapshot from before the simulation
```

**Roles** (enforced on the server; everyone logs in with a username):

| Role | Access |
|---|---|
| owner | everything |
| admin | everything except Laba Rugi, Buku Kas, managing users, and shop settings |
| kasir | POS, their own sales today |
| pelanggan | their own purchases, points and debts |

**Owner tabs:**
- Dasbor, Kasir, Transaksi, Pesanan Online
- Produk (photo, description, weight, hide-from-shop), Stok
- Keuangan (Pengeluaran, Piutang, Laba Rugi, Buku Kas)
- Laporan (CSV export, A4 print, 1/3/6-month buttons)
- Pengguna
- Pengaturan (Toko & Struk, Toko Online, Metode Bayar, Poin Member, Voucher)

**Rules that keep the books right:**
- Sales, stock moves, debt payments and web-order state changes are written only by routes, each inside one transaction.
- Prices always come from the database, never from the browser.
- Buku Kas is calculated each time it's opened. Laba Rugi uses the cost price saved with each sale.
- All dates are WIB (UTC+7).

**Gotchas:**
- PocketBase's JS engine has no `Intl`, so `toLocaleString("id-ID")` crashes inside `pb_hooks`. Use `L.idr()`.
- Read JSON fields with `SL.json(rec, field)`, not `rec.get()`.
- Saving a file in `pb_hooks` reloads the server and applies new migrations by itself. If you run `./pocketbase migrate up` by hand on the live database, run `pkexec systemctl restart nelin-batik` afterwards, because collection rules are cached.
- Never `cp` the live database. Back it up with `sqlite3 "file:…/data.db?mode=ro" "VACUUM INTO '…'"`.

## Demo data (keep it; it's what Mas Alin is shown)

- **Products:** 10, with his real prices and cost prices (HPP).
- **Simulation (5 Apr – 3 Oct 2026):** 3,732 sales by kasirs Dewi and Rina, 40 members, vouchers, debts, restocks and expenses. The expenses are invented.
- **6-month totals:** omzet Rp 515,7 juta, gross margin 11,5 %, net profit about Rp 2,5 juta.
- **Test web orders:** a handful from the test runs.
  - WEB-261004-004 went through the whole flow in the browser and is now `dikirim`.
  - One order left by a crashed test will expire on its own and return its stock.
- **Do not wipe** without asking the user.

## Placeholders and next steps

0. **Dummy home-page text:** everything in the `CONTENT` object at the top of `public/app.js` is placeholder for Mas Alin to replace. That covers the announcement text, the campaign name and sentence ("Koleksi Pesisir 2026 · Jlamprang"), the collection notes, the "Cerita kami" story, and the Instagram handle (@nelinbatik.official, taken from his receipt header). The Instagram tiles are motif illustrations, not his real posts. Customer testimonials are deliberately left out until there are real ones.

1. **Payment details:** the bank account is "BCA (CONTOH)" and there's no QRIS, so the order page warns "jangan transfer". Fill in the real details under Pengaturan → Toko Online. The warning disappears once the account holder's name no longer contains "contoh".
2. **WhatsApp number:** 0895422763568, taken from his old receipt header. Confirm it with Mas Alin.
3. **Product photos:** upload them in Produk → Ubah. A 4:5 portrait shape suits the layout best.
4. **Sizes and colours:** products have no variants yet. Tunics usually come in M/L/XL/Jumbo, so add a variants model when he confirms how he stocks sizes.
5. **Shipping rates:** add a Biteship or RajaOngkir API key to get live rates.
6. **Email:** configure SMTP in `/_/` → Settings → Mail. Until then, status emails are skipped without error.
7. **Logo:** there's no upload for it in Pengaturan yet; use `/_/` for now.
8. **Complaints block:** the Ministry of Trade complaints WhatsApp number in the footer (0853 1111 1010) should be checked against Kemendag's current listing.
9. **Hosting:** PocketBase needs a VPS or PocketHost and won't run on PHP-only shared hosting. Mas Alin's hosting type is still unknown.
10. **Flow chart:** update the artifact to include the online-store flow.
11. **Design leftovers** (see the status table in `docs/design-research.md`): real payment logos instead of text chips, "stok sama dengan toko" in the announcement bar, and regrouping collections by real motif once photos exist.

## Health check

```bash
systemctl is-active nelin-batik home-tunnel nginx
cd ~/nelin-batik
SU_EMAIL=dev@nelinbatik.local SU_PASS=… node tests/smoke.mjs      # 36 checks, kasir/roles
OWNER_PASS=… node tests/store-smoke.mjs                           # 21 checks, online store
curl -s https://toko-nelin.necutbarber.shop/api/store/catalog -o /dev/null -w '%{http_code}\n'
```

Both test suites create real records and then disable the accounts they create.

## Skills

`~/.claude/skills/frontend-design` is Anthropic's official design skill, installed for this project. Load it before any visual changes.

## Related, not part of this project

**NeCut** (`~/necut`, `~/necut-dev`) is the barbershop app on the same machine. Its short WhatsApp admin link change (`#admin?order=<id>`) is tested in dev but **not deployed**. Deploy it with `pkexec ~/necut/scripts/deploy.sh` once the user agrees.

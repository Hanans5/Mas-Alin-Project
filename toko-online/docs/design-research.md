# Design research — Nelin Batik online store

Researched 2026-10-04 in Chrome. The goal: a shop that looks made by a person
for this particular batik shop, not a template, while following the habits
Indonesian buyers already have from big fashion sites and marketplaces.

## About "1000 sites" and heatmaps

- Studying 1000 sites isn't practical, and past ~20 the patterns repeat. The
  sites below cover the three groups that matter: big fashion brands,
  Indonesian fashion/batik brands, and the marketplaces his buyers use daily.
- Real heatmaps (click/scroll maps) are private to each company's analytics,
  so they can't be viewed for other brands. What stands in for them:
  1. Published e-commerce UX research (Baymard Institute, Nielsen Norman
     Group). The findings that matter here are listed below.
  2. **Real heatmaps of Nelin Batik's own shop**: add Microsoft Clarity (free,
     unlimited) once real customers arrive. One script tag; see "Next steps"
     in REPORT.md. That would show Mas Alin where *his* buyers tap and stop.

## Sites studied

| Site | Reached? | What to take |
|---|---|---|
| Tokopedia (search "tunik batik pekalongan") | yes | Square photo, bold price, "X terjual", seller city, rating, discount badge. Buyers scan price + sold count first. **Applied:** price tag, real "terjual" counts, low-stock flag. |
| Zalora Indonesia | yes | Apparel photos in **portrait 3:4**, not square; one-line truncated name; price in bold accent; wishlist heart; top strip with 3 benefits (returns / delivery / app). |
| Buttonscarves (ID premium modest) | yes | Floating **WhatsApp button** bottom-right on every page; category tiles; trust strip (materials, loyalty points, shipping, payment options); payment-logo row (BCA, Mandiri, BNI, QRIS, e-wallets); **"Layanan Pengaduan Konsumen"** block (Kemendag consumer-complaint contact), which Indonesian online shops show as standard. |
| Bateeq (modern ID batik) | yes | Collections named after the fabric/motif + year (Lurik 2025, Asmaraloka 2026); editorial photography; top bar with address + email. |
| Batik Keris | yes | Dated lookbook layout; product buying is buried. Example of what not to do. |
| Danar Hadi | no (certificate error) | — |
| Uniqlo ID, COS | no (block automated browsers) | — |

## UX research findings used (Baymard / NN/g, summarised)

1. Product photo is looked at first, then price, then social proof (sold count / rating).
2. Showing exact stock when low ("Sisa 8") raises conversion; showing "out of stock" items last keeps the first screen buyable.
3. Shipping cost surprise at checkout is the #1 cause of abandoned carts, so show an estimate **on the product page** (done: "Cek ongkir").
4. Guest checkout (no account) converts better than forced sign-up (done: name + WhatsApp only).
5. Single-page checkout with clearly numbered steps works best on phones (done: Penerima → Pengiriman → Cara bayar).
6. A sticky total + action bar at the bottom on mobile (done).
7. After payment, a status timeline + "what happens next" reduces "sudah dikirim belum?" messages (done: order tracker + history).

## Design direction (as built)

- **Memorable element:** product images are drawn as real Pekalongan batik
  motifs (Jlamprang, Parang, Kawung, Mega Mendung, Truntum) in coastal
  *pesisiran* colours until real photos are uploaded, plus a **yellow hang
  tag** carrying the price, like the paper tags in the shop.
- **Colour:** indigo text, tosca for the one main action, celadon page, yellow tag, rose only for "running out".
- **Type:** Gloock (display, sparingly) + Plus Jakarta Sans (body; designed for Jakarta).
- **Phone first:** products in the first screen; the shop intro is two sentences, not a banner.

## Recommended refinements: status (checked against the code 2026-10-04)

| # | Refinement | Status |
|---|---|---|
| 1 | **Portrait 4:5** product images (Zalora standard) | Done. All product images are 4:5, illustrations included (`.swatch` in `styles.css`). |
| 2 | **Floating WhatsApp button** (Buttonscarves pattern) | Done (`#waFab`; it moves up above the buy bar on product pages). |
| 3 | **Payment row** + **Layanan Pengaduan Konsumen** block | Done. Payment and courier names show as text chips in "Datang ke toko"; the complaints block is in the footer. Still open: swap the chips for real logos, and trim the list to the banks Mas Alin actually uses once they're known. |
| 4 | **Benefit strip**: "Kirim dari Pekalongan · Bayar QRIS/transfer · Stok sama dengan toko" | Partly. The announcement bar carries the first two; "stok sama dengan toko" is only in "Cerita kami". Add it to `CONTENT.announce` if wanted. |
| 5 | **Motif collections** (Bateeq pattern) | Done, driven by `motifOf()` from the SKU. Regroup by the real motif once photos exist. |
| 6 | **Microsoft Clarity** heatmaps | Built, off until a project ID is set in kasir app → Pengaturan → Toko Online. |

## Round 2 — whole pages, top to bottom (2026-10-04)

| Site | Structure, top → bottom | Taken for Nelin |
|---|---|---|
| bateeq.com | Full-bleed campaign hero (collection name huge) → 3 collection tiles (name + year) → Our Story → news → Instagram grid → black footer + newsletter. Shop lives on a separate site. Has a broken empty gap under Our Story. | Campaign hero with oversized collection name; collections by motif; "Cerita kami"; Instagram strip. Skipped: news, newsletter. |
| hijup.com | Promo carousel → brand logos → category icons → "Produk Terbaru" rail → "Produk Terpopuler" rail → 2 campaign banners → articles → Offline Stores block → footer (help hours, WhatsApp) → payment + courier logo row. | Best-seller rail, category shortcuts, "Datang ke toko" block, payment/courier badges. |
| zoya.co.id | Red announcement bar → campaign banner with voucher → 3 shortcuts → category tiles with text over photos → one long grid with sort. | Thin announcement bar. Avoided: text laid over busy photos. |
| sejauhmatamemandang.com | Domain doesn't resolve. | — |

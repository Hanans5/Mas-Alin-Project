/// <reference path="../pb_data/types.d.ts" />

// POST /api/pos/checkout — the only way a sale is created.
// Body: {
//   items: [{ product, qty, tier?, price? }] prices come from the database;
//                                    tier normal (default) / kodian / jumbo / kustom
//                                    (+ price per pcs); all but normal owner only
//   customer?: user id (role pelanggan)
//   discount?: rupiah                manual discount — owner/admin only
//   payments: [{ method, amount }]   Tunai and/or Transfer; change only from cash
//   (legacy: payment_method + paid = one payment)
//   employee: id                     karyawan who served (required once any is active)
//   credit?: bool                    true = the unpaid rest is a bon (DP = what was paid)
//   due_date?: "YYYY-MM-DD"          for the bon
//   note?: string
// }
routerAdd("POST", "/api/pos/checkout", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  let saleId = "";
  e.app.runInTransaction((tx) => {
    const { lines, subtotal, discount, total, customer } = L.priceCart(tx, e, b);
    const employee = L.pickEmployee(tx, b.employee);

    // Money in: one or more payments (Tunai + Transfer); change only from cash.
    // Short = bon/DP, only when asked for (credit) and on a named customer.
    const pay = L.takePayments(tx, b, total);
    if (!pay.rows.length && !b.credit && total > 0) throw new BadRequestError("Isi jumlah bayar, atau jadikan bon.");
    let status = "lunas";
    if (pay.short) {
      if (!b.credit) throw new BadRequestError(`Uang kurang Rp ${L.idr(pay.short)}.`);
      if (!customer || customer.id === L.walkinId(tx)) throw new BadRequestError("Bon/DP harus atas nama pelanggan.");
      status = "piutang";
    }
    if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date))) throw new BadRequestError("Tanggal jatuh tempo tidak valid.");
    const main = pay.rows.slice().sort((x, y) => y.amount - x.amount)[0];

    const sale = new Record(tx.findCollectionByNameOrId("sales"));
    sale.load({
      number: L.nextSaleNumber(tx), cashier: e.auth.id, customer: customer ? customer.id : "",
      subtotal, discount, voucher: "", points_used: 0,
      total, paid: pay.kept, change: pay.change, payment_method: main ? main.pm.id : "", status, points_earned: 0, kind: "jual", employee,
      note: String(b.note || "").slice(0, 300),
    });
    tx.save(sale);
    saleId = sale.id;

    const payCol = tx.findCollectionByNameOrId("sale_payments");
    for (const r of pay.rows) {
      const sp = new Record(payCol);
      sp.load({ sale: sale.id, payment_method: r.pm.id, amount: r.amount, by: e.auth.id });
      tx.save(sp);
    }

    const itemsCol = tx.findCollectionByNameOrId("sale_items");
    for (const l of lines) {
      const r = new Record(itemsCol);
      r.load({ sale: sale.id, product: l.p.id, name: l.p.getString("name"), qty: l.qty, price: l.price, hpp: l.hpp, subtotal: l.subtotal, tier: l.tier });
      tx.save(r);
      L.moveStock(tx, { product: l.p, type: "penjualan", qty: -l.qty, ref: sale.getString("number"), by: e.auth.id });
    }

    if (status === "piutang") {
      const rc = new Record(tx.findCollectionByNameOrId("receivables"));
      rc.load({ sale: sale.id, customer: customer.id, amount: total - pay.kept, paid: 0, status: "belum", due_date: b.due_date ? b.due_date + " 00:00:00.000Z" : "" });
      tx.save(rc);
    }
  });

  const sale = e.app.findRecordById("sales", saleId);
  e.app.expandRecord(sale, ["payment_method", "customer", "cashier", "employee"], null);
  const items2 = e.app.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: saleId });
  const pays2 = e.app.findRecordsByFilter("sale_payments", "sale = {:s}", "created", 0, 0, { s: saleId });
  e.app.expandRecords(pays2, ["payment_method"], null);
  return e.json(200, { sale, items: items2, payments: pays2 });
}, $apis.requireAuth("users"));

// POST /api/pos/preview — same body as checkout, nothing saved. Returns the
// totals the till should show, so voucher/points/discount errors surface
// before the customer pays.
routerAdd("POST", "/api/pos/preview", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  const c = L.priceCart(e.app, e, b);
  return e.json(200, {
    lines: c.lines.map((l) => ({ product: l.p.id, qty: l.qty, price: l.price, tier: l.tier, subtotal: l.subtotal })),
    subtotal: c.subtotal, discount: c.discount, total: c.total, points_used: c.pointsUsed,
    voucher_discount: c.voucherDiscount, points_discount: c.pointsDiscount,
  });
}, $apis.requireAuth("users"));

// POST /api/pos/void/{id} — cancel a sale: stock back, points reversed,
// voucher use returned, open debt closed. Owner/admin only. Body: { reason }
routerAdd("POST", "/api/pos/void/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const reason = String((e.requestInfo().body || {}).reason || "").trim();
  if (!reason) throw new BadRequestError("Isi alasan pembatalan.");

  e.app.runInTransaction((tx) => {
    let sale;
    try { sale = tx.findRecordById("sales", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Transaksi tidak ditemukan."); }
    if (sale.getString("status") === "batal") throw new BadRequestError("Transaksi sudah dibatalkan.");
    if (L.isLegacySale(sale)) throw new BadRequestError("Transaksi sistem lama tidak bisa dibatalkan.");
    if (sale.getString("preorder")) throw new BadRequestError("Transaksi dari pre-order tidak bisa dibatalkan; DP-nya sudah tercatat di Buku Kas.");
    const number = sale.getString("number");
    // Its returned items are already back on the shelf through the swap.
    const swaps = tx.findRecordsByFilter("sales", "ref_sale = {:s} && status != 'batal'", "", 0, 0, { s: sale.id });
    if (swaps.length) throw new BadRequestError(`Batalkan dulu transaksi tukar ${swaps.map((x) => x.getString("number")).join(", ")}.`);

    for (const it of tx.findRecordsByFilter("sale_items", "sale = {:s}", "", 0, 0, { s: sale.id })) {
      L.moveStock(tx, { product: it.getString("product"), type: "batal", qty: it.getInt("qty"), ref: number, note: reason, by: e.auth.id });
    }

    const cid = sale.getString("customer");
    if (cid) {
      const c = tx.findRecordById("users", cid);
      // Take back what this sale earned (including points earned later when
      // its debt was paid), return what it spent. Never below zero.
      c.set("points", Math.max(0, c.getInt("points") - sale.getInt("points_earned") + sale.getInt("points_used")));
      tx.save(c);
    }
    const vid = sale.getString("voucher");
    if (vid) {
      const v = tx.findRecordById("vouchers", vid);
      v.set("used", Math.max(0, v.getInt("used") - 1));
      tx.save(v);
    }
    for (const rc of tx.findRecordsByFilter("receivables", "sale = {:s}", "", 0, 0, { s: sale.id })) {
      rc.set("status", "batal");
      tx.save(rc);
    }

    sale.set("status", "batal");
    sale.set("note", (sale.getString("note") ? sale.getString("note") + " | " : "") + "BATAL: " + reason);
    tx.save(sale);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ── tukar barang (item swap) ────────────────────────
// Returned goods go back on the shelf, new goods leave it, and the buyer
// pays any difference. Swaps only: the new goods must be worth at least as
// much as the returned ones (no money back), per Mas Alin.

// GET /api/pos/swap/{key} — a sale (by number or id) and what can be swapped.
routerAdd("GET", "/api/pos/swap/{key}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const sale = L.findSale(e.app, e.request.pathValue("key"));
  if (L.isLegacySale(sale)) throw new BadRequestError("Transaksi sistem lama tidak bisa ditukar.");
  if (sale.getString("status") === "batal") throw new BadRequestError("Transaksi ini sudah dibatalkan.");
  if (sale.getString("kind") === "tukar") throw new BadRequestError("Ini transaksi tukar. Tukar dari transaksi penjualan aslinya.");
  e.app.expandRecord(sale, ["customer"], null);
  const c = sale.expandedOne("customer");
  return e.json(200, {
    id: sale.id, number: sale.getString("number"), created: sale.getString("created"), total: sale.getInt("total"),
    customer: c ? (c.getString("name") || c.getString("username")) : "",
    items: L.returnable(e.app, sale),
  });
}, $apis.requireAuth("users"));

// POST /api/pos/swap — body: { sale, returns:[{product, qty}], items:[{product, qty, price?}],
//   payment_method?, paid?, note?, employee }
routerAdd("POST", "/api/pos/swap", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  let saleId = "";
  e.app.runInTransaction((tx) => {
    const orig = L.findSale(tx, b.sale);
    if (L.isLegacySale(orig)) throw new BadRequestError("Transaksi sistem lama tidak bisa ditukar.");
    if (orig.getString("status") === "batal") throw new BadRequestError("Transaksi asli sudah dibatalkan.");
    if (orig.getString("kind") === "tukar") throw new BadRequestError("Tukar dari transaksi penjualan aslinya.");
    const can = {};
    for (const r of L.returnable(tx, orig)) can[r.product] = r;

    const back = [];
    let backValue = 0;
    for (const r of Array.isArray(b.returns) ? b.returns : []) {
      const q = L.int(r.qty, "Qty kembali");
      if (q < 1) continue;
      const c = can[r.product];
      if (!c) throw new BadRequestError("Barang yang dikembalikan tidak ada di transaksi ini.");
      if (q > c.left) throw new BadRequestError(`${c.name}: maksimal ${c.left} pcs bisa ditukar.`);
      back.push({ ...c, qty: q });
      backValue += c.price * q;
    }
    if (!back.length) throw new BadRequestError("Pilih barang yang dikembalikan.");
    const employee = L.pickEmployee(tx, b.employee);

    // Returned pcs go back on the shelf first, so the new items are priced and
    // stock-checked against the stock after the return. Swapping a product
    // for the same one (another size of a model) then lands on the right
    // count, and the last pcs on the shelf can be swapped for itself.
    const number = L.nextSaleNumber(tx);
    for (const r of back) {
      L.moveStock(tx, { product: r.product, type: "retur", qty: r.qty, ref: number, note: "Ditukar dari " + orig.getString("number"), by: e.auth.id });
    }

    const cart = L.priceCart(tx, e, { items: b.items });
    const diff = cart.subtotal - backValue;
    if (diff < 0) throw new BadRequestError(`Barang baru (Rp ${L.idr(cart.subtotal)}) lebih murah dari barang yang dikembalikan (Rp ${L.idr(backValue)}). Tukar hanya untuk barang senilai atau lebih mahal; tambah barang atau pilih yang lain.`);

    // The difference is paid in full (no bon on a swap), same rules as checkout.
    const pay = diff > 0 ? L.takePayments(tx, b, diff) : { rows: [], kept: 0, change: 0, short: 0 };
    if (diff > 0 && !pay.rows.length) throw new BadRequestError("Pilih metode pembayaran untuk selisih.");
    if (pay.short) throw new BadRequestError(`Uang kurang Rp ${L.idr(pay.short)}.`);
    const main = pay.rows.slice().sort((x, y) => y.amount - x.amount)[0];

    const sale = new Record(tx.findCollectionByNameOrId("sales"));
    sale.load({
      number, cashier: e.auth.id, customer: orig.getString("customer"),
      subtotal: diff, discount: 0, points_used: 0, total: diff, paid: pay.kept, change: pay.change,
      payment_method: main ? main.pm.id : "", status: "lunas", points_earned: 0, kind: "tukar", ref_sale: orig.id, employee,
      note: (`Tukar dari ${orig.getString("number")}` + (b.note ? " | " + String(b.note) : "")).slice(0, 300),
    });
    tx.save(sale);
    saleId = sale.id;
    for (const r of pay.rows) {
      const sp = new Record(tx.findCollectionByNameOrId("sale_payments"));
      sp.load({ sale: sale.id, payment_method: r.pm.id, amount: r.amount, by: e.auth.id });
      tx.save(sp);
    }
    const ic = tx.findCollectionByNameOrId("sale_items");
    for (const r of back) {
      const it = new Record(ic);
      it.load({ sale: sale.id, product: r.product, name: r.name, qty: -r.qty, price: r.price, hpp: r.hpp, subtotal: -r.price * r.qty, tier: "retur" });
      tx.save(it);
    }
    for (const l of cart.lines) {
      const it = new Record(ic);
      it.load({ sale: sale.id, product: l.p.id, name: l.p.getString("name"), qty: l.qty, price: l.price, hpp: l.hpp, subtotal: l.subtotal, tier: l.tier });
      tx.save(it);
      L.moveStock(tx, { product: l.p.id, type: "penjualan", qty: -l.qty, ref: number, note: "Tukar " + orig.getString("number"), by: e.auth.id });
    }
  });
  const sale = e.app.findRecordById("sales", saleId);
  e.app.expandRecord(sale, ["payment_method", "customer", "cashier", "ref_sale", "employee"], null);
  const items2 = e.app.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: saleId });
  return e.json(200, { sale, items: items2 });
}, $apis.requireAuth("users"));

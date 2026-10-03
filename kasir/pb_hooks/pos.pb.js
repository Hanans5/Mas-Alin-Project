/// <reference path="../pb_data/types.d.ts" />

// POST /api/pos/checkout — the only way a sale is created.
// Body: {
//   items: [{ product, qty }],       prices come from the database, not the client
//   customer?: user id (role pelanggan)
//   voucher_code?: string
//   discount?: rupiah                manual discount — owner/admin only
//   points_used?: int                redeem the customer's points
//   payment_method: id
//   paid: rupiah                     what was handed over now
//   credit?: bool                    true = the unpaid rest becomes piutang
//   due_date?: "YYYY-MM-DD"          for piutang
//   note?: string
// }
routerAdd("POST", "/api/pos/checkout", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  let saleId = "";
  e.app.runInTransaction((tx) => {
    const { lines, subtotal, discount, total, customer, voucher, pointsUsed, settings: s } = L.priceCart(tx, e, b);

    let pm;
    try { pm = tx.findRecordById("payment_methods", b.payment_method); } catch (_) { throw new BadRequestError("Pilih metode pembayaran."); }
    if (!pm.getBool("active")) throw new BadRequestError("Metode pembayaran tidak aktif.");

    const handed = L.int(b.paid || 0, "Bayar");
    if (handed < 0) throw new BadRequestError("Bayar tidak boleh minus.");
    let paid, change, status;
    if (handed >= total) {
      paid = total; change = handed - total; status = "lunas";
    } else {
      if (!b.credit) throw new BadRequestError(`Uang kurang Rp ${L.idr(total - handed)}.`);
      if (!customer) throw new BadRequestError("Piutang harus atas nama pelanggan.");
      paid = handed; change = 0; status = "piutang";
    }

    // Points are earned on what was actually paid at the till; a debt earns
    // its points when it's paid off (see /api/receivables/pay in stock.pb.js).
    const per = s.getInt("points_per_rupiah");
    const earned = customer && per > 0 ? Math.floor(paid / per) : 0;

    const sale = new Record(tx.findCollectionByNameOrId("sales"));
    sale.load({
      number: L.nextSaleNumber(tx), cashier: e.auth.id, customer: customer ? customer.id : "",
      subtotal, discount, voucher: voucher ? voucher.id : "", points_used: pointsUsed,
      total, paid, change, payment_method: pm.id, status, points_earned: earned,
      note: String(b.note || "").slice(0, 300),
    });
    tx.save(sale);
    saleId = sale.id;

    const itemsCol = tx.findCollectionByNameOrId("sale_items");
    for (const l of lines) {
      const r = new Record(itemsCol);
      r.load({ sale: sale.id, product: l.p.id, name: l.p.getString("name"), qty: l.qty, price: l.price, hpp: l.hpp, subtotal: l.subtotal });
      tx.save(r);
      L.moveStock(tx, { product: l.p, type: "penjualan", qty: -l.qty, ref: sale.getString("number"), by: e.auth.id });
    }

    if (voucher) {
      voucher.set("used", voucher.getInt("used") + 1);
      tx.save(voucher);
    }
    if (customer && (earned || pointsUsed)) {
      customer.set("points", customer.getInt("points") - pointsUsed + earned);
      tx.save(customer);
    }
    if (status === "piutang") {
      const rc = new Record(tx.findCollectionByNameOrId("receivables"));
      rc.load({ sale: sale.id, customer: customer.id, amount: total - paid, paid: 0, status: "belum", due_date: b.due_date ? b.due_date + " 00:00:00.000Z" : "" });
      tx.save(rc);
    }
  });

  const sale = e.app.findRecordById("sales", saleId);
  e.app.expandRecord(sale, ["payment_method", "customer", "cashier"], null);
  const items2 = e.app.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: saleId });
  return e.json(200, { sale, items: items2 });
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
    subtotal: c.subtotal, discount: c.discount, total: c.total, points_used: c.pointsUsed,
    voucher_discount: c.voucherDiscount, points_discount: c.pointsDiscount,
    customer_points: c.customer ? c.customer.getInt("points") : 0,
    points_will_earn: c.customer && c.settings.getInt("points_per_rupiah") > 0 ? Math.floor(c.total / c.settings.getInt("points_per_rupiah")) : 0,
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
    const number = sale.getString("number");

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

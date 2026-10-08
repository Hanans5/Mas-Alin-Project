/// <reference path="../pb_data/types.d.ts" />
// Pre-Order (2026-10-08). The customer pays a DP first; the goods
// leave stock and the sale is made only when the rest is paid ("pelunasan").
// Money: every DP/refund is a preorder_payments row (Buku Kas reads them on
// the day they happen); at pelunasan the sale's own payments hold only the
// rest, so nothing counts twice. Omzet/laba count when the sale is made.
//   POST /api/po/preview          { items, customer, discount? }        → totals, min DP
//   POST /api/po/create           { items, customer, employee, discount?, ready_date?, note?, payments }
//   POST /api/po/{id}/dp          { payments }                           extra DP
//   POST /api/po/{id}/ready                                              Siap diambil
//   POST /api/po/{id}/complete    { payments }                           pelunasan → sale
//   POST /api/po/{id}/cancel      { mode: refund|hangus, reason, method? }  owner/admin


routerAdd("POST", "/api/po/preview", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const c = L.pricePreorder(e.app, e, e.requestInfo().body || {});
  return e.json(200, { lines: c.lines, subtotal: c.subtotal, discount: c.discount, total: c.total, min_dp: L.minDp(e.app, c.total) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/po/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const P = require(`${__hooks}/preorder_lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  let id = "";
  e.app.runInTransaction((tx) => {
    const c = L.pricePreorder(tx, e, b);
    const employee = L.pickEmployee(tx, b.employee);
    if (b.ready_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.ready_date))) throw new BadRequestError("Tanggal siap tidak valid.");
    const pay = L.takePayments(tx, b, c.total);
    const need = L.minDp(tx, c.total);
    if (pay.kept < Math.max(1, need)) throw new BadRequestError(`DP minimal Rp ${L.idr(need)}.`);
    const po = new Record(tx.findCollectionByNameOrId("preorders"));
    po.load({
      number: L.nextPoNumber(tx), customer: c.customer.id, employee, cashier: e.auth.id,
      items: c.lines, subtotal: c.subtotal, discount: c.discount, total: c.total, dp: 0, status: "menunggu",
      ready_date: b.ready_date ? b.ready_date + " 00:00:00.000Z" : "", note: String(b.note || "").slice(0, 500),
    });
    tx.save(po);
    P.addPayments(tx, po, pay, "dp", e.auth.id);
    id = po.id;
  });
  return e.json(200, require(`${__hooks}/preorder_lib.js`).full(e.app, id));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/po/{id}/dp", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const P = require(`${__hooks}/preorder_lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  e.app.runInTransaction((tx) => {
    const po = P.open(tx, e.request.pathValue("id"));
    const due = po.getInt("total") - po.getInt("dp");
    if (due <= 0) throw new BadRequestError("DP sudah sama dengan total. Lanjutkan ke pelunasan.");
    const pay = L.takePayments(tx, b, due);
    if (!pay.kept) throw new BadRequestError("Isi jumlah DP.");
    P.addPayments(tx, po, pay, "dp", e.auth.id);
  });
  return e.json(200, P.full(e.app, e.request.pathValue("id")));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/po/{id}/ready", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const P = require(`${__hooks}/preorder_lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  e.app.runInTransaction((tx) => {
    const po = P.open(tx, e.request.pathValue("id"));
    po.set("status", "siap"); tx.save(po);
  });
  return e.json(200, P.full(e.app, e.request.pathValue("id")));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/po/{id}/complete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const P = require(`${__hooks}/preorder_lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  let saleId = "";
  e.app.runInTransaction((tx) => {
    const po = P.open(tx, e.request.pathValue("id"));
    const due = po.getInt("total") - po.getInt("dp");
    const pay = L.takePayments(tx, b, due);
    if (pay.short) throw new BadRequestError(`Uang kurang Rp ${L.idr(pay.short)}.`);
    const main = pay.rows.slice().sort((x, y) => y.amount - x.amount)[0];
    const sale = new Record(tx.findCollectionByNameOrId("sales"));
    // paid = what stays at the till now (the rest); the DP was counted in Buku Kas when it was paid.
    sale.load({
      number: L.nextSaleNumber(tx), cashier: e.auth.id, customer: po.getString("customer"),
      subtotal: po.getInt("subtotal"), discount: po.getInt("discount"), voucher: "", points_used: 0, total: po.getInt("total"),
      paid: pay.kept, change: pay.change, payment_method: main ? main.pm.id : "", status: "lunas", points_earned: 0,
      kind: "jual", employee: po.getString("employee"), note: "Pre-order " + po.getString("number"), preorder: po.id,
    });
    tx.save(sale);
    saleId = sale.id;
    for (const r of pay.rows) {
      const sp = new Record(tx.findCollectionByNameOrId("sale_payments"));
      sp.load({ sale: sale.id, payment_method: r.pm.id, amount: r.amount, by: e.auth.id });
      tx.save(sp);
    }
    const itemsCol = tx.findCollectionByNameOrId("sale_items");
    for (const l of P.items(po)) {
      const r = new Record(itemsCol);
      r.load({ sale: sale.id, product: l.product || "", name: l.name, qty: l.qty, price: l.price, hpp: l.hpp || 0, subtotal: l.subtotal, tier: l.tier, pack_size: l.pack_size || 0 });
      tx.save(r);
      // goods leave the shelf now; custom items have no stock
      if (l.product) L.moveStock(tx, { product: l.product, type: "penjualan", qty: -l.qty, ref: sale.getString("number"), note: po.getString("number"), by: e.auth.id });
    }
    po.set("status", "selesai"); po.set("sale", sale.id); po.set("closed_at", new Date().toISOString().replace("T", " "));
    tx.save(po);
  });
  const sale = e.app.findRecordById("sales", saleId);
  e.app.expandRecord(sale, ["payment_method", "customer", "cashier", "employee", "preorder"], null);
  const items = e.app.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: saleId });
  const pays = e.app.findRecordsByFilter("sale_payments", "sale = {:s}", "created", 0, 0, { s: saleId });
  e.app.expandRecords(pays, ["payment_method"], null);
  return e.json(200, { sale, items, payments: pays });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/po/{id}/cancel", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const P = require(`${__hooks}/preorder_lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const b = e.requestInfo().body || {};
  const mode = b.mode;
  if (mode !== "refund" && mode !== "hangus") throw new BadRequestError("Pilih: DP dikembalikan atau DP hangus.");
  const reason = String(b.reason || "").trim().slice(0, 300);
  if (!reason) throw new BadRequestError("Isi alasan pembatalan.");
  e.app.runInTransaction((tx) => {
    const po = P.open(tx, e.request.pathValue("id"));
    const dp = po.getInt("dp");
    if (mode === "refund" && dp > 0) {
      let pm;
      try { pm = tx.findRecordById("payment_methods", b.method); } catch (_) { throw new BadRequestError("Pilih metode pengembalian DP."); }
      const r = new Record(tx.findCollectionByNameOrId("preorder_payments"));
      r.load({ preorder: po.id, kind: "refund", amount: dp, payment_method: pm.id, by: e.auth.id, note: reason });
      tx.save(r);
    }
    po.set("status", "batal"); po.set("cancel_mode", mode); po.set("cancel_reason", reason);
    po.set("closed_at", new Date().toISOString().replace("T", " "));
    tx.save(po);
  });
  return e.json(200, P.full(e.app, e.request.pathValue("id")));
}, $apis.requireAuth("users"));

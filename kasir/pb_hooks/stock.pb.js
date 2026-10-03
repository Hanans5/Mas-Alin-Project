/// <reference path="../pb_data/types.d.ts" />

// POST /api/stock/move — manual stock change by owner/admin.
// Body: { product, type: "masuk"|"keluar"|"opname", qty?, counted?, note? }
//   masuk  qty > 0 arrives       keluar  qty > 0 leaves (rusak, hilang, retur ke supplier)
//   opname counted = physical count; the difference is recorded
routerAdd("POST", "/api/stock/move", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const b = e.requestInfo().body || {};
  if (["masuk", "keluar", "opname"].indexOf(b.type) === -1) throw new BadRequestError("Tipe harus masuk, keluar atau opname.");
  if (b.type !== "opname" && !(L.int(b.qty, "Qty") > 0)) throw new BadRequestError("Qty harus lebih dari 0.");

  let id = "";
  e.app.runInTransaction((tx) => {
    let p;
    try { p = tx.findRecordById("products", b.product); } catch (_) { throw new BadRequestError("Produk tidak ditemukan."); }
    const qty = b.type === "keluar" ? -L.int(b.qty, "Qty") : L.int(b.qty || 0, "Qty");
    id = L.moveStock(tx, { product: p, type: b.type, qty, counted: b.counted, note: String(b.note || "").slice(0, 300), by: e.auth.id }).id;
  });
  return e.json(200, e.app.findRecordById("stock_moves", id));
}, $apis.requireAuth("users"));

// POST /api/receivables/pay — record a debt payment. Owner/admin only.
// Body: { receivable, amount, payment_method, note? }
routerAdd("POST", "/api/receivables/pay", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const b = e.requestInfo().body || {};
  const amount = L.int(b.amount, "Jumlah");
  if (amount < 1) throw new BadRequestError("Jumlah harus lebih dari 0.");

  let result = null;
  e.app.runInTransaction((tx) => {
    let rc;
    try { rc = tx.findRecordById("receivables", b.receivable); } catch (_) { throw new NotFoundError("Piutang tidak ditemukan."); }
    if (rc.getString("status") !== "belum") throw new BadRequestError("Piutang ini sudah " + rc.getString("status") + ".");
    const left = rc.getInt("amount") - rc.getInt("paid");
    if (amount > left) throw new BadRequestError(`Sisa piutang hanya Rp ${L.idr(left)}.`);
    let pm;
    try { pm = tx.findRecordById("payment_methods", b.payment_method); } catch (_) { throw new BadRequestError("Pilih metode pembayaran."); }

    const pay = new Record(tx.findCollectionByNameOrId("receivable_payments"));
    pay.load({ receivable: rc.id, amount, payment_method: pm.id, by: e.auth.id, note: String(b.note || "").slice(0, 300) });
    tx.save(pay);

    rc.set("paid", rc.getInt("paid") + amount);
    if (rc.getInt("paid") >= rc.getInt("amount")) rc.set("status", "lunas");
    tx.save(rc);

    // Points on the paid-off part, recorded on the sale so a void can take
    // them back.
    const per = L.settings(tx).getInt("points_per_rupiah");
    const sale = tx.findRecordById("sales", rc.getString("sale"));
    const earned = per > 0 ? Math.floor(amount / per) : 0;
    if (earned) {
      const c = tx.findRecordById("users", rc.getString("customer"));
      c.set("points", c.getInt("points") + earned);
      tx.save(c);
      sale.set("points_earned", sale.getInt("points_earned") + earned);
    }
    // sale.paid stays what was paid at the till — Buku Kas counts this
    // payment from receivable_payments, so adding it here would double it.
    if (rc.getString("status") === "lunas") sale.set("status", "lunas");
    tx.save(sale);
    result = { payment: pay.id, receivable: rc.id, left: rc.getInt("amount") - rc.getInt("paid"), points_earned: earned };
  });
  return e.json(200, result);
}, $apis.requireAuth("users"));

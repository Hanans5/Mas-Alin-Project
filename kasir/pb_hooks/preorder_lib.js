/// <reference path="../pb_data/types.d.ts" />
// Helpers for preorder.pb.js (route handlers can't share top-level functions).

// An open pre-order (Menunggu or Siap), or an error.
function open(tx, id) {
  let po;
  try { po = tx.findRecordById("preorders", id); } catch (_) { throw new NotFoundError("Pre-order tidak ditemukan."); }
  const st = po.getString("status");
  if (st === "selesai") throw new BadRequestError("Pre-order ini sudah selesai.");
  if (st === "batal") throw new BadRequestError("Pre-order ini sudah dibatalkan.");
  return po;
}
// The locked lines saved at order time.
function items(po) {
  const v = JSON.parse(po.getString("items") || "[]");
  return Array.isArray(v) ? v : [];
}
// DP rows from takePayments(); more than one method in one go = Split in Buku Kas.
function addPayments(tx, po, pay, kind, by) {
  const col = tx.findCollectionByNameOrId("preorder_payments");
  for (const r of pay.rows) {
    const rec = new Record(col);
    rec.load({ preorder: po.id, kind, amount: r.amount, payment_method: r.pm.id, split: pay.rows.length > 1, by });
    tx.save(rec);
  }
  po.set("dp", po.getInt("dp") + pay.kept);
  tx.save(po);
}
// The pre-order with what the screen and the struk need.
function full(app, id) {
  const po = app.findRecordById("preorders", id);
  app.expandRecord(po, ["customer", "employee", "cashier", "sale"], null);
  const payments = app.findRecordsByFilter("preorder_payments", "preorder = {:p}", "created", 0, 0, { p: id });
  app.expandRecords(payments, ["payment_method"], null);
  return { preorder: po, payments };
}

module.exports = { open, items, addPayments, full };

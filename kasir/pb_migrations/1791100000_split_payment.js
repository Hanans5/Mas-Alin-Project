/// <reference path="../pb_data/types.d.ts" />
// Split payment, DP and bon; no more points or vouchers (Mas Alin, 2026-10-06).
// - sale_payments: one row per payment method per sale, money actually kept
//   at the till (cash already net of change). A sale may have several rows
//   (Tunai + Transfer) or none (pure bon). Later bon payments stay in
//   receivable_payments. Buku Kas reads both; sales without rows here (older
//   sales) keep their single sales.paid line.
// - Only Tunai and Transfer stay active; every other method is switched off
//   (history keeps its name).
// - Points and vouchers are retired: the points rate goes to 0 and every
//   voucher is switched off. Old sales keep their numbers, and voiding one
//   still reverses what it earned or used.
migrate((app) => {
  const MANAGER = '(@request.auth.role = "owner" || @request.auth.role = "admin")';
  const READ = `${MANAGER} || sale.customer = @request.auth.id || (@request.auth.role = "kasir" && sale.cashier = @request.auth.id && sale.created >= @todayStart)`;
  const sales = app.findCollectionByNameOrId("sales");
  const methods = app.findCollectionByNameOrId("payment_methods");
  const users = app.findCollectionByNameOrId("users");
  const pays = new Collection({
    type: "base",
    name: "sale_payments",
    listRule: READ, viewRule: READ, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "sale", collectionId: sales.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "payment_method", collectionId: methods.id, maxSelect: 1, required: true },
      { type: "number", name: "amount", required: true, min: 1, onlyInt: true },
      { type: "relation", name: "by", collectionId: users.id, maxSelect: 1 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_sale_payments_sale ON sale_payments (sale)"],
  });
  app.save(pays);

  for (const m of app.findAllRecords("payment_methods")) {
    const keep = ["tunai", "transfer"].indexOf(m.getString("name").trim().toLowerCase()) !== -1;
    if (m.getBool("active") !== keep) { m.set("active", keep); app.save(m); }
  }
  for (const v of app.findAllRecords("vouchers")) {
    if (v.getBool("active")) { v.set("active", false); app.save(v); }
  }
  for (const s of app.findAllRecords("settings")) {
    s.set("points_per_rupiah", 0);
    app.save(s);
  }
}, (app) => {
  app.delete(app.findCollectionByNameOrId("sale_payments"));
});

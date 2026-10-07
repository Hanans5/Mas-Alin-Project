/// <reference path="../pb_data/types.d.ts" />
// Pre-Order (2026-10-08): the customer pays a DP first; the goods are
// handed over (stock out) and the sale is made when the rest is paid.
// preorders holds the order with its locked prices; preorder_payments the DP
// payments (and a refund when cancelled), which Buku Kas reads. Everything is
// written through /api/po/* routes; staff can read.
const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const po = new Collection({
    type: "base", name: "preorders",
    listRule: STAFF, viewRule: STAFF, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "number", type: "text", required: true },
      { name: "customer", type: "relation", required: true, collectionId: users.id, maxSelect: 1 },
      { name: "employee", type: "relation", collectionId: app.findCollectionByNameOrId("employees").id, maxSelect: 1 },
      { name: "cashier", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "items", type: "json", maxSize: 200000 },
      { name: "subtotal", type: "number" },
      { name: "discount", type: "number" },
      { name: "total", type: "number" },
      { name: "dp", type: "number" },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["menunggu", "siap", "selesai", "batal"] },
      { name: "ready_date", type: "date" },
      { name: "note", type: "text", max: 500 },
      { name: "sale", type: "relation", collectionId: app.findCollectionByNameOrId("sales").id, maxSelect: 1 },
      { name: "cancel_mode", type: "select", maxSelect: 1, values: ["refund", "hangus"] },
      { name: "cancel_reason", type: "text", max: 300 },
      { name: "closed_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_preorders_number ON preorders (number)", "CREATE INDEX idx_preorders_status ON preorders (status)"],
  });
  app.save(po);
  const pp = new Collection({
    type: "base", name: "preorder_payments",
    listRule: STAFF, viewRule: STAFF, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "preorder", type: "relation", required: true, collectionId: po.id, maxSelect: 1 },
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["dp", "refund"] },
      { name: "amount", type: "number", required: true },
      { name: "payment_method", type: "relation", collectionId: app.findCollectionByNameOrId("payment_methods").id, maxSelect: 1 },
      { name: "split", type: "bool" },
      { name: "by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "note", type: "text", max: 300 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_preorder_payments_po ON preorder_payments (preorder)"],
  });
  app.save(pp);

  // A completed pre-order's sale points back to it; custom items have no product.
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new RelationField({ name: "preorder", collectionId: po.id, maxSelect: 1 }));
  app.save(sales);
  const si = app.findCollectionByNameOrId("sale_items");
  si.fields.getByName("product").required = false;
  app.save(si);

  const st = app.findCollectionByNameOrId("settings");
  st.fields.add(new NumberField({ name: "po_min_dp", min: 0, max: 100 }));
  app.save(st);
  for (const r of app.findAllRecords("settings")) { r.set("po_min_dp", 30); app.save(r); }
}, (app) => {
  const st = app.findCollectionByNameOrId("settings"); st.fields.removeByName("po_min_dp"); app.save(st);
  const si = app.findCollectionByNameOrId("sale_items"); si.fields.getByName("product").required = true; app.save(si);
  const sales = app.findCollectionByNameOrId("sales"); sales.fields.removeByName("preorder"); app.save(sales);
  app.delete(app.findCollectionByNameOrId("preorder_payments"));
  app.delete(app.findCollectionByNameOrId("preorders"));
});

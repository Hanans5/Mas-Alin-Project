/// <reference path="../pb_data/types.d.ts" />
// Daily sales totals from the old system (Laporan Penjualan, Mas Alin
// 2026-10-07): one row per WIB day, no items, customers or methods. Reports
// add them in, labelled "sistem lama"; stock, Buku Kas and sales never see
// them. No API rules: only the report routes (and superusers) read it.
migrate((app) => {
  const c = new Collection({
    type: "base",
    name: "legacy_sales",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "day", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "total", type: "number", required: true },
      { name: "count", type: "number", onlyInt: true },
      { name: "items", type: "number", onlyInt: true },
      { name: "discount", type: "number" },
      { name: "profit", type: "number" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_legacy_sales_day ON legacy_sales (day)"],
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("legacy_sales"));
});

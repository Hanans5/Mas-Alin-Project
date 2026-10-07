/// <reference path="../pb_data/types.d.ts" />
// Old-system totals per pelanggan, karyawan and produk (Mas Alin, 2026-10-07)
// for the whole old period (see legacy_sales), with no dates. ref = users id
// (pelanggan; "" = walk-in), employees id ("toko" = Toko) or products id.
// No API rules: only the report routes (and superusers) read it.
migrate((app) => {
  const c = new Collection({
    type: "base",
    name: "legacy_totals",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["pelanggan", "karyawan", "produk"] },
      { name: "ref", type: "text" },
      { name: "name", type: "text" },
      { name: "total", type: "number" },
      { name: "trx", type: "number", onlyInt: true },
      { name: "items", type: "number", onlyInt: true },
      { name: "profit", type: "number" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_legacy_totals_kind_ref ON legacy_totals (kind, ref)"],
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("legacy_totals"));
});

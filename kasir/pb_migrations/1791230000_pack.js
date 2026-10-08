/// <reference path="../pb_data/types.d.ts" />
// Selling by the pack (2026-10-09). products.pack_size = pcs in one pack
// (0 = no pack), products.price_pack = the pack's price (0 = pack_size ×
// the pcs price). sale_items.pack_size = pcs per pack on a pack line (its
// qty stays in pcs, so stock, retur, reports and laba count pcs).
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new NumberField({ name: "pack_size", onlyInt: true, min: 0, max: 10000 }));
  p.fields.add(new NumberField({ name: "price_pack", onlyInt: true, min: 0 }));
  app.save(p);
  const i = app.findCollectionByNameOrId("sale_items");
  i.fields.add(new NumberField({ name: "pack_size", onlyInt: true, min: 0, max: 10000 }));
  app.save(i);
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("pack_size"); p.fields.removeByName("price_pack");
  app.save(p);
  const i = app.findCollectionByNameOrId("sale_items");
  i.fields.removeByName("pack_size");
  app.save(i);
});

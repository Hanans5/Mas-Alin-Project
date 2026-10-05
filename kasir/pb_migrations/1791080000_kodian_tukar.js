/// <reference path="../pb_data/types.d.ts" />
// Kodian price, owner-set custom price, and item swaps (tukar barang).
// - products.price_kodi: per-piece price applied to every full kodi (20 pcs)
//   of a line; 0 = no kodian price. 45 pcs = 40 at kodian + 5 at normal.
// - sale_items.tier: how a line was priced: normal / kodian / kustom / retur.
// - A swap is a sale with kind "tukar" and ref_sale = the original sale. Its
//   returned items are lines with NEGATIVE qty and subtotal (tier "retur"),
//   so reports, HPP and stock net out without special cases; the buyer pays
//   any difference (never refunded: swaps only, per Mas Alin).
migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  products.fields.add(new NumberField({ name: "price_kodi", min: 0, onlyInt: true }));
  app.save(products);

  const items = app.findCollectionByNameOrId("sale_items");
  items.fields.getByName("qty").min = null;
  items.fields.getByName("subtotal").min = null;
  items.fields.add(new TextField({ name: "tier", max: 10 }));
  app.save(items);

  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new SelectField({ name: "kind", maxSelect: 1, values: ["jual", "tukar"] }));
  sales.fields.add(new RelationField({ name: "ref_sale", collectionId: sales.id, maxSelect: 1 }));
  app.save(sales);

  const moves = app.findCollectionByNameOrId("stock_moves");
  const t = moves.fields.getByName("type");
  if (t.values.indexOf("retur") === -1) t.values = t.values.concat(["retur"]);
  app.save(moves);
}, (app) => {
  const products = app.findCollectionByNameOrId("products");
  products.fields.removeByName("price_kodi");
  app.save(products);
  const items = app.findCollectionByNameOrId("sale_items");
  items.fields.removeByName("tier");
  items.fields.getByName("qty").min = 1;
  items.fields.getByName("subtotal").min = 0;
  app.save(items);
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("ref_sale");
  sales.fields.removeByName("kind");
  app.save(sales);
});

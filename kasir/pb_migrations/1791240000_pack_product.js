/// <reference path="../pb_data/types.d.ts" />
// Pack products (2026-10-12): a product with its own code and price that is
// N pcs of another product, e.g. "Lakban 1 Pack" = 6 × Lakban. pack_of = the
// base product, pack_isi = pcs per pack. It holds no stock: selling it takes
// pack_isi pcs per pack from the base (lib.priceCart turns the line into a
// pack line of the base product at the pack product's price).
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new RelationField({ name: "pack_of", collectionId: p.id, maxSelect: 1 }));
  p.fields.add(new NumberField({ name: "pack_isi", onlyInt: true, min: 0, max: 10000 }));
  app.save(p);
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("pack_of"); p.fields.removeByName("pack_isi");
  app.save(p);
});

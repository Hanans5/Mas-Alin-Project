/// <reference path="../pb_data/types.d.ts" />
// products.price_jumbo: per-pcs "Harga jumbo" (Mas Alin, 2026-10-08). 0 = none;
// the owner picks it per cart line with the "Harga" button. Sale items priced
// this way get tier "jumbo".
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new NumberField({ name: "price_jumbo", min: 0, onlyInt: true }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("price_jumbo");
  app.save(c);
});

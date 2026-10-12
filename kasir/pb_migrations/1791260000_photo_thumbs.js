/// <reference path="../pb_data/types.d.ts" />
// Photo thumbnails (2026-10-12): PocketBase only makes a ?thumb= size that is
// listed on the field; otherwise it sends the original. The kasir grid asked
// for 160x160 and got the full photo (6.4 MB for 37 products on the tablet).
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.getByName("photo").thumbs = ["240x240", "480x600"]; // kasir grid, store card (4:5)
  app.save(p);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.getByName("promo_image").thumbs = ["0x120"];
  app.save(s);
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.getByName("photo").thumbs = [];
  app.save(p);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.getByName("promo_image").thumbs = [];
  app.save(s);
});

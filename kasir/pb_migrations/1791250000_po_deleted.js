/// <reference path="../pb_data/types.d.ts" />
// Deleting a cancelled pre-order (2026-10-12) hides it from Pre-Order; the
// record stays so its DP and refund keep their place in Buku Kas, Laba Rugi
// (DP hangus) and Laporan Pre-Order ("batal (…, dihapus)").
migrate((app) => {
  const c = app.findCollectionByNameOrId("preorders");
  c.fields.add(new BoolField({ name: "deleted" }));
  c.fields.add(new DateField({ name: "deleted_at" }));
  c.fields.add(new RelationField({ name: "deleted_by", collectionId: app.findCollectionByNameOrId("users").id, maxSelect: 1 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("preorders");
  for (const f of ["deleted", "deleted_at", "deleted_by"]) c.fields.removeByName(f);
  app.save(c);
});

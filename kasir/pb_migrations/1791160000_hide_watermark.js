/// <reference path="../pb_data/types.d.ts" />
// Store-wide switch for the logo watermark (Pengaturan → Tampilan, owner).
// Off by default, so the watermark shows.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.add(new BoolField({ name: "hide_watermark" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("hide_watermark");
  app.save(c);
});

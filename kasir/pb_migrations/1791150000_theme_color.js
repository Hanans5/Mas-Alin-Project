/// <reference path="../pb_data/types.d.ts" />
// Store-wide colour theme (Pengaturan → Tampilan, owner): "awal" (the first
// orange look), "" / "mahogany" (default) or one of Mas Alin's mahogany shades.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.add(new TextField({ name: "theme_color", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("theme_color");
  app.save(c);
});

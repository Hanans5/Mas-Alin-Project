/// <reference path="../pb_data/types.d.ts" />
// Optional Microsoft Clarity project id for the public shop (real click and
// scroll heatmaps). Empty = no tracking script is loaded at all.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new TextField({ name: "clarity_id", max: 40, pattern: "^[a-z0-9]*$" }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("clarity_id");
  app.save(s);
});

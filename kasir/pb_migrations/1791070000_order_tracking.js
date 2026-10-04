/// <reference path="../pb_data/types.d.ts" />
// Order tracking by short code. Every web order gets `track`, 8 characters
// with no look-alikes (no 0/O, 1/I/L), the key in the customer's tracking
// link toko…/t/K7QF3M9X. It is a lookup key, not a password: the tracking
// page shows progress only (no phone, address, prices or payment actions).
// store_url / pos_url build the links in WhatsApp messages and emails, so
// moving to Mas Alin's own domain is a settings change, not a code change.
migrate((app) => {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const orders = app.findCollectionByNameOrId("web_orders");
  orders.fields.add(new TextField({ name: "track", max: 12 }));
  orders.indexes.push("CREATE UNIQUE INDEX idx_web_orders_track ON web_orders (track) WHERE track != ''");
  app.save(orders);

  const used = {};
  for (const o of app.findAllRecords("web_orders")) {
    let code = "";
    do { code = $security.randomStringWithAlphabet(8, ALPHABET); } while (used[code]);
    used[code] = true;
    o.set("track", code);
    app.saveNoValidate(o);
  }

  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.add(new TextField({ name: "store_url", max: 200 }));
  settings.fields.add(new TextField({ name: "pos_url", max: 200 }));
  app.save(settings);
  for (const s of app.findAllRecords("settings")) {
    if (!s.getString("store_url")) s.set("store_url", "https://toko-nelin.necutbarber.shop");
    if (!s.getString("pos_url")) s.set("pos_url", "https://nelin.necutbarber.shop");
    app.save(s);
  }
}, (app) => {
  const orders = app.findCollectionByNameOrId("web_orders");
  orders.indexes = orders.indexes.filter((i) => i.indexOf("idx_web_orders_track") === -1);
  orders.fields.removeByName("track");
  app.save(orders);
  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.removeByName("store_url");
  settings.fields.removeByName("pos_url");
  app.save(settings);
});

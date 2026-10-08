/// <reference path="../pb_data/types.d.ts" />
// Walk-in pelanggan "Toko" (2026-10-08): the old system's CUS0130. A sale with
// no pelanggan is booked on it, and the kasir can also pick it by hand. Old and
// new sales and bons without a pelanggan move to it, so reports say "Toko".
// It's never a bon or pre-order customer (checked in the hooks).
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("walkin_customer")) {
    c.fields.add(new RelationField({ name: "walkin_customer", collectionId: app.findCollectionByNameOrId("users").id, maxSelect: 1 }));
    app.save(c);
  }
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let toko;
  try { toko = app.findAuthRecordByUsername("users", "cus0130"); } catch (_) {
    toko = new Record(app.findCollectionByNameOrId("users"));
    const pw = $security.randomString(24);
    toko.load({ username: "cus0130", name: "Toko", role: "pelanggan", address: s.getString("address"), phone: s.getString("phone"), password: pw, passwordConfirm: pw });
    app.save(toko);
  }
  s.set("walkin_customer", toko.id);
  app.save(s);
  app.db().newQuery("UPDATE sales SET customer = {:t} WHERE customer = ''").bind({ t: toko.id }).execute();
  app.db().newQuery("UPDATE receivables SET customer = {:t} WHERE customer = ''").bind({ t: toko.id }).execute();
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  const t = s.getString("walkin_customer");
  if (t) {
    app.db().newQuery("UPDATE sales SET customer = '' WHERE customer = {:t}").bind({ t }).execute();
    app.db().newQuery("UPDATE receivables SET customer = '' WHERE customer = {:t}").bind({ t }).execute();
  }
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("walkin_customer");
  app.save(c);
});

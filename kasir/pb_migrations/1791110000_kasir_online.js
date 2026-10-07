/// <reference path="../pb_data/types.d.ts" />
// The shared kasir login (the karyawan) also packs and ships web orders
// (Mas Alin, 2026-10-07): it may read them. Which actions it may take is
// decided in /api/store/admin (ship, resi, ready, complete only).
migrate((app) => {
  const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
  const c = app.findCollectionByNameOrId("web_orders");
  c.listRule = STAFF;
  c.viewRule = STAFF;
  app.save(c);
}, (app) => {
  const MANAGER = '(@request.auth.role = "owner" || @request.auth.role = "admin")';
  const c = app.findCollectionByNameOrId("web_orders");
  c.listRule = MANAGER;
  c.viewRule = MANAGER;
  app.save(c);
});

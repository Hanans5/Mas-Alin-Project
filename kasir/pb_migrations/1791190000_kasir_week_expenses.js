/// <reference path="../pb_data/types.d.ts" />
// The kasir login sees only this week's Pengeluaran (2026-10-08). The records
// API no longer lists expenses to a kasir; GET /api/expenses/week serves them
// (Monday to today, WIB). A kasir can still add one and see what it saved today.
const MGR = '(@request.auth.role = "owner" || @request.auth.role = "superadmin" || @request.auth.role = "admin")';
const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "superadmin" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
migrate((app) => {
  const x = app.findCollectionByNameOrId("expenses");
  x.listRule = MGR;
  x.viewRule = `${MGR} || (@request.auth.role = "kasir" && by = @request.auth.id && created >= @todayStart)`;
  app.save(x);
}, (app) => {
  const x = app.findCollectionByNameOrId("expenses");
  x.listRule = STAFF; x.viewRule = STAFF;
  app.save(x);
});

/// <reference path="../pb_data/types.d.ts" />
// Admin needs kasir names on the Transaksi list (expand cashier). Admin still
// can't see the owner or other admins, and still can't edit staff.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rule = 'id = @request.auth.id || @request.auth.role = "owner"'
    + ' || ((@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir") && role = "pelanggan")'
    + ' || (@request.auth.role = "admin" && role = "kasir")';
  users.listRule = rule;
  users.viewRule = rule;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const rule = 'id = @request.auth.id || @request.auth.role = "owner"'
    + ' || ((@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir") && role = "pelanggan")';
  users.listRule = rule;
  users.viewRule = rule;
  app.save(users);
});

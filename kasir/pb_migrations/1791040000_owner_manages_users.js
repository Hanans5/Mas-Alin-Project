/// <reference path="../pb_data/types.d.ts" />
// The owner can reset any user's password (no oldPassword needed) and change
// their username — PocketBase's "manage" access on the users collection.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.manageRule = '@request.auth.role = "owner"';
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.manageRule = null;
  app.save(users);
});

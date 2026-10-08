/// <reference path="../pb_data/types.d.ts" />
// Superadmin (2026-10-08): the owner's right hand. Same rights as the owner
// everywhere (hooks map it to "owner" in lib.role), shown as "Superadmin".
// One limit: a superadmin can't edit, disable or delete an owner account,
// and can't give anyone the owner or superadmin role.
const OWN = '@request.auth.role = "owner"';
const BOTH = '(@request.auth.role = "owner" || @request.auth.role = "superadmin")';
const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
migrate((app) => {
  for (const c of app.findAllCollections()) {
    if (c.name === "users" || c.system) continue;
    let changed = false;
    for (const k of RULES) {
      if (c[k] == null) continue;   // rules come back as objects: read them with String()
      const v = String(c[k]);
      if (v.includes(OWN) && !v.includes(BOTH)) { c[k] = v.split(OWN).join(BOTH); changed = true; }
    }
    if (changed) app.save(c);
  }
  const u = app.findCollectionByNameOrId("users");
  const role = u.fields.getByName("role");
  if (!role.values.includes("superadmin")) role.values = [...role.values, "superadmin"];
  const SA = '@request.auth.role = "superadmin"';
  const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "superadmin" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
  u.listRule = `id = @request.auth.id || ${BOTH} || (${STAFF} && role = "pelanggan") || (@request.auth.role = "admin" && role = "kasir")`;
  u.viewRule = u.listRule;
  u.createRule = `${OWN} || (${SA} && @request.body.role != "owner" && @request.body.role != "superadmin") || (${STAFF} && @request.body.role = "pelanggan" && @request.body.points:isset = false)`;
  u.updateRule = `${OWN} || (${SA} && role != "owner" && (@request.body.role:isset = false || (@request.body.role != "owner" && @request.body.role != "superadmin"))) || (id = @request.auth.id && @request.body.role:isset = false && @request.body.points:isset = false && @request.body.active:isset = false)`;
  u.deleteRule = `${OWN} || (${SA} && role != "owner" && role != "superadmin")`;
  app.save(u);
}, (app) => {
  for (const c of app.findAllCollections()) {
    if (c.name === "users" || c.system) continue;
    let changed = false;
    for (const k of RULES) {
      if (c[k] == null) continue;
      const v = String(c[k]);
      if (v.includes(BOTH)) { c[k] = v.split(BOTH).join(OWN); changed = true; }
    }
    if (changed) app.save(c);
  }
  const u = app.findCollectionByNameOrId("users");
  const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
  u.listRule = `id = @request.auth.id || ${OWN} || (${STAFF} && role = "pelanggan") || (@request.auth.role = "admin" && role = "kasir")`;
  u.viewRule = u.listRule;
  u.createRule = `${OWN} || (${STAFF} && @request.body.role = "pelanggan" && @request.body.points:isset = false)`;
  u.updateRule = `${OWN} || (id = @request.auth.id && @request.body.role:isset = false && @request.body.points:isset = false && @request.body.active:isset = false)`;
  u.deleteRule = OWN;
  const role = u.fields.getByName("role");
  role.values = role.values.filter((v) => v !== "superadmin");
  app.save(u);
});

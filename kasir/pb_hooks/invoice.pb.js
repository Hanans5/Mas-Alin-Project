/// <reference path="../pb_data/types.d.ts" />
// A4 invoice for the pelanggan (2026-10-08). The kasir app makes a public,
// read-only link per sale; the page /invoice.html#<token> reads it here.
//   POST /api/invoice/{id}/link    staff: the sale's link token (made once)
//   POST /api/invoice/{id}/revoke  owner/admin: the old link stops working
//   GET  /api/invoice/view/{token} anyone with the link: that one invoice

routerAdd("POST", "/api/invoice/{id}/link", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  let sale;
  try { sale = e.app.findRecordById("sales", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Transaksi tidak ditemukan."); }
  let token = sale.getString("invoice_token");
  if (!token) {
    token = $security.randomStringWithAlphabet(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    // raw update: making a link isn't an edit of the sale
    e.app.db().newQuery("UPDATE sales SET invoice_token = {:t} WHERE id = {:id}").bind({ t: token, id: sale.id }).execute();
  }
  return e.json(200, { token });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/invoice/{id}/revoke", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  e.app.db().newQuery("UPDATE sales SET invoice_token = '' WHERE id = {:id}").bind({ id: e.request.pathValue("id") }).execute();
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/invoice/view/{token}", (e) => {
  const token = e.request.pathValue("token");
  if (!/^[A-Za-z0-9]{40}$/.test(token)) throw new NotFoundError("Invoice tidak ditemukan.");
  let sale;
  try { sale = e.app.findFirstRecordByFilter("sales", "invoice_token = {:t}", { t: token }); } catch (_) { throw new NotFoundError("Invoice tidak ditemukan atau link sudah dicabut."); }
  const I = require(`${__hooks}/invoice_lib.js`);
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("X-Robots-Tag", "noindex");
  return e.json(200, I.build(e.app, sale));
});

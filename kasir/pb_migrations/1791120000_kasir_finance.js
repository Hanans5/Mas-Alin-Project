/// <reference path="../pb_data/types.d.ts" />
// The shared kasir login (the karyawan) gets more of the shop (Mas Alin,
// 2026-10-07): every transaction, not only its own of today; Pengeluaran
// (read and add; editing and deleting stay owner/admin); Piutang with its
// payment history. Buku Kas, Laba Rugi and reports stay owner/admin.
const MGR = '(@request.auth.role = "owner" || @request.auth.role = "admin")';
const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
const OLD_KASIR = {
  sales: '(@request.auth.role = "kasir" && cashier = @request.auth.id && created >= @todayStart)',
  sale_items: '(@request.auth.role = "kasir" && sale.cashier = @request.auth.id && sale.created >= @todayStart)',
  sale_payments: '(@request.auth.role = "kasir" && sale.cashier = @request.auth.id && sale.created >= @todayStart)',
};
const OWN = { sales: 'customer = @request.auth.id', sale_items: 'sale.customer = @request.auth.id', sale_payments: 'sale.customer = @request.auth.id',
  receivables: 'customer = @request.auth.id', receivable_payments: 'receivable.customer = @request.auth.id' };
const setRead = (app, name, rule) => { const c = app.findCollectionByNameOrId(name); c.listRule = rule; c.viewRule = rule; app.save(c); };
migrate((app) => {
  for (const n of ["sales", "sale_items", "sale_payments", "receivables", "receivable_payments"]) setRead(app, n, `${STAFF} || ${OWN[n]}`);
  const x = app.findCollectionByNameOrId("expenses");
  x.listRule = STAFF; x.viewRule = STAFF; x.createRule = STAFF;
  app.save(x);
}, (app) => {
  for (const n of ["sales", "sale_items", "sale_payments"]) setRead(app, n, `${MGR} || ${OWN[n]} || ${OLD_KASIR[n]}`);
  for (const n of ["receivables", "receivable_payments"]) setRead(app, n, `${MGR} || ${OWN[n]}`);
  const x = app.findCollectionByNameOrId("expenses");
  x.listRule = MGR; x.viewRule = MGR; x.createRule = MGR;
  app.save(x);
});

/// <reference path="../pb_data/types.d.ts" />
// Karyawan per sale. The shop runs one shared kasir login, so the assistant
// who served the buyer is picked on every sale (sales.employee) — the old
// system's "Karyawan". Staff (not pelanggan) may read the list so the till can
// show it; owner/admin manage it. No positions or salary here: Mas Alin
// works out pay himself from Laporan Karyawan.
migrate((app) => {
  const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
  const employees = app.findCollectionByNameOrId("employees");
  employees.listRule = STAFF;
  employees.viewRule = STAFF;
  app.save(employees);

  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.add(new RelationField({ name: "employee", collectionId: employees.id, maxSelect: 1 }));
  app.save(sales);
}, (app) => {
  const MANAGER = '(@request.auth.role = "owner" || @request.auth.role = "admin")';
  const employees = app.findCollectionByNameOrId("employees");
  employees.listRule = MANAGER;
  employees.viewRule = MANAGER;
  app.save(employees);
  const sales = app.findCollectionByNameOrId("sales");
  sales.fields.removeByName("employee");
  app.save(sales);
});

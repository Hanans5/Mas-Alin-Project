/// <reference path="../pb_data/types.d.ts" />
// Nelin Batik — full schema. Roles live on users.role:
//   owner     Mas Alin's app login — everything
//   admin     produk, stok, transaksi, pelanggan, pengeluaran, piutang, laporan
//   kasir     POS, own transactions today, read products, add pelanggan
//   pelanggan loyal customer — own purchases, points, vouchers, piutang
// The PocketBase superuser (/_/ panel) is Mas Alin only and bypasses all rules.
//
// Sales are never created through the plain records API (createRule null):
// they go through POST /api/pos/checkout in pb_hooks, which prices from the
// database, moves stock, awards points and writes the cash book in one
// transaction. The same goes for stock moves and debt payments. Those ledgers
// have no update/delete rule: a mistake is corrected with a new entry.

migrate((app) => {
  const OWNER = '@request.auth.role = "owner"';
  const MANAGER = '(@request.auth.role = "owner" || @request.auth.role = "admin")';
  const STAFF = '(@request.auth.role = "owner" || @request.auth.role = "admin" || @request.auth.role = "kasir")';
  const AUTHED = '@request.auth.id != ""';

  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
  const base = (name, fields, rules, indexes) => {
    const c = new Collection(Object.assign({ type: "base", name, fields: fields.concat(stamps()), indexes: indexes || [] }, rules));
    app.save(c);
    return c;
  };
  const rel = (name, coll, extra) => Object.assign({ type: "relation", name, collectionId: coll.id, maxSelect: 1, cascadeDelete: false }, extra || {});
  const money = (name, extra) => Object.assign({ type: "number", name, min: 0, onlyInt: true }, extra || {});

  // ── users: staff and customers in one auth collection, login by username ──
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "username", required: true, min: 3, max: 32, pattern: "^[a-z0-9_.]+$", presentable: true }));
  users.fields.add(new SelectField({ name: "role", required: true, maxSelect: 1, values: ["owner", "admin", "kasir", "pelanggan"] }));
  users.fields.add(new TextField({ name: "phone", max: 20 }));
  users.fields.add(new TextField({ name: "address", max: 300 }));
  users.fields.add(new NumberField({ name: "points", min: 0, onlyInt: true }));
  users.fields.add(new BoolField({ name: "disabled" }));
  users.fields.getByName("email").required = false;
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["username"];
  users.addIndex("idx_users_username", true, "username", "");
  // No public signup. Owner manages everyone; admin/kasir may register
  // pelanggan only. Staff see customers; everyone sees themselves.
  users.listRule = `id = @request.auth.id || ${OWNER} || (${STAFF} && role = "pelanggan")`;
  users.viewRule = users.listRule;
  users.createRule = `${OWNER} || (${STAFF} && @request.body.role = "pelanggan" && @request.body.points:isset = false)`;
  // Self-edit may not touch role, points or disabled — those are the owner's.
  users.updateRule = `${OWNER} || (id = @request.auth.id && @request.body.role:isset = false && @request.body.points:isset = false && @request.body.active:isset = false)`;
  users.deleteRule = OWNER;
  // A disabled account can't log in (bool defaults false, so new = enabled).
  users.authRule = "disabled = false";
  app.save(users);

  // ── settings: one row ──
  base("settings", [
    { type: "text", name: "store_name", required: true, max: 100 },
    { type: "text", name: "business_type", max: 100 },
    { type: "text", name: "address", max: 300 },
    { type: "text", name: "phone", max: 20 },
    { type: "text", name: "receipt_header", max: 1000 },
    { type: "text", name: "receipt_footer", max: 1000 },
    { type: "file", name: "logo", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    // 1 point per this many rupiah of the paid total (0 = points off).
    money("points_per_rupiah"),
    // What one point is worth when redeemed, in rupiah.
    money("point_value"),
  ], { listRule: AUTHED, viewRule: AUTHED, createRule: null, updateRule: OWNER, deleteRule: null });

  // ── produk ──
  const categories = base("categories", [
    { type: "text", name: "name", required: true, max: 60, presentable: true },
  ], { listRule: STAFF, viewRule: STAFF, createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER },
    ["CREATE UNIQUE INDEX idx_categories_name ON categories (name)"]);

  const products = base("products", [
    { type: "text", name: "name", required: true, max: 120, presentable: true },
    { type: "text", name: "sku", required: true, max: 40 },
    { type: "text", name: "barcode", max: 64 },
    rel("category", categories),
    { type: "text", name: "unit", max: 20 },
    money("hpp"),
    money("price", { required: true }),
    // Changed only through stock_moves (see pb_hooks), never edited directly.
    { type: "number", name: "stock", onlyInt: true },
    // Low-stock alert threshold; 0 = no alert.
    money("min_stock"),
    { type: "file", name: "photo", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    { type: "bool", name: "active" },
  ], {
    listRule: STAFF, viewRule: STAFF, createRule: MANAGER,
    updateRule: `${MANAGER} && @request.body.stock:isset = false`,
    deleteRule: MANAGER,
  }, [
    "CREATE UNIQUE INDEX idx_products_sku ON products (sku)",
    "CREATE INDEX idx_products_barcode ON products (barcode)",
  ]);

  // ── stok: append-only ledger ──
  base("stock_moves", [
    rel("product", products, { required: true }),
    // masuk / keluar / penjualan / batal: qty is the signed change.
    // opname: `counted` is what was physically counted; the hook fills qty.
    { type: "select", name: "type", required: true, maxSelect: 1, values: ["masuk", "keluar", "opname", "penjualan", "batal"] },
    { type: "number", name: "qty", onlyInt: true },
    { type: "number", name: "counted", onlyInt: true, min: 0 },
    { type: "number", name: "stock_after", onlyInt: true },
    { type: "text", name: "ref", max: 40 },
    { type: "text", name: "note", max: 300 },
    rel("by", users),
  ], {
    listRule: STAFF, viewRule: STAFF,
    // Written only by POST /api/stock/move and the POS routes.
    createRule: null, updateRule: null, deleteRule: null,
  }, ["CREATE INDEX idx_stock_moves_product ON stock_moves (product, created)"]);

  // ── pembayaran & voucher ──
  const paymentMethods = base("payment_methods", [
    { type: "text", name: "name", required: true, max: 40, presentable: true },
    // tunai methods go into the cash drawer total on Buku Kas.
    { type: "bool", name: "is_cash" },
    { type: "bool", name: "active" },
  ], { listRule: AUTHED, viewRule: AUTHED, createRule: OWNER, updateRule: OWNER, deleteRule: OWNER });

  const vouchers = base("vouchers", [
    { type: "text", name: "code", required: true, max: 30, presentable: true },
    { type: "select", name: "kind", required: true, maxSelect: 1, values: ["persen", "nominal"] },
    money("value", { required: true }),
    money("max_discount"),
    money("min_purchase"),
    // 0 = unlimited
    money("quota"),
    money("used"),
    { type: "date", name: "valid_until" },
    // Set = a personal voucher for one loyal customer.
    rel("customer", users),
    { type: "bool", name: "active" },
  ], {
    listRule: `${MANAGER} || customer = @request.auth.id`,
    viewRule: `${STAFF} || customer = @request.auth.id`,
    createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
  }, ["CREATE UNIQUE INDEX idx_vouchers_code ON vouchers (code)"]);

  // ── transaksi ──
  const SALE_READ = `${MANAGER} || customer = @request.auth.id || (@request.auth.role = "kasir" && cashier = @request.auth.id && created >= @todayStart)`;
  const sales = base("sales", [
    { type: "text", name: "number", required: true, max: 30, presentable: true },
    rel("cashier", users, { required: true }),
    rel("customer", users),
    money("subtotal"),
    money("discount"),
    rel("voucher", vouchers),
    money("points_used"),
    money("total"),
    money("paid"),
    money("change"),
    rel("payment_method", paymentMethods),
    { type: "select", name: "status", required: true, maxSelect: 1, values: ["lunas", "piutang", "batal"] },
    money("points_earned"),
    { type: "text", name: "note", max: 300 },
  ], { listRule: SALE_READ, viewRule: SALE_READ, createRule: null, updateRule: null, deleteRule: null },
    ["CREATE UNIQUE INDEX idx_sales_number ON sales (number)", "CREATE INDEX idx_sales_created ON sales (created)"]);

  const ITEM_READ = `${MANAGER} || sale.customer = @request.auth.id || (@request.auth.role = "kasir" && sale.cashier = @request.auth.id && sale.created >= @todayStart)`;
  base("sale_items", [
    rel("sale", sales, { required: true, cascadeDelete: true }),
    rel("product", products, { required: true }),
    // Snapshots — a later price change must not rewrite old receipts.
    { type: "text", name: "name", required: true, max: 120 },
    { type: "number", name: "qty", required: true, min: 1, onlyInt: true },
    money("price"),
    money("hpp"),
    money("subtotal"),
  ], { listRule: ITEM_READ, viewRule: ITEM_READ, createRule: null, updateRule: null, deleteRule: null },
    ["CREATE INDEX idx_sale_items_sale ON sale_items (sale)"]);

  // ── piutang ──
  const RECV_READ = `${MANAGER} || customer = @request.auth.id`;
  const receivables = base("receivables", [
    rel("sale", sales, { required: true }),
    rel("customer", users, { required: true }),
    money("amount"),
    money("paid"),
    { type: "select", name: "status", required: true, maxSelect: 1, values: ["belum", "lunas", "batal"] },
    { type: "date", name: "due_date" },
  ], { listRule: RECV_READ, viewRule: RECV_READ, createRule: null, updateRule: null, deleteRule: null });

  base("receivable_payments", [
    rel("receivable", receivables, { required: true }),
    money("amount", { required: true, min: 1 }),
    rel("payment_method", paymentMethods),
    rel("by", users),
    { type: "text", name: "note", max: 300 },
  ], {
    listRule: `${MANAGER} || receivable.customer = @request.auth.id`,
    viewRule: `${MANAGER} || receivable.customer = @request.auth.id`,
    // Written only by POST /api/receivables/pay.
    createRule: null, updateRule: null, deleteRule: null,
  });

  // ── keuangan ──
  base("expenses", [
    { type: "date", name: "date", required: true },
    { type: "text", name: "category", required: true, max: 60 },
    money("amount", { required: true, min: 1 }),
    rel("payment_method", paymentMethods),
    { type: "text", name: "note", max: 300 },
    rel("by", users),
  ], { listRule: MANAGER, viewRule: MANAGER, createRule: MANAGER, updateRule: MANAGER, deleteRule: OWNER });

  // Manual Buku Kas lines only (modal awal, setoran, prive…). The Buku Kas
  // report adds sales, debt payments and expenses from their own tables at
  // read time, so an edited expense can never leave the cash book stale.
  base("cash_entries", [
    { type: "date", name: "date", required: true },
    { type: "select", name: "type", required: true, maxSelect: 1, values: ["masuk", "keluar"] },
    money("amount", { required: true }),
    rel("payment_method", paymentMethods),
    { type: "text", name: "note", required: true, max: 300 },
    rel("by", users),
  ], {
    listRule: OWNER, viewRule: OWNER, createRule: OWNER, updateRule: OWNER, deleteRule: OWNER,
  }, ["CREATE INDEX idx_cash_entries_date ON cash_entries (date)"]);

  // ── karyawan ──
  base("employees", [
    { type: "text", name: "name", required: true, max: 100, presentable: true },
    { type: "text", name: "phone", max: 20 },
    { type: "text", name: "position", max: 60 },
    // Optional link to a staff login.
    rel("user", users),
    { type: "bool", name: "active" },
  ], { listRule: MANAGER, viewRule: MANAGER, createRule: MANAGER, updateRule: MANAGER, deleteRule: OWNER });

  // ── seed rows ──
  const settings = new Record(app.findCollectionByNameOrId("settings"));
  settings.load({
    store_name: "Nelin Batik", business_type: "Baju dan pakaian",
    address: "Jl. Gatot Subroto Banyurip Alit, Pekalongan Selatan, Kota Pekalongan",
    receipt_footer: "*** TERIMA KASIH ***\nTelah Berbelanja Di Toko Kami\n\nNb: Barang Yang Sudah Dibeli\nTidak Dapat Ditukar/Dikembalikan",
    points_per_rupiah: 10000, point_value: 100,
  });
  app.save(settings);
  for (const [name, isCash] of [["Tunai", true], ["QRIS", false], ["Transfer", false]]) {
    const pm = new Record(paymentMethods);
    pm.load({ name, is_cash: isCash, active: true });
    app.save(pm);
  }
}, (app) => {
  for (const n of ["employees", "cash_entries", "expenses", "receivable_payments", "receivables", "sale_items", "sales", "vouchers", "payment_methods", "stock_moves", "products", "categories", "settings"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});

/// <reference path="../pb_data/types.d.ts" />
// Online store (separate front end: ~/nelin-store). Adds what the shop page
// shows about a product, the shop's payment details, and web_orders.
//
// Stock for a web order is reserved the moment the order is placed (stock
// move "pesanan"), so the store and the till never sell the same last piece.
// An unpaid order that expires or is cancelled gives it back ("batal pesanan").
// Once the admin confirms payment the order also becomes a normal sale, so it
// shows up in Laporan, Laba Rugi and Buku Kas like any till sale.
migrate((app) => {
  const OWNER = '@request.auth.role = "owner"';
  const MANAGER = '(@request.auth.role = "owner" || @request.auth.role = "admin")';

  const products = app.findCollectionByNameOrId("products");
  products.fields.add(new TextField({ name: "description", max: 2000 }));
  // grams, for shipping; 0 means "use the default" (250 g, a folded tunic)
  products.fields.add(new NumberField({ name: "weight", min: 0, onlyInt: true }));
  products.fields.add(new BoolField({ name: "hide_online" }));
  app.save(products);

  const moves = app.findCollectionByNameOrId("stock_moves");
  moves.fields.getByName("type").values = ["masuk", "keluar", "opname", "penjualan", "batal", "pesanan", "batal_pesanan"];
  app.save(moves);

  const settings = app.findCollectionByNameOrId("settings");
  settings.fields.add(new FileField({ name: "qris", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/png", "image/jpeg", "image/webp"] }));
  settings.fields.add(new TextField({ name: "bank_name", max: 60 }));
  settings.fields.add(new TextField({ name: "bank_account", max: 40 }));
  settings.fields.add(new TextField({ name: "bank_holder", max: 100 }));
  settings.fields.add(new TextField({ name: "wa_number", max: 20 }));
  settings.fields.add(new TextField({ name: "email", max: 120 }));
  settings.fields.add(new TextField({ name: "open_hours", max: 60 }));
  settings.fields.add(new TextField({ name: "store_tagline", max: 200 }));
  app.save(settings);

  const users = app.findCollectionByNameOrId("users");
  const methods = app.findCollectionByNameOrId("payment_methods");
  const sales = app.findCollectionByNameOrId("sales");
  const orders = new Collection({
    type: "base",
    name: "web_orders",
    // Customers never use the records API: they go through /api/store/*
    // with the order number + secret token. Staff read and act via routes.
    listRule: MANAGER, viewRule: MANAGER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "number", required: true, max: 30, presentable: true },
      { type: "text", name: "token", required: true, max: 64, hidden: true },
      { type: "select", name: "status", required: true, maxSelect: 1, values: ["menunggu_bayar", "menunggu_verifikasi", "diproses", "dikirim", "siap_diambil", "selesai", "batal", "kedaluwarsa"] },
      { type: "text", name: "name", required: true, max: 100 },
      { type: "text", name: "phone", required: true, max: 20 },
      { type: "text", name: "email", max: 120 },
      { type: "json", name: "address", maxSize: 4000 },
      // [{product, name, sku, qty, price, hpp, weight}]
      { type: "json", name: "items", maxSize: 50000 },
      { type: "select", name: "delivery", required: true, maxSelect: 1, values: ["kirim", "ambil"] },
      { type: "text", name: "courier", max: 40 },
      { type: "text", name: "service", max: 40 },
      { type: "text", name: "etd", max: 20 },
      { type: "number", name: "weight", min: 0, onlyInt: true },
      { type: "number", name: "subtotal", min: 0, onlyInt: true },
      { type: "number", name: "shipping", min: 0, onlyInt: true },
      { type: "bool", name: "shipping_adjusted" },
      // Small random amount added to the total so a transfer can be matched
      // to its order at a glance (Rp 1.234.567 → order WEB-…).
      { type: "number", name: "unique_code", min: 0, onlyInt: true },
      { type: "number", name: "total", min: 0, onlyInt: true },
      { type: "select", name: "payment", required: true, maxSelect: 1, values: ["qris", "transfer"] },
      { type: "file", name: "proof", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"] },
      { type: "text", name: "resi", max: 60 },
      { type: "text", name: "note", max: 500 },
      { type: "text", name: "admin_note", max: 500 },
      { type: "date", name: "expires_at" },
      { type: "json", name: "history", maxSize: 20000 },
      { type: "relation", name: "sale", collectionId: sales.id, maxSelect: 1 },
      { type: "relation", name: "customer", collectionId: users.id, maxSelect: 1 },
      { type: "relation", name: "payment_method", collectionId: methods.id, maxSelect: 1 },
      { type: "text", name: "ip", max: 64, hidden: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_web_orders_number ON web_orders (number)",
      "CREATE INDEX idx_web_orders_status ON web_orders (status, created)",
      "CREATE INDEX idx_web_orders_phone ON web_orders (phone)",
    ],
  });
  app.save(orders);

  // Placeholder payment details, clearly marked, until Mas Alin fills them in.
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("bank_name", "BCA (CONTOH)");
  s.set("bank_account", "0000000000");
  s.set("bank_holder", "NELIN BATIK (contoh, belum asli)");
  s.set("wa_number", "0895422763568");
  s.set("open_hours", "08.00–21.00 WIB");
  s.set("store_tagline", "Batik pesisir dari Banyurip Alit, Pekalongan");
  app.save(s);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("web_orders")); } catch (_) {}
});

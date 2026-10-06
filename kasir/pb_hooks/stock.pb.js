/// <reference path="../pb_data/types.d.ts" />

// POST /api/stock/move — manual stock change by owner/admin.
// Body: { product, type: "masuk"|"keluar"|"opname", qty?, counted?, note? }
//   masuk  qty > 0 arrives       keluar  qty > 0 leaves (rusak, hilang, retur ke supplier)
//   opname counted = physical count; the difference is recorded
routerAdd("POST", "/api/stock/move", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const b = e.requestInfo().body || {};
  if (["masuk", "keluar", "opname"].indexOf(b.type) === -1) throw new BadRequestError("Tipe harus masuk, keluar atau opname.");
  if (b.type !== "opname" && !(L.int(b.qty, "Qty") > 0)) throw new BadRequestError("Qty harus lebih dari 0.");

  let id = "";
  e.app.runInTransaction((tx) => {
    let p;
    try { p = tx.findRecordById("products", b.product); } catch (_) { throw new BadRequestError("Produk tidak ditemukan."); }
    const qty = b.type === "keluar" ? -L.int(b.qty, "Qty") : L.int(b.qty || 0, "Qty");
    id = L.moveStock(tx, { product: p, type: b.type, qty, counted: b.counted, note: String(b.note || "").slice(0, 300), by: e.auth.id }).id;
  });
  return e.json(200, e.app.findRecordById("stock_moves", id));
}, $apis.requireAuth("users"));

// POST /api/receivables/pay — record a bon (debt) payment. Owner, admin and
// the shared kasir login (customers pay their bon at the counter).
// Body: { receivable, amount, payment_method, note? }
routerAdd("POST", "/api/receivables/pay", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const b = e.requestInfo().body || {};
  const amount = L.int(b.amount, "Jumlah");
  if (amount < 1) throw new BadRequestError("Jumlah harus lebih dari 0.");

  let result = null;
  e.app.runInTransaction((tx) => {
    let rc;
    try { rc = tx.findRecordById("receivables", b.receivable); } catch (_) { throw new NotFoundError("Piutang tidak ditemukan."); }
    if (rc.getString("status") !== "belum") throw new BadRequestError("Piutang ini sudah " + rc.getString("status") + ".");
    const left = rc.getInt("amount") - rc.getInt("paid");
    if (amount > left) throw new BadRequestError(`Sisa piutang hanya Rp ${L.idr(left)}.`);
    let pm;
    try { pm = tx.findRecordById("payment_methods", b.payment_method); } catch (_) { throw new BadRequestError("Pilih metode pembayaran."); }
    if (!pm.getBool("active")) throw new BadRequestError(`Metode ${pm.getString("name")} tidak dipakai lagi. Pilih Tunai atau Transfer.`);

    const pay = new Record(tx.findCollectionByNameOrId("receivable_payments"));
    pay.load({ receivable: rc.id, amount, payment_method: pm.id, by: e.auth.id, note: String(b.note || "").slice(0, 300) });
    tx.save(pay);

    rc.set("paid", rc.getInt("paid") + amount);
    if (rc.getInt("paid") >= rc.getInt("amount")) rc.set("status", "lunas");
    tx.save(rc);

    // Points were retired (2026-10-06): paying a bon earns nothing.
    const sale = tx.findRecordById("sales", rc.getString("sale"));
    // sale.paid stays what was paid at the till — Buku Kas counts this
    // payment from receivable_payments, so adding it here would double it.
    if (rc.getString("status") === "lunas") sale.set("status", "lunas");
    tx.save(sale);
    result = { payment: pay.id, receivable: rc.id, left: rc.getInt("amount") - rc.getInt("paid") };
  });
  return e.json(200, result);
}, $apis.requireAuth("users"));

// GET /api/bon/open?q=&customer= — open bons for the counter: search by
// pelanggan name, username, phone or receipt number, or list one pelanggan's
// bons. Staff only (the kasir can't read receivables through the records API).
routerAdd("GET", "/api/bon/open", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const q = e.requestInfo().query;
  const p = {};
  let where = "rc.status = 'belum'";
  const cust = String(q.customer || "").trim();
  if (cust) { where += " AND rc.customer = {:c}"; p.c = cust; }
  const term = String(q.q || "").trim().toLowerCase().slice(0, 60);
  if (term) {
    // LIKE with the user's text escaped, so % and _ match literally
    p.t = "%" + term.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    where += ` AND (lower(COALESCE(u.name,'')) LIKE {:t} ESCAPE '\\' OR lower(COALESCE(u.username,'')) LIKE {:t} ESCAPE '\\'
      OR COALESCE(u.phone,'') LIKE {:t} ESCAPE '\\' OR lower(s.number) LIKE {:t} ESCAPE '\\')`;
  }
  const items = L.query(e.app, `SELECT rc.id, s.number, s.created, rc.amount, rc.paid, COALESCE(rc.due_date,'') AS due,
      rc.customer, COALESCE(NULLIF(u.name,''), u.username, '') AS name, COALESCE(u.phone,'') AS phone
      FROM receivables rc JOIN sales s ON s.id = rc.sale LEFT JOIN users u ON u.id = rc.customer
      WHERE ${where} ORDER BY s.created DESC LIMIT 50`, p,
    { id: "", number: "", created: "", amount: 0, paid: 0, due: "", customer: "", name: "", phone: "" });
  return e.json(200, { items, total: items.reduce((a, r) => a + r.amount - r.paid, 0) });
}, $apis.requireAuth("users"));

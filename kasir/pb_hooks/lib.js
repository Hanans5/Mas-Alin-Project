// Shared helpers for the *.pb.js route files. PocketBase runs every handler
// in its own isolated JS context, so handlers `require()` this file inside the
// handler body rather than closing over top-level functions.

const WIB_MS = 7 * 3600 * 1000; // the shop runs on Asia/Jakarta, UTC+7, no DST

// "YYYY-MM-DD" for the WIB calendar day containing `ms`.
function wibDate(ms) {
  return new Date((ms ?? Date.now()) + WIB_MS).toISOString().slice(0, 10);
}

// UTC bounds, in PocketBase's datetime format, of WIB days from..to inclusive.
// 2026-10-03 WIB starts at 2026-10-02 17:00:00 UTC.
function wibRange(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from || "") || !re.test(to || "")) throw new BadRequestError("Tanggal harus YYYY-MM-DD.");
  const start = Date.parse(from + "T00:00:00Z") - WIB_MS;
  const end = Date.parse(to + "T00:00:00Z") + 86400000 - WIB_MS;
  if (end <= start) throw new BadRequestError("Tanggal akhir sebelum tanggal awal.");
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ");
  return { from: fmt(start), to: fmt(end) };
}

// Rupiah digits with dots. The JS engine here has no Intl, so
// toLocaleString("id-ID") throws — never use it in pb_hooks.
function idr(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// A superadmin has the owner's rights everywhere (the API rules keep owner
// accounts out of a superadmin's reach); realRole() tells the two apart.
function role(e) {
  const r = realRole(e);
  return r === "superadmin" ? "owner" : r;
}
function realRole(e) {
  return e.auth ? e.auth.getString("role") : "";
}

function requireRole(e, roles) {
  if (!e.auth || e.auth.collection().name !== "users" || roles.indexOf(role(e)) === -1) {
    throw new ForbiddenError("Tidak punya akses.");
  }
}

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new BadRequestError(`${name} harus bilangan bulat.`);
  return n;
}

// The only way stock changes. Writes the ledger row and the product's new
// stock together; call it inside runInTransaction.
//   type masuk/keluar/penjualan/batal: qty is the signed change
//   type opname: counted is the physical count, qty becomes the difference
function moveStock(tx, { product, type, qty, counted, ref, note, by }) {
  const p = typeof product === "string" ? tx.findRecordById("products", product) : product;
  const before = p.getInt("stock");
  let change;
  if (type === "opname") {
    counted = int(counted, "Jumlah hitung");
    if (counted < 0) throw new BadRequestError("Jumlah hitung tidak boleh minus.");
    change = counted - before;
  } else {
    change = int(qty, "Qty");
    if (change === 0) throw new BadRequestError("Qty tidak boleh 0.");
  }
  const after = before + change;
  if (after < 0) throw new BadRequestError(`Stok ${p.getString("name")} tidak cukup (sisa ${before}).`);
  p.set("stock", after);
  tx.save(p);

  const m = new Record(tx.findCollectionByNameOrId("stock_moves"));
  m.load({
    product: p.id, type, qty: change, counted: type === "opname" ? counted : 0,
    stock_after: after, ref: ref || "", note: note || "", by: by || "",
  });
  tx.save(m);
  return m;
}

// Next sale number for today (WIB): TRX-261003-0001.
function nextSaleNumber(tx) {
  const prefix = "TRX-" + wibDate().slice(2).replace(/-/g, "") + "-";
  const rows = arrayOf(new DynamicModel({ n: "" }));
  tx.db().newQuery("SELECT number AS n FROM sales WHERE number LIKE {:p} ORDER BY length(number) DESC, number DESC LIMIT 1")
    .bind({ p: prefix + "%" }).all(rows);
  const last = rows.length ? parseInt(rows[0].n.slice(prefix.length), 10) : 0;
  return prefix + String(last + 1).padStart(4, "0");
}

// Voucher discount on `subtotal`, or throws why it can't be used.
function voucherDiscount(tx, code, subtotal, customerId) {
  let v;
  try {
    v = tx.findFirstRecordByFilter("vouchers", "code = {:c}", { c: String(code).trim().toUpperCase() });
  } catch (_) {
    throw new BadRequestError("Kode voucher tidak ditemukan.");
  }
  if (!v.getBool("active")) throw new BadRequestError("Voucher tidak aktif.");
  const until = v.getString("valid_until");
  if (until && Date.parse(until.replace(" ", "T")) < Date.now()) throw new BadRequestError("Voucher sudah kedaluwarsa.");
  const quota = v.getInt("quota");
  if (quota > 0 && v.getInt("used") >= quota) throw new BadRequestError("Kuota voucher sudah habis.");
  if (subtotal < v.getInt("min_purchase")) throw new BadRequestError(`Minimal belanja Rp ${idr(v.getInt("min_purchase"))}.`);
  const owner = v.getString("customer");
  if (owner && owner !== customerId) throw new BadRequestError("Voucher ini khusus untuk pelanggan lain.");

  let d = v.getString("kind") === "persen" ? Math.floor(subtotal * v.getInt("value") / 100) : v.getInt("value");
  const cap = v.getInt("max_discount");
  if (cap > 0) d = Math.min(d, cap);
  return { voucher: v, discount: Math.min(d, subtotal) };
}

function settings(tx) {
  return tx.findFirstRecordByFilter("settings", "id != ''");
}

// Run a SELECT and return plain objects. `shape` gives the column names and
// their types by example (0 for numbers, "" for text).
function query(tx, sql, params, shape) {
  const rows = arrayOf(new DynamicModel(shape));
  tx.db().newQuery(sql).bind(params || {}).all(rows);
  return rows.map((r) => {
    const o = {};
    for (const k in shape) o[k] = r[k];
    return o;
  });
}

// Prices a cart from the database. Shared by /api/pos/preview and checkout so
// the till shows exactly what will be charged. Client prices are ignored.
// Each line has one price for every pcs (Mas Alin, 2026-10-08: no more
// automatic kodian per 20 pcs). `tier` on an item picks it:
//   normal (default) = the product's price
//   kodian           = the product's price_kodi, any staff (kasir too, Hanan 2026-10-08)
//   jumbo            = the product's price_jumbo, owner only
//   kustom + price   = a typed price per pcs (> 0), owner only
// Older clients may still send `kodian: true` or a bare `price`.
const KODI = 20;
const TIERS = ["normal", "kodian", "jumbo", "kustom"];
function itemTier(e, it) {
  const hasPrice = it.price !== undefined && it.price !== null && it.price !== "";
  let t = it.tier ? String(it.tier) : hasPrice ? "kustom" : it.kodian === true ? "kodian" : "normal";
  if (t === "custom") t = "kustom";
  if (TIERS.indexOf(t) === -1) throw new BadRequestError("Jenis harga tidak dikenal.");
  const r = e ? role(e) : "";
  if (t === "kodian" && ["owner", "admin", "kasir"].indexOf(r) === -1) {
    throw new ForbiddenError("Harga kodian hanya untuk staf toko.");
  }
  if ((t === "jumbo" || t === "kustom") && r !== "owner") {
    throw new ForbiddenError(t === "jumbo" ? "Hanya pemilik yang bisa memakai harga jumbo." : "Hanya pemilik yang bisa mengubah harga.");
  }
  let price = null;
  if (t === "kustom") {
    price = int(it.price, "Harga kustom");
    if (price < 1) throw new BadRequestError("Harga kustom harus lebih dari 0.");
  }
  return { tier: t, price };
}
// The whole line at one price, or throws when the product has no such price.
function splitPrice(p, qty, want) {
  const w = want || {};
  if (w.tier === "kustom") return [{ qty, price: w.price, tier: "kustom" }];
  const field = { kodian: "price_kodi", jumbo: "price_jumbo" }[w.tier];
  if (field) {
    if (!(p.getInt(field) > 0)) throw new BadRequestError(`${p.getString("name")} belum punya harga ${w.tier}.`);
    return [{ qty, price: p.getInt(field), tier: w.tier }];
  }
  return [{ qty, price: p.getInt("price"), tier: "normal" }];
}

function priceCart(tx, e, b) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new BadRequestError("Keranjang kosong.");
  if (items.length > 200) throw new BadRequestError("Terlalu banyak item.");
  // Merge duplicate lines so stock is checked against the real total; a
  // special price on any of them covers the merged line.
  const want = {};
  for (const it of items) {
    const q = int(it.qty, "Qty");
    if (q < 1) throw new BadRequestError("Qty minimal 1.");
    const t = itemTier(e, it);
    const w = want[it.product] || (want[it.product] = { qty: 0, tier: "normal", price: null });
    w.qty += q;
    if (t.tier !== "normal") Object.assign(w, t);
  }

  const lines = [];
  let subtotal = 0;
  for (const pid in want) {
    let p;
    try { p = tx.findRecordById("products", pid); } catch (_) { throw new BadRequestError("Produk tidak ditemukan."); }
    if (!p.getBool("active")) throw new BadRequestError(`${p.getString("name")} tidak aktif.`);
    const qty = want[pid].qty;
    if (p.getInt("stock") < qty) throw new BadRequestError(`Stok ${p.getString("name")} tidak cukup (sisa ${p.getInt("stock")}).`);
    for (const l of splitPrice(p, qty, want[pid])) {
      lines.push({ p, qty: l.qty, price: l.price, tier: l.tier, hpp: p.getInt("hpp"), subtotal: l.price * l.qty });
      subtotal += l.price * l.qty;
    }
  }

  let customer = null;
  if (b.customer) {
    try { customer = tx.findRecordById("users", b.customer); } catch (_) { throw new BadRequestError("Pelanggan tidak ditemukan."); }
    if (customer.getString("role") !== "pelanggan") throw new BadRequestError("Pelanggan tidak valid.");
  }

  // Points and vouchers were retired (Mas Alin, 2026-10-06): voucher_code and
  // points_used are no longer read. Only the owner/admin manual discount stays.
  let discount = 0;
  const voucher = null, vDisc = 0, pDisc = 0;
  if (b.discount) {
    if (role(e) === "kasir") throw new ForbiddenError("Kasir tidak bisa memberi diskon manual.");
    const d = int(b.discount, "Diskon");
    if (d < 0) throw new BadRequestError("Diskon tidak boleh minus.");
    discount += d;
  }

  const s = settings(tx);
  const pointsUsed = 0;
  discount = Math.min(discount, subtotal);
  const total = subtotal - discount;
  return { lines, subtotal, discount, total, customer, voucher, pointsUsed, settings: s, voucherDiscount: vDisc, pointsDiscount: pDisc };
}

// ── item swaps ──
// What can still be swapped from a sale: per product, sold minus already
// returned in earlier swaps, at the average unit price and HPP paid.
function returnable(tx, sale) {
  const out = {};
  for (const it of tx.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: sale.id })) {
    const pid = it.getString("product");
    const r = out[pid] || (out[pid] = { product: pid, name: it.getString("name"), sold: 0, value: 0, hppValue: 0, returned: 0 });
    if (it.getInt("qty") > 0) { r.sold += it.getInt("qty"); r.value += it.getInt("subtotal"); r.hppValue += it.getInt("hpp") * it.getInt("qty"); }
  }
  for (const sw of tx.findRecordsByFilter("sales", "ref_sale = {:s} && status != 'batal'", "", 0, 0, { s: sale.id })) {
    for (const it of tx.findRecordsByFilter("sale_items", "sale = {:s} && qty < 0", "", 0, 0, { s: sw.id })) {
      if (out[it.getString("product")]) out[it.getString("product")].returned += -it.getInt("qty");
    }
  }
  return Object.values(out).map((r) => ({
    product: r.product, name: r.name, sold: r.sold, returned: r.returned, left: r.sold - r.returned,
    price: r.sold ? Math.round(r.value / r.sold) : 0, hpp: r.sold ? Math.round(r.hppValue / r.sold) : 0,
  }));
}
// A sale by its number (TRX-261006-0001, any case) or record id.
// ── Pre-Order ──
// Prices a pre-order like the till (one price per line; kodian, jumbo and
// kustom owner only, manual discount owner/admin) but without a stock
// check: the goods may not exist yet. Custom lines ({ custom: true, name,
// price, hpp?, qty }) are typed by owner/admin and have no product.
function pricePreorder(tx, e, b) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new BadRequestError("Keranjang kosong.");
  if (items.length > 200) throw new BadRequestError("Terlalu banyak item.");
  const manager = ["owner", "admin"].includes(role(e));
  const want = {}, lines = [];
  let subtotal = 0;
  for (const it of items) {
    const q = int(it.qty, "Qty");
    if (q < 1) throw new BadRequestError("Qty minimal 1.");
    if (it.custom) {
      if (!manager) throw new ForbiddenError("Hanya pemilik/admin yang bisa menambah barang custom.");
      const name = String(it.name || "").trim().slice(0, 120);
      if (!name) throw new BadRequestError("Isi nama barang custom.");
      const price = int(it.price, "Harga"), hpp = int(it.hpp || 0, "Modal");
      if (price < 1) throw new BadRequestError("Harga barang custom harus lebih dari 0.");
      if (hpp < 0) throw new BadRequestError("Modal tidak boleh minus.");
      lines.push({ product: "", name, qty: q, price, hpp, tier: "custom", subtotal: price * q });
      subtotal += price * q;
      continue;
    }
    const t = itemTier(e, it);
    const w = want[it.product] || (want[it.product] = { qty: 0, tier: "normal", price: null });
    w.qty += q;
    if (t.tier !== "normal") Object.assign(w, t);
  }
  for (const pid in want) {
    let p;
    try { p = tx.findRecordById("products", pid); } catch (_) { throw new BadRequestError("Produk tidak ditemukan."); }
    if (!p.getBool("active")) throw new BadRequestError(`${p.getString("name")} tidak aktif.`);
    for (const l of splitPrice(p, want[pid].qty, want[pid])) {
      lines.push({ product: p.id, name: p.getString("name"), qty: l.qty, price: l.price, hpp: p.getInt("hpp"), tier: l.tier, subtotal: l.price * l.qty });
      subtotal += l.price * l.qty;
    }
  }
  let customer = null;
  if (!b.customer) throw new BadRequestError("Pre-order harus atas nama pelanggan.");
  try { customer = tx.findRecordById("users", b.customer); } catch (_) { throw new BadRequestError("Pelanggan tidak ditemukan."); }
  if (customer.getString("role") !== "pelanggan") throw new BadRequestError("Pelanggan tidak valid.");
  let discount = 0;
  if (b.discount) {
    if (!manager) throw new ForbiddenError("Kasir tidak bisa memberi diskon manual.");
    discount = int(b.discount, "Diskon");
    if (discount < 0) throw new BadRequestError("Diskon tidak boleh minus.");
  }
  discount = Math.min(discount, subtotal);
  return { lines, subtotal, discount, total: subtotal - discount, customer };
}
function nextPoNumber(tx) {
  const prefix = "PO-" + wibDate().slice(2).replace(/-/g, "") + "-";
  const rows = query(tx, "SELECT number AS n FROM preorders WHERE number LIKE {:p} ORDER BY length(number) DESC, number DESC LIMIT 1", { p: prefix + "%" }, { n: "" });
  return prefix + String((rows.length ? parseInt(rows[0].n.slice(prefix.length), 10) : 0) + 1).padStart(4, "0");
}
// Minimum DP for a pre-order total: settings.po_min_dp percent (owner sets), rounded up to Rp 1.000.
function minDp(tx, total) {
  const pct = Math.max(0, Math.min(100, settings(tx).getInt("po_min_dp")));
  return Math.min(total, Math.ceil(total * pct / 100 / 1000) * 1000);
}

// Receipts rebuilt from the old system's totals (tools/migrasi/gen_sales.py):
// their stock never left through this kasir, so they can't be voided or swapped.
const LEGACY_NOTE = "Sistem lama";
function isLegacySale(sale) {
  return sale.getString("note").startsWith(LEGACY_NOTE);
}
function findSale(tx, key) {
  const k = String(key || "").trim();
  try { return tx.findFirstRecordByFilter("sales", "number = {:n}", { n: k.toUpperCase() }); } catch (_) {}
  try { return tx.findRecordById("sales", k); } catch (_) {}
  throw new NotFoundError("Transaksi tidak ditemukan.");
}

// The assistant who served the sale (one shared kasir login, so it's picked
// per sale). Required as soon as any karyawan is active; "toko" is the
// explicit choice for a sale with no karyawan (the owner selling, like the
// old system's "Toko" row), saved as no employee.
function pickEmployee(tx, id) {
  if (id === "toko") return "";
  const active = query(tx, "SELECT COUNT(*) AS n FROM employees WHERE active = 1", {}, { n: 0 })[0].n;
  if (!id) {
    if (active) throw new BadRequestError("Pilih karyawan yang melayani, atau Toko.");
    return "";
  }
  let emp;
  try { emp = tx.findRecordById("employees", id); } catch (_) { throw new BadRequestError("Karyawan tidak ditemukan."); }
  if (!emp.getBool("active")) throw new BadRequestError(`${emp.getString("name")} sudah tidak aktif.`);
  return emp.id;
}

// ── payments at the till ──
// Turns the request into the money actually kept, per method:
//   payments: [{ method, amount }] (several methods allowed; same method merged)
//   legacy:   { payment_method, paid } = one payment
// Rules: only active methods; non-cash (transfer) can't exceed the total;
// change only comes out of cash. If the money is short, the rest becomes a
// bon/DP only with credit=true and a named customer (checked by the caller).
// Returns { rows:[{pm, amount}], handed, kept, change, short }.
function takePayments(tx, b, total) {
  const raw = Array.isArray(b.payments) ? b.payments : (b.payment_method ? [{ method: b.payment_method, amount: b.paid }] : []);
  const by = {};
  for (const r of raw) {
    const amount = int(r.amount || 0, "Jumlah bayar");
    if (amount < 0) throw new BadRequestError("Jumlah bayar tidak boleh minus.");
    if (!amount) continue;
    let pm;
    try { pm = tx.findRecordById("payment_methods", r.method); } catch (_) { throw new BadRequestError("Pilih metode pembayaran."); }
    if (!pm.getBool("active")) throw new BadRequestError(`Metode ${pm.getString("name")} tidak dipakai lagi. Pilih Tunai atau Transfer.`);
    (by[pm.id] = by[pm.id] || { pm, amount: 0 }).amount += amount;
  }
  const rows = Object.values(by);
  let cash = 0, nonCash = 0;
  for (const r of rows) { if (r.pm.getBool("is_cash")) cash += r.amount; else nonCash += r.amount; }
  if (nonCash > total) throw new BadRequestError(`Transfer (Rp ${idr(nonCash)}) melebihi total Rp ${idr(total)}. Kembalian hanya dari uang tunai.`);
  const handed = cash + nonCash;
  const change = Math.max(0, handed - total);
  // Change leaves the drawer: the cash rows keep only what stays.
  let toTake = change;
  for (const r of rows) {
    if (toTake && r.pm.getBool("is_cash")) { const t = Math.min(toTake, r.amount); r.amount -= t; toTake -= t; }
  }
  const kept = rows.filter((r) => r.amount > 0);
  return { rows: kept, handed, kept: handed - change, change, short: Math.max(0, total - handed) };
}

// Old-system daily totals (legacy_sales) for WIB days d1..d2, oldest first.
// hpp = what the old report's profit implies (sales − discount − profit).
function legacyDays(tx, d1, d2) {
  return query(tx, `SELECT day, total, count, items, discount, profit, total - discount - profit AS hpp
      FROM legacy_sales WHERE day BETWEEN {:d1} AND {:d2} ORDER BY day`,
    { d1, d2 }, { day: "", total: 0, count: 0, items: 0, discount: 0, profit: 0, hpp: 0 });
}

// The old system's period: first and last day in legacy_sales ("" when none).
function legacySpan(tx) {
  return query(tx, `SELECT COALESCE(MIN(day),'') AS first, COALESCE(MAX(day),'') AS last FROM legacy_sales`, {}, { first: "", last: "" })[0];
}
// Old-system totals of one kind (pelanggan, karyawan, produk) keyed by ref.
function legacyTotals(tx, kind) {
  const out = {};
  for (const r of query(tx, `SELECT ref, total, trx, items, profit FROM legacy_totals WHERE kind = {:kind}`, { kind },
    { ref: "", total: 0, trx: 0, items: 0, profit: 0 })) out[r.ref] = r;
  return out;
}

module.exports = { realRole, pricePreorder, nextPoNumber, minDp, isLegacySale, legacySpan, legacyTotals, legacyDays, takePayments, pickEmployee, returnable, findSale, idr, priceCart, splitPrice, KODI, wibDate, wibRange, role, requireRole, int, moveStock, nextSaleNumber, voucherDiscount, settings, query };

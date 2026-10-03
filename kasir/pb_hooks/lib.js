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

function role(e) {
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
  tx.db().newQuery("SELECT number AS n FROM sales WHERE number LIKE {:p} ORDER BY number DESC LIMIT 1")
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
function priceCart(tx, e, b) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new BadRequestError("Keranjang kosong.");
  if (items.length > 200) throw new BadRequestError("Terlalu banyak item.");
  // Merge duplicate lines so stock is checked against the real total.
  const want = {};
  for (const it of items) {
    const q = int(it.qty, "Qty");
    if (q < 1) throw new BadRequestError("Qty minimal 1.");
    want[it.product] = (want[it.product] || 0) + q;
  }

  const lines = [];
  let subtotal = 0;
  for (const pid in want) {
    let p;
    try { p = tx.findRecordById("products", pid); } catch (_) { throw new BadRequestError("Produk tidak ditemukan."); }
    if (!p.getBool("active")) throw new BadRequestError(`${p.getString("name")} tidak aktif.`);
    const qty = want[pid];
    if (p.getInt("stock") < qty) throw new BadRequestError(`Stok ${p.getString("name")} tidak cukup (sisa ${p.getInt("stock")}).`);
    const price = p.getInt("price");
    lines.push({ p, qty, price, hpp: p.getInt("hpp"), subtotal: price * qty });
    subtotal += price * qty;
  }

  let customer = null;
  if (b.customer) {
    try { customer = tx.findRecordById("users", b.customer); } catch (_) { throw new BadRequestError("Pelanggan tidak ditemukan."); }
    if (customer.getString("role") !== "pelanggan") throw new BadRequestError("Pelanggan tidak valid.");
  }

  let discount = 0, voucher = null, vDisc = 0, pDisc = 0;
  if (b.voucher_code) {
    const v = voucherDiscount(tx, b.voucher_code, subtotal, customer ? customer.id : "");
    voucher = v.voucher;
    vDisc = v.discount;
    discount += vDisc;
  }
  if (b.discount) {
    if (role(e) === "kasir") throw new ForbiddenError("Kasir tidak bisa memberi diskon manual.");
    const d = int(b.discount, "Diskon");
    if (d < 0) throw new BadRequestError("Diskon tidak boleh minus.");
    discount += d;
  }

  const s = settings(tx);
  let pointsUsed = 0;
  if (b.points_used) {
    if (!customer) throw new BadRequestError("Pilih pelanggan untuk memakai poin.");
    pointsUsed = int(b.points_used, "Poin");
    if (pointsUsed < 0 || pointsUsed > customer.getInt("points")) throw new BadRequestError(`Poin tidak cukup (punya ${customer.getInt("points")}).`);
    pDisc = pointsUsed * s.getInt("point_value");
    discount += pDisc;
  }
  discount = Math.min(discount, subtotal);
  const total = subtotal - discount;
  return { lines, subtotal, discount, total, customer, voucher, pointsUsed, settings: s, voucherDiscount: vDisc, pointsDiscount: pDisc };
}

module.exports = { idr, priceCart, wibDate, wibRange, role, requireRole, int, moveStock, nextSaleNumber, voucherDiscount, settings, query };

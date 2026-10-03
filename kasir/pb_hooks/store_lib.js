// Online store helpers, required inside handlers (see lib.js for why).
//
// Shipping is an ESTIMATE from a table — there is no courier API key yet. The
// admin rechecks it over WhatsApp and can correct it before confirming the
// order. Swap estimateShipping() for Biteship / RajaOngkir when there's a key.

// Provinces → zone, counted from Pekalongan (Jawa Tengah).
const PROVINCES = {
  "Jawa Tengah": "A", "DI Yogyakarta": "A",
  "Jawa Barat": "B", "DKI Jakarta": "B", "Banten": "B", "Jawa Timur": "B",
  "Bali": "C", "Lampung": "C", "Sumatera Selatan": "C", "Bengkulu": "C", "Jambi": "C", "Bangka Belitung": "C",
  "Nusa Tenggara Barat": "C",
  "Riau": "D", "Kepulauan Riau": "D", "Sumatera Barat": "D", "Sumatera Utara": "D", "Aceh": "D",
  "Kalimantan Barat": "D", "Kalimantan Tengah": "D", "Kalimantan Selatan": "D", "Kalimantan Timur": "D", "Kalimantan Utara": "D",
  "Sulawesi Selatan": "D", "Sulawesi Barat": "D", "Sulawesi Tengah": "E", "Sulawesi Tenggara": "E", "Sulawesi Utara": "E", "Gorontalo": "E",
  "Nusa Tenggara Timur": "E",
  "Maluku": "F", "Maluku Utara": "F", "Papua": "F", "Papua Barat": "F", "Papua Barat Daya": "F", "Papua Tengah": "F", "Papua Pegunungan": "F", "Papua Selatan": "F",
};
// Rupiah per kg and delivery days, per zone A..F. Ballpark retail rates
// from Central Java in 2026; good enough to quote, rechecked by the admin.
const SERVICES = [
  { courier: "J&T Express", service: "EZ", kg: [8000, 11000, 21000, 33000, 45000, 78000], etd: ["1-2", "2-3", "3-4", "3-5", "4-6", "5-8"] },
  { courier: "JNE", service: "REG", kg: [9000, 12000, 22000, 34000, 47000, 82000], etd: ["1-2", "2-3", "3-4", "3-5", "4-6", "5-9"] },
  { courier: "JNE", service: "YES", kg: [17000, 22000, 39000, 58000, 77000, 0], etd: ["1", "1", "1-2", "1-2", "2", ""] },
  { courier: "Ninja Xpress", service: "Standard", kg: [8000, 10500, 20000, 31000, 43000, 74000], etd: ["2-3", "2-4", "3-5", "4-6", "5-7", "6-10"] },
  { courier: "SiCepat", service: "REG", kg: [8000, 11000, 21000, 32000, 44000, 76000], etd: ["1-2", "2-3", "3-4", "3-5", "4-6", "5-8"] },
  { courier: "AnterAja", service: "Reguler", kg: [8000, 11000, 20500, 31500, 44000, 77000], etd: ["1-2", "2-3", "3-4", "3-5", "4-6", "5-8"] },
];
const DEFAULT_WEIGHT = 250; // grams, a folded tunic in a poly mailer

// Couriers round up per kg after a 0.3 kg tolerance; 1 kg minimum.
function billableKg(grams) {
  const kg = grams / 1000;
  const whole = Math.floor(kg);
  return Math.max(1, kg - whole > 0.3 ? whole + 1 : whole);
}

function estimateShipping(province, grams) {
  const zone = PROVINCES[province];
  if (!zone) return [];
  const z = "ABCDEF".indexOf(zone);
  const kg = billableKg(grams);
  return SERVICES.filter((s) => s.kg[z] > 0).map((s) => ({
    courier: s.courier, service: s.service, cost: s.kg[z] * kg, etd: s.etd[z], kg,
  }));
}

// Weight + price for a cart, from the database. Throws on anything off.
function priceStoreCart(tx, items) {
  if (!Array.isArray(items) || !items.length) throw new BadRequestError("Keranjang kosong.");
  if (items.length > 50) throw new BadRequestError("Terlalu banyak barang dalam satu pesanan.");
  const want = {};
  for (const it of items) {
    const q = Number(it.qty);
    if (!Number.isInteger(q) || q < 1 || q > 200) throw new BadRequestError("Jumlah barang tidak valid.");
    want[it.product] = (want[it.product] || 0) + q;
  }
  const lines = [];
  let subtotal = 0, weight = 0;
  for (const pid in want) {
    let p;
    try { p = tx.findRecordById("products", pid); } catch (_) { throw new BadRequestError("Ada produk yang sudah tidak dijual."); }
    if (!p.getBool("active") || p.getBool("hide_online")) throw new BadRequestError(`${p.getString("name")} sudah tidak dijual online.`);
    const qty = want[pid];
    if (p.getInt("stock") < qty) {
      throw new BadRequestError(p.getInt("stock") > 0
        ? `Stok ${p.getString("name")} tinggal ${p.getInt("stock")}.`
        : `${p.getString("name")} sedang habis.`);
    }
    const w = (p.getInt("weight") || DEFAULT_WEIGHT) * qty;
    lines.push({ p, qty, price: p.getInt("price"), hpp: p.getInt("hpp"), weight: w });
    subtotal += p.getInt("price") * qty;
    weight += w;
  }
  return { lines, subtotal, weight };
}

// Phone → 62… so the same customer matches however they typed it.
function normPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d;
}

function nextOrderNumber(tx, wibDate) {
  const prefix = "WEB-" + wibDate.slice(2).replace(/-/g, "") + "-";
  const rows = arrayOf(new DynamicModel({ n: "" }));
  tx.db().newQuery("SELECT number AS n FROM web_orders WHERE number LIKE {:p} ORDER BY number DESC LIMIT 1").bind({ p: prefix + "%" }).all(rows);
  const last = rows.length ? parseInt(rows[0].n.slice(prefix.length), 10) : 0;
  return prefix + String(last + 1).padStart(3, "0");
}

// JSON fields read back as raw JSON text; parse them explicitly.
function json(rec, field) {
  try { return JSON.parse(rec.getString(field) || "null"); } catch (_) { return null; }
}

function addHistory(order, status, note, by) {
  let h = json(order, "history");
  if (!Array.isArray(h)) h = [];
  h.push({ at: new Date().toISOString(), status, note: note || "", by: by || "" });
  order.set("history", h);
}

// What a customer may see about their own order.
function publicOrder(app, o) {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  const file = (rec, field) => rec.getString(field) ? `/api/files/${rec.collection().id}/${rec.id}/${rec.getString(field)}` : "";
  return {
    number: o.getString("number"), status: o.getString("status"), created: o.getString("created"),
    expires_at: o.getString("expires_at"),
    name: o.getString("name"), phone: o.getString("phone"), email: o.getString("email"),
    address: json(o, "address"), items: json(o, "items"), delivery: o.getString("delivery"),
    courier: o.getString("courier"), service: o.getString("service"), etd: o.getString("etd"), weight: o.getInt("weight"),
    subtotal: o.getInt("subtotal"), shipping: o.getInt("shipping"), shipping_adjusted: o.getBool("shipping_adjusted"),
    unique_code: o.getInt("unique_code"), total: o.getInt("total"), payment: o.getString("payment"),
    has_proof: !!o.getString("proof"), resi: o.getString("resi"), note: o.getString("note"),
    history: json(o, "history"),
    pay: {
      qris: file(s, "qris"),
      bank_name: s.getString("bank_name"), bank_account: s.getString("bank_account"), bank_holder: s.getString("bank_holder"),
    },
    shop: { name: s.getString("store_name"), wa: s.getString("wa_number"), address: s.getString("address") },
  };
}

// Best-effort email; silently skipped when SMTP isn't configured.
function sendMail(app, to, subject, html) {
  try {
    if (!to || !app.settings().smtp.enabled) return;
    const msg = new MailerMessage({
      from: { address: app.settings().meta.senderAddress, name: app.settings().meta.senderName },
      to: [{ address: to }], subject, html,
    });
    app.newMailClient().send(msg);
  } catch (err) {
    app.logger().warn("store mail failed", "error", String(err));
  }
}

module.exports = { json, PROVINCES, estimateShipping, priceStoreCart, normPhone, nextOrderNumber, addHistory, publicOrder, sendMail, DEFAULT_WEIGHT };

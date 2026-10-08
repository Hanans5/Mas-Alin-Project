// A4 invoice (2026-10-08): what the public page /invoice.html#<token> shows
// for one sale. Only that sale's own data and the shop's public details;
// the pelanggan's phone is masked because the link can be forwarded.

// Theme base colours, the same as COLOR_THEMES in pb_public/index.html.
const THEME_HEX = {
  mahogany: "#4A0404", awal: "#E8590C", "dark-mahogany": "#482029", "light-mahogany": "#AD6D68", "cherry-mahogany": "#66362C",
  chestnut: "#954535", "burnt-mahogany": "#340A0D", "cinnamon-brown": "#9E6A19", "african-mahogany": "#CD4A4A", "american-mahogany": "#52352F",
  "bright-mahogany": "#86341F", "burnt-sienna": "#E97451", "deep-mahogany": "#553B39", "mahogany-brown": "#4C2B20",
  burgundy: "#800020", "deep-burgundy": "#4B0016", wine: "#722F37", merlot: "#730039", bordeaux: "#5F021F", oxblood: "#4A0000", maroon: "#800000", claret: "#7F1734",
};
const TIER = { kodian: "harga kodian", jumbo: "harga jumbo", kustom: "harga kustom", retur: "dikembalikan" };

function mask(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  return p.length > 6 ? p.slice(0, 4) + "*".repeat(p.length - 7) + p.slice(-3) : "";
}
function fileUrl(rec, field) {
  const f = rec.getString(field);
  return f ? `/api/files/${rec.collection().id}/${rec.id}/${encodeURIComponent(f)}` : "";
}
function one(app, col, id) { if (!id) return null; try { return app.findRecordById(col, id); } catch (_) { return null; } }
function pmName(app, id, cache) {
  if (!id) return "";
  if (!(id in cache)) { const m = one(app, "payment_methods", id); cache[id] = m ? m.getString("name") : ""; }
  return cache[id];
}

function build(app, sale) {
  const L = require(`${__hooks}/lib.js`);
  const st = app.findFirstRecordByFilter("settings", "id != ''");
  const walk = L.walkinId(app);
  const pm = {};
  const cust = one(app, "users", sale.getString("customer"));
  const emp = one(app, "employees", sale.getString("employee"));
  const cashier = one(app, "users", sale.getString("cashier"));
  // The staff who signs: the karyawan, else the login's name; the owner's own login and old receipts say "Toko".
  const crole = cashier ? cashier.getString("role") : "";
  const signer = emp ? emp.getString("name") : (!cashier || crole === "owner" || crole === "superadmin") ? "Toko" : (cashier.getString("name") || cashier.getString("username"));
  const items = app.findRecordsByFilter("sale_items", "sale = {:s}", "created", 0, 0, { s: sale.id }).map((i) => ({
    name: i.getString("name"), qty: i.getInt("qty"), price: i.getInt("price"), subtotal: i.getInt("subtotal"), note: TIER[i.getString("tier")] || "",
    // a pack line: qty is pcs; packs × pack_size, priced per pack
    pack_size: i.getString("tier") === "pack" ? i.getInt("pack_size") : 0,
  }));
  const pays = [];
  const po = one(app, "preorders", sale.getString("preorder"));
  if (po) for (const p of app.findRecordsByFilter("preorder_payments", "preorder = {:p}", "created", 0, 0, { p: po.id }))
    pays.push({ at: p.getString("created"), label: (p.getString("kind") === "refund" ? "Pengembalian DP" : "DP pre-order ") + (p.getString("kind") === "refund" ? "" : po.getString("number")), method: pmName(app, p.getString("payment_method"), pm), amount: p.getString("kind") === "refund" ? -p.getInt("amount") : p.getInt("amount") });
  const sp = app.findRecordsByFilter("sale_payments", "sale = {:s}", "created", 0, 0, { s: sale.id });
  const dpAtTill = sale.getInt("total") > sale.getInt("paid") + (po ? po.getInt("dp") : 0);
  // The cash line shows what was handed over (net + change), like the struk.
  let change = sale.getInt("change");
  for (const p of sp) {
    const m = one(app, "payment_methods", p.getString("payment_method"));
    const add = change && m && m.getBool("is_cash") ? change : 0;
    change -= add;
    pays.push({ at: sale.getString("created"), label: dpAtTill ? "DP" : "", method: m ? m.getString("name") : "", amount: p.getInt("amount") + add });
  }
  if (!sp.length && sale.getInt("paid") > 0) pays.push({ at: sale.getString("created"), label: dpAtTill ? "DP" : "", method: pmName(app, sale.getString("payment_method"), pm), amount: sale.getInt("paid") });
  let sisa = 0;
  for (const rc of app.findRecordsByFilter("receivables", "sale = {:s}", "created", 0, 0, { s: sale.id })) {
    for (const p of app.findRecordsByFilter("receivable_payments", "receivable = {:r}", "created", 0, 0, { r: rc.id }))
      pays.push({ at: p.getString("created"), label: "Pembayaran bon", method: pmName(app, p.getString("payment_method"), pm), amount: p.getInt("amount") });
    if (rc.getString("status") === "belum") sisa += rc.getInt("amount") - rc.getInt("paid");
  }
  const paid = pays.reduce((a, p) => a + p.amount, 0) - sale.getInt("change") + change; // net of the change actually given
  const status = sale.getString("status") === "batal" ? "DIBATALKAN" : sisa > 0 ? (paid > 0 ? "DP" : "BELUM LUNAS") : "LUNAS";
  const until = st.getString("promo_until").slice(0, 10);
  const today = L.wibDate();
  const promoOn = !!st.getString("promo_image") && (!until || until >= today);
  const isWalk = !cust || cust.id === walk;
  return {
    store: {
      name: st.getString("store_name"), address: st.getString("address"), phone: st.getString("phone"), header: st.getString("receipt_header"),
      logo: fileUrl(st, "logo"), accent: THEME_HEX[st.getString("theme_color")] || THEME_HEX.mahogany,
    },
    sale: {
      number: sale.getString("number"), created: sale.getString("created"), kind: sale.getString("kind"), status,
      subtotal: sale.getInt("subtotal"), discount: sale.getInt("discount"), total: sale.getInt("total"), change: sale.getInt("change"),
      paid, sisa, legacy: L.isLegacySale(sale), preorder: po ? po.getString("number") : "",
    },
    customer: isWalk ? { code: "", name: "Toko", phone: "" } : { code: cust.getString("username").toUpperCase(), name: cust.getString("name") || cust.getString("username"), phone: mask(cust.getString("phone")) },
    signer, items, payments: pays,
    terms: st.getString("invoice_terms") || st.getString("receipt_footer"),
    promo: promoOn ? { image: fileUrl(st, "promo_image"), title: st.getString("promo_title"), until } : null,
  };
}

module.exports = { build };

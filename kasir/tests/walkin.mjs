// Walk-in pelanggan "Toko" (settings.walkin_customer): a sale without a
// pelanggan is booked on it, it can be picked by hand, and it never takes a
// bon or a pre-order. Creates its own product and voids its sales.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/walkin.mjs
const PB = process.env.PB || "http://127.0.0.1:8090";
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`); if (!ok) failures++; };
async function api(token, method, path, body) {
  const r = await fetch(PB + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const run = Math.random().toString(36).slice(2, 7);
const pw = "Uji-" + Math.random().toString(36).slice(2, 12);
const su = (await api(null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.SU_EMAIL, password: process.env.SU_PASS })).body.token;
const own = (await api(su, "POST", "/api/collections/users/records", { username: "wown" + run, role: "owner", name: "w", password: pw, passwordConfirm: pw })).body;
const O = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: own.username, password: pw })).body.token;
const st = (await api(O, "GET", "/api/collections/settings/records?perPage=1")).body.items[0];
const toko = st.walkin_customer;
const tu = (await api(O, "GET", `/api/collections/users/records/${toko}`)).body;
check("settings name the walk-in pelanggan Toko", !!toko && tu.name === "Toko" && tu.role === "pelanggan" && tu.username === "cus0130", tu);

const tunai = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai");
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(O, "POST", "/api/collections/products/records", { name: "Uji Toko " + run, sku: "WK-" + run, category: cat.id, unit: "pcs", hpp: 10000, price: 20000, active: true, hide_online: true })).body;
await api(O, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 10, note: "uji" });
const cart = { items: [{ product: prod.id, qty: 1 }], employee: "toko" };
const a = await api(O, "POST", "/api/pos/checkout", { ...cart, payments: [{ method: tunai.id, amount: 20000 }] });
check("sale without pelanggan → Toko", a.status === 200 && a.body.sale.customer === toko, a.body);
const b = await api(O, "POST", "/api/pos/checkout", { ...cart, customer: toko, payments: [{ method: tunai.id, amount: 20000 }] });
check("Toko picked by hand", b.status === 200 && b.body.sale.customer === toko, b.body);
check("no bon without pelanggan", (await api(O, "POST", "/api/pos/checkout", { ...cart, payments: [], credit: true })).status === 400);
check("no bon on Toko", (await api(O, "POST", "/api/pos/checkout", { ...cart, customer: toko, payments: [], credit: true })).status === 400);
check("no pre-order on Toko", (await api(O, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 1 }], customer: toko })).status === 400);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const rows = (await api(O, "GET", `/api/reports/table?type=pelanggan&from=${today}&to=${today}`)).body.rows || [];
check("Laporan pelanggan shows Toko, no Umum", rows.some((r) => r.nama === "Toko") && !rows.some((r) => /^Umum/.test(r.nama)), rows.slice(0, 3));
for (const s of [a, b]) if (s.body.sale) await api(O, "POST", `/api/pos/void/${s.body.sale.id}`, { reason: "uji toko" });
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
await api(su, "PATCH", `/api/collections/users/records/${own.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

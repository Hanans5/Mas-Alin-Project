// Pre-Order end to end: DP first (minimum %, Tunai/Transfer/Split), no stock
// check or stock movement until pelunasan, extra DP, Siap diambil, pelunasan
// into a normal sale (DP not counted twice in Buku Kas), custom items
// (owner/admin only), cancel with DP refunded (Buku Kas keluar) or kept
// (Laba Rugi other income), and who may do what. Creates its own users and
// product and disables them at the end.
//   PB=http://127.0.0.1:8099 SU_EMAIL=… SU_PASS=… node tests/preorder.mjs
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
check("superuser login", !!su);
const mk = async (username, role) => (await api(su, "POST", "/api/collections/users/records", { username, role, name: username, phone: role === "pelanggan" ? "0812" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") : "", password: pw, passwordConfirm: pw })).body;
const owner = await mk("powner" + run, "owner"), kasir = await mk("pkasir" + run, "kasir"), cust = await mk("pcust" + run, "pelanggan");
const login = async (u) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: pw })).body.token;
const O = await login(owner.username), K = await login(kasir.username);
check("test users log in", !!O && !!K && !!cust.id);

const methods = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items;
const TUNAI = methods.find((m) => m.name === "Tunai").id, TRANSFER = methods.find((m) => m.name === "Transfer").id;
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(O, "POST", "/api/collections/products/records", { name: "Uji PO " + run, sku: "PO-" + run, category: cat.id, unit: "pcs", hpp: 40000, price: 50000, price_kodi: 45000, min_stock: 0, active: true, hide_online: true })).body;
await api(O, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 5, note: "uji pre-order" });
const emp = (await api(O, "POST", "/api/collections/employees/records", { name: "Uji PO " + run, active: true })).body;
const pct = (await api(O, "GET", "/api/collections/settings/records?perPage=1")).body.items[0].po_min_dp ?? 30;   // owner's setting
const minOf = (total) => Math.min(total, Math.ceil(total * pct / 100 / 1000) * 1000);
const stock = async () => (await api(O, "GET", `/api/collections/products/records/${prod.id}`)).body.stock;
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const cash = async () => (await api(O, "GET", `/api/reports/cashbook?from=${today}&to=${today}`)).body;
const poLines = async (number) => (await cash()).lines.filter((l) => l.ref === number);

// 1. preview: no stock check, one price per pcs (no automatic kodian), min DP 30 %
const items = [{ product: prod.id, qty: 25 }];
const pv = await api(K, "POST", "/api/po/preview", { items, customer: cust.id });
check("preview of 25 pcs with only 5 in stock is allowed", pv.status === 200, pv.body);
check("per pcs by default: 25 × 50.000", pv.body.total === 25 * 50000, pv.body);
const pvK = await api(O, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 5, tier: "kodian" }, { product: prod.id, qty: 1 }], customer: cust.id });
check("owner 'Harga kodian' on a pre-order line: 6 × 45.000", pvK.status === 200 && pvK.body.total === 6 * 45000, pvK.body);
const pvC = await api(O, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 2, tier: "kustom", price: 60000 }], customer: cust.id });
check("owner 'Harga kustom' on a pre-order line: 2 × 60.000", pvC.status === 200 && pvC.body.total === 120000, pvC.body);
check("kasir can't use 'Harga kustom' on a pre-order (403)", (await api(K, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 2, tier: "kustom", price: 60000 }], customer: cust.id })).status === 403);
const pvKK = await api(K, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 3, tier: "kodian" }], customer: cust.id });
check("kasir 'Harga kodian' on a pre-order line: 3 × 45.000", pvKK.status === 200 && pvKK.body.total === 3 * 45000, pvKK.body);
await api(O, "PATCH", `/api/collections/products/records/${prod.id}`, { price_jumbo: 55000 });
check("kasir can't use 'Harga jumbo' on a pre-order (403)", (await api(K, "POST", "/api/po/preview", { items: [{ product: prod.id, qty: 2, tier: "jumbo" }], customer: cust.id })).status === 403);
await api(O, "PATCH", `/api/collections/products/records/${prod.id}`, { price_jumbo: 0 });
check(`min DP is the owner's ${pct} % rounded up to Rp 1.000`, pv.body.min_dp === minOf(pv.body.total), pv.body);
check("pre-order needs a pelanggan", (await api(K, "POST", "/api/po/preview", { items })).status === 400);

// 2. create: DP below the minimum refused; then Split DP
const total = pv.body.total, minDp = pv.body.min_dp;
const low = await api(K, "POST", "/api/po/create", { items, customer: cust.id, employee: emp.id, payments: [{ method: TUNAI, amount: minDp - 1000 }] });
check("DP below the minimum refused", low.status === 400 && /DP minimal/.test(low.body.message), low.body);
const before = await stock();
const c1 = await api(K, "POST", "/api/po/create", { items, customer: cust.id, employee: emp.id, ready_date: today, note: "ukuran L",
  payments: [{ method: TUNAI, amount: 100000 }, { method: TRANSFER, amount: minDp - 100000 }] });
const po = c1.body.preorder;
check("kasir creates a pre-order with a Split DP", c1.status === 200 && po.status === "menunggu" && po.dp === minDp && /^PO-\d{6}-\d{4}$/.test(po.number), c1.body);
check("no stock leaves at order time", (await stock()) === before);
let lines = await poLines(po.number);
check("Buku Kas: DP in on the day, under Split", lines.length === 2 && lines.every((l) => l.type === "masuk" && l.grp === "Split") && lines.reduce((a, l) => a + l.amount, 0) === minDp, lines);

// 3. extra DP, ready
const top = await api(K, "POST", `/api/po/${po.id}/dp`, { payments: [{ method: TRANSFER, amount: 50000 }] });
check("extra DP adds up", top.status === 200 && top.body.preorder.dp === minDp + 50000, top.body);
check("extra DP above the rest refused", (await api(K, "POST", `/api/po/${po.id}/dp`, { payments: [{ method: TRANSFER, amount: total } ] })).status === 400);
check("marked Siap diambil", (await api(K, "POST", `/api/po/${po.id}/ready`)).body.preorder?.status === "siap");

// 4. pelunasan: not enough stock yet → refused; stock in → sale
const shortStock = await api(K, "POST", `/api/po/${po.id}/complete`, { payments: [{ method: TUNAI, amount: total }] });
check("pelunasan refused while stock is short", shortStock.status === 400 && /Stok/.test(shortStock.body.message), shortStock.body);
await api(O, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 30, note: "barang pre-order datang" });
const s0 = await stock();
const rest = total - minDp - 50000;
const done = await api(K, "POST", `/api/po/${po.id}/complete`, { payments: [{ method: TUNAI, amount: rest + 10000 }] });
const sale = done.body.sale;
check("pelunasan makes a normal sale for the full total", done.status === 200 && sale.total === total && sale.status === "lunas" && sale.preorder === po.id, done.body);
check("change from cash", sale.change === 10000 && sale.paid === rest, sale);
check("stock leaves at pelunasan", (await stock()) === s0 - 25);
const poAfter = (await api(O, "GET", `/api/collections/preorders/records/${po.id}`)).body;
check("pre-order is Selesai and points to the sale", poAfter.status === "selesai" && poAfter.sale === sale.id, poAfter);
const sl = (await cash()).lines.filter((l) => l.ref === sale.number);
check("Buku Kas: the sale adds only the rest (DP not counted twice)", sl.reduce((a, l) => a + l.amount, 0) === rest, sl);
const allIn = (await poLines(po.number)).reduce((a, l) => a + l.amount, 0) + sl.reduce((a, l) => a + l.amount, 0);
check("DP + rest in Buku Kas = the pre-order total", allIn === total, allIn);
check("void of a pre-order sale refused", (await api(O, "POST", `/api/pos/void/${sale.id}`, { reason: "uji" })).status === 400);
check("a finished pre-order takes no more money", (await api(K, "POST", `/api/po/${po.id}/dp`, { payments: [{ method: TUNAI, amount: 1000 }] })).status === 400);

// 5. custom items and roles
const custom = [{ custom: true, name: "Hem motif khusus " + run, price: 150000, hpp: 90000, qty: 2 }];
check("kasir can't add a custom item", (await api(K, "POST", "/api/po/preview", { items: custom, customer: cust.id })).status === 403);
const c2 = await api(O, "POST", "/api/po/create", { items: custom, customer: cust.id, employee: emp.id, payments: [{ method: TUNAI, amount: minOf(300000) }] });
check("owner creates a pre-order with a custom item", c2.status === 200 && c2.body.preorder.total === 300000, c2.body);
check("kasir can't cancel", (await api(K, "POST", `/api/po/${c2.body.preorder.id}/cancel`, { mode: "refund", reason: "uji", method: TUNAI })).status === 403);
const ref = await api(O, "POST", `/api/po/${c2.body.preorder.id}/cancel`, { mode: "refund", reason: "uji batal", method: TUNAI });
check("cancel with DP refunded", ref.status === 200 && ref.body.preorder.status === "batal" && ref.body.preorder.cancel_mode === "refund", ref.body);
lines = await poLines(c2.body.preorder.number);
check("Buku Kas: DP in, then the same amount out", lines.length === 2 && lines.some((l) => l.type === "keluar" && l.amount === minOf(300000)), lines);

// 6. cancel with DP kept → other income in Laba Rugi
const c3 = await api(K, "POST", "/api/po/create", { items: [{ product: prod.id, qty: 1 }], customer: cust.id, employee: emp.id, payments: [{ method: TUNAI, amount: 50000 }] });   // the whole price
const pl0 = (await api(O, "GET", `/api/reports/profit-loss?from=${today}&to=${today}`)).body;
await api(O, "POST", `/api/po/${c3.body.preorder.id}/cancel`, { mode: "hangus", reason: "tidak diambil" });
const pl1 = (await api(O, "GET", `/api/reports/profit-loss?from=${today}&to=${today}`)).body;
check("DP hangus shows in Laba Rugi as other income", pl1.po_forfeit - (pl0.po_forfeit || 0) === 50000 && pl1.net_profit - pl0.net_profit === 50000, [pl0.po_forfeit, pl1.po_forfeit]);
check("a cancelled pre-order can't be completed", (await api(K, "POST", `/api/po/${c3.body.preorder.id}/complete`, { payments: [] })).status === 400);

// 7. reports
const dash = (await api(K, "GET", "/api/reports/dashboard")).body;
check("Dasbor shows the open pre-orders block", dash.preorders && typeof dash.preorders.count === "number", dash.preorders);
const rep = (await api(O, "GET", `/api/reports/table?type=preorder&from=${today}&to=${today}`)).body;
check("Laporan Pre-Order lists them", rep.rows?.filter((r) => [po.number, c2.body.preorder.number, c3.body.preorder.number].includes(r.number)).length === 3, rep.rows?.length);
check("kasir reads pre-orders", (await api(K, "GET", "/api/collections/preorders/records?perPage=1")).status === 200);
check("nobody writes pre-orders directly", (await api(O, "POST", "/api/collections/preorders/records", { number: "X" })).status >= 400);

// clean up: disable test logins and hide the product
for (const u of [owner, kasir, cust]) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
await api(su, "PATCH", `/api/collections/employees/records/${emp.id}`, { active: false });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

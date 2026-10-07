// End-to-end check of roles, POS, stock, piutang and reports against a
// running PocketBase. Run on a THROWAWAY database only — it creates users,
// products and sales.
//   PB=http://127.0.0.1:8090 SU_EMAIL=… SU_PASS=… node tests/smoke.mjs
const PB = process.env.PB || "http://127.0.0.1:8090";
const run = Date.now().toString(36);
let failures = 0;

// The shop picks a karyawan on every sale once any is active, so checkouts
// in this test are credited to a test karyawan (EMP) unless a body says otherwise.
let EMP = "";
async function api(token, method, path, body) {
  if (EMP && path === "/api/pos/checkout" && body && !("employee" in body)) body = { ...body, employee: EMP };
  const r = await fetch(PB + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const login = async (u, p) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: p })).body.token;

const su = (await api(null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.SU_EMAIL, password: process.env.SU_PASS })).body.token;
check("superuser login", !!su);

const pw = "Rahasia123!";
const mk = async (token, username, role, extra) =>
  api(token, "POST", "/api/collections/users/records", { username, role, password: pw, passwordConfirm: pw, name: username, ...extra });
const owner = await mk(su, "alin" + run, "owner");
check("superuser creates owner", owner.status === 200, owner.body);
const O = await login("alin" + run, pw);
check("owner logs in by username", !!O);

const signup = await mk(null, "hacker" + run, "owner");
check("public signup blocked", signup.status >= 400, signup.status);

await mk(O, "admin" + run, "admin");
await mk(O, "kasir" + run, "kasir");
const A = await login("admin" + run, pw), K = await login("kasir" + run, pw);
check("admin + kasir log in", !!A && !!K);

const kasirMakesAdmin = await mk(K, "evil" + run, "admin");
check("kasir cannot create an admin", kasirMakesAdmin.status >= 400, kasirMakesAdmin.status);
const cust = await mk(K, "budi" + run, "pelanggan", { phone: "0812" });
check("kasir registers a pelanggan", cust.status === 200, cust.body);
const C = await login("budi" + run, pw);
const custId = cust.body.id;

const selfPromote = await api(C, "PATCH", `/api/collections/users/records/${custId}`, { role: "owner" });
check("pelanggan cannot promote self", selfPromote.status >= 400, selfPromote.status);
const selfPoints = await api(C, "PATCH", `/api/collections/users/records/${custId}`, { points: 9999 });
check("pelanggan cannot set own points", selfPoints.status >= 400, selfPoints.status);

const cat = await api(A, "POST", "/api/collections/categories/records", { name: "TUNIK " + run });
const prod = await api(A, "POST", "/api/collections/products/records", {
  name: "Tunik List " + run, sku: "TUN-" + run, category: cat.body.id, unit: "pcs", hpp: 52500, price: 62000, min_stock: 5, active: true,
});
check("admin creates product", prod.status === 200, prod.body);
const pid = prod.body.id;
const kasirProd = await api(K, "POST", "/api/collections/products/records", { name: "x", sku: "X" + run, price: 1, active: true });
check("kasir cannot create product", kasirProd.status >= 400, kasirProd.status);
const directStock = await api(A, "PATCH", `/api/collections/products/records/${pid}`, { stock: 999 });
check("stock not editable directly", directStock.status >= 400, directStock.status);

const masuk = await api(A, "POST", "/api/stock/move", { product: pid, type: "masuk", qty: 10, note: "kiriman" });
check("stock masuk +10", masuk.status === 200 && masuk.body.stock_after === 10, masuk.body);
// Since 2026-10-07 the shared kasir login (the karyawan) receives and counts stock too.
const kasirIn = await api(K, "POST", "/api/stock/move", { product: pid, type: "masuk", qty: 3, note: "kasir terima barang" });
const kasirOut = await api(K, "POST", "/api/stock/move", { product: pid, type: "keluar", qty: 3, note: "kasir koreksi" });
check("kasir can move stock (in 3, out 3 → back to 10)", kasirIn.status === 200 && kasirOut.status === 200 && kasirOut.body.stock_after === 10, [kasirIn.status, kasirOut.body]);

const methods = (await api(K, "GET", "/api/collections/payment_methods/records")).body.items;
const tunai = methods.find((m) => m.name === "Tunai").id;

const emp = await api(A, "POST", "/api/collections/employees/records", { name: "Uji karyawan " + run, active: true });
check("admin adds a karyawan", emp.status === 200, emp.body);
const empList = await api(K, "GET", "/api/collections/employees/records?filter=active%3Dtrue");
check("kasir can read the karyawan list", empList.status === 200 && empList.body.items.some((x) => x.id === emp.body.id), empList.status);
const noEmp = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 1 }], payment_method: tunai, paid: 62000, employee: "" });
check("sale without karyawan refused", noEmp.status === 400, noEmp.body);
const tokoSale = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 1 }], payment_method: tunai, paid: 62000, employee: "toko" });
check("explicit 'Toko' (no karyawan) accepted", tokoSale.status === 200 && tokoSale.body.sale.employee === "", tokoSale.body);
if (tokoSale.body.sale) await api(A, "POST", `/api/pos/void/${tokoSale.body.sale.id}`, { reason: "uji toko" });
EMP = emp.body.id;
const sale1 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 2 }], customer: custId, payment_method: tunai, paid: 130000 });
check("kasir checkout 2 × 62.000", sale1.status === 200 && sale1.body.sale.total === 124000 && sale1.body.sale.change === 6000, sale1.body);
check("sale credited to the karyawan", sale1.body.sale?.employee === EMP, sale1.body.sale?.employee);
check("no points earned (points retired)", sale1.body.sale?.points_earned === 0, sale1.body.sale);
const fakePrice = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 1, price: 1 }], payment_method: tunai, paid: 1 });
check("kasir cannot set a custom price", fakePrice.status === 403, fakePrice.body);
const ownerPrice = await api(O, "POST", "/api/pos/preview", { items: [{ product: pid, qty: 2, price: 50000 }] });
check("owner custom price 2 × 50.000", ownerPrice.status === 200 && ownerPrice.body.subtotal === 100000 && ownerPrice.body.lines[0].tier === "kustom", ownerPrice.body);
// Kodian needs 20+ pcs on hand: borrow 30 for the preview, then put them back out.
await api(A, "PATCH", `/api/collections/products/records/${pid}`, { price_kodi: 60000 });
await api(A, "POST", "/api/stock/move", { product: pid, type: "masuk", qty: 30, note: "uji kodian" });
const kodi = await api(K, "POST", "/api/pos/preview", { items: [{ product: pid, qty: 25 }] });
check("kodian: 25 pcs = 20 × 60.000 + 5 × 62.000", kodi.status === 200 && kodi.body.subtotal === 1510000, kodi.body);
const allKodi = await api(O, "POST", "/api/pos/preview", { items: [{ product: pid, qty: 5, kodian: true }] });
check("owner 'Harga kodian': 5 pcs all at 60.000", allKodi.status === 200 && allKodi.body.subtotal === 300000 && allKodi.body.lines[0].tier === "kodian", allKodi.body);
const kasirKodi = await api(K, "POST", "/api/pos/preview", { items: [{ product: pid, qty: 5, kodian: true }] });
check("kasir can't use 'Harga kodian' (403)", kasirKodi.status === 403, kasirKodi.body);
await api(A, "POST", "/api/stock/move", { product: pid, type: "keluar", qty: 30, note: "uji kodian selesai" });
await api(A, "PATCH", `/api/collections/products/records/${pid}`, { price_kodi: 0 });
const kasirDisc = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 1 }], discount: 50000, payment_method: tunai, paid: 62000 });
check("kasir cannot give manual discount", kasirDisc.status === 403, kasirDisc.status);
const tooMany = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 50 }], payment_method: tunai, paid: 9999999 });
check("cannot sell more than stock", tooMany.status === 400, tooMany.body);
const directSale = await api(K, "POST", "/api/collections/sales/records", { number: "X", cashier: "x", status: "lunas" });
check("sales not creatable via records API", directSale.status >= 400, directSale.status);

const sale2 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pid, qty: 1 }], customer: custId, payment_method: tunai, paid: 20000, credit: true, points_used: 2 });
// points_used is ignored now: 62.000 total, DP 20.000, bon 42.000
check("DP sale: points ignored, total 62.000, piutang", sale2.status === 200 && sale2.body.sale.total === 62000 && sale2.body.sale.status === "piutang", sale2.body);

const prodNow = (await api(A, "GET", `/api/collections/products/records/${pid}`)).body;
check("stock 10 − 2 − 1 = 7", prodNow.stock === 7, prodNow.stock);

const custSales = await api(C, "GET", "/api/collections/sales/records");
check("pelanggan sees own 2 sales", custSales.body.items?.length === 2, custSales.body);
const custProducts = await api(C, "GET", "/api/collections/products/records");
check("pelanggan sees no products", custProducts.body.items?.length === 0, custProducts.body);
const custCash = await api(C, "GET", "/api/collections/cash_entries/records");
check("pelanggan sees no cash book", custCash.body.items?.length === 0, custCash.body);
const custMe = (await api(C, "GET", `/api/collections/users/records/${custId}`)).body;
check("pelanggan points untouched (0)", custMe.points === 0, custMe.points);

const kasirPL = await api(K, "GET", "/api/reports/profit-loss?from=2026-01-01&to=2030-12-31");
check("kasir cannot see laba rugi", kasirPL.status === 403, kasirPL.status);
const adminPL = await api(A, "GET", "/api/reports/profit-loss?from=2026-01-01&to=2030-12-31");
check("admin cannot see laba rugi", adminPL.status === 403, adminPL.status);

const recv = (await api(A, "GET", `/api/collections/receivables/records?filter=${encodeURIComponent(`sale="${sale2.body.sale.id}"`)}`)).body.items[0];
check("bon 42.000 open", recv?.amount === 42000 && recv?.status === "belum", recv);
const over = await api(A, "POST", "/api/receivables/pay", { receivable: recv.id, amount: 50000, payment_method: tunai });
check("cannot overpay debt", over.status === 400, over.body);
const pay = await api(A, "POST", "/api/receivables/pay", { receivable: recv.id, amount: 42000, payment_method: tunai });
check("debt paid off", pay.status === 200 && pay.body.left === 0, pay.body);

await api(A, "POST", "/api/collections/expenses/records", { date: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) + " 00:00:00.000Z", category: "Listrik", amount: 50000 });

const voidK = await api(K, "POST", `/api/pos/void/${sale1.body.sale.id}`, { reason: "salah input" });
check("kasir cannot void", voidK.status === 403, voidK.status);
const voidA = await api(A, "POST", `/api/pos/void/${sale1.body.sale.id}`, { reason: "salah input" });
check("admin voids sale 1", voidA.status === 200, voidA.body);
const afterVoid = (await api(A, "GET", `/api/collections/products/records/${pid}`)).body;
check("stock back to 9", afterVoid.stock === 9, afterVoid.stock);
const custAfter = (await api(C, "GET", `/api/collections/users/records/${custId}`)).body;
check("void leaves points at 0", custAfter.points === 0, custAfter.points);

const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const pl = await api(O, "GET", `/api/reports/profit-loss?from=${today}&to=${today}`);
console.log("  laba rugi:", JSON.stringify(pl.body));
const book = await api(O, "GET", `/api/reports/cashbook?from=${today}&to=${today}`);
console.log("  buku kas:", JSON.stringify({ in: book.body.total_in, out: book.body.total_out, closing: book.body.closing, lines: book.body.lines?.length }));
const dash = await api(K, "GET", "/api/reports/dashboard");
check("kasir dashboard has no profit", dash.status === 200 && dash.body.today.gross_profit === undefined, dash.body);

const pv = await api(K, "POST", "/api/pos/preview", { items: [{ product: pid, qty: 2 }] });
check("preview prices 2 × 62.000 without saving", pv.status === 200 && pv.body.total === 124000, pv.body);
const stillNine = (await api(A, "GET", `/api/collections/products/records/${pid}`)).body.stock;
check("preview leaves stock alone", stillNine === 9, stillNine);

// Keep test products off the till.
await api(A, "PATCH", `/api/collections/products/records/${pid}`, { active: false });
// The server may be public: lock every account this run created.
for (const u of ["alin", "admin", "kasir", "budi"]) {
  const rec = (await api(su, "GET", `/api/collections/users/records?filter=${encodeURIComponent(`username="${u + run}"`)}`)).body.items?.[0];
  if (rec) await api(su, "PATCH", `/api/collections/users/records/${rec.id}`, { disabled: true });
}

if (EMP) await api(su, "PATCH", `/api/collections/employees/records/${EMP}`, { active: false });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

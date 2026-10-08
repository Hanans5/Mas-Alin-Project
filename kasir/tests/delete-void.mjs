// Deleting a voided sale (owner/superadmin, typed number): the sale, items,
// payments and bon rows go; stock, Buku Kas and reports don't move.
// Creates its own users/product and disables them at the end.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/delete-void.mjs
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
const mk = async (role) => (await api(su, "POST", "/api/collections/users/records", { username: "d" + role.slice(0, 4) + run, role, name: "d" + role, password: pw, passwordConfirm: pw })).body;
const users = { owner: await mk("owner"), superadmin: await mk("superadmin"), admin: await mk("admin"), kasir: await mk("kasir"), pel: await mk("pelanggan") };
const tok = {};
for (const k of ["owner", "superadmin", "admin", "kasir"]) tok[k] = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: users[k].username, password: pw })).body.token;
const O = tok.owner;
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), R = `from=${today}&to=${today}`;
const snap = async () => {
  const cb = (await api(O, "GET", `/api/reports/cashbook?${R}`)).body, pl = (await api(O, "GET", `/api/reports/profit-loss?${R}`)).body;
  const tx = (await api(O, "GET", `/api/tx/summary?${R}`)).body;
  const stable = (v) => v && typeof v === "object" ? (Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))) : v;
  return JSON.stringify(stable([cb, pl, tx]));
};
const tunai = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai");
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(O, "POST", "/api/collections/products/records", { name: "Uji Hapus " + run, sku: "DV-" + run, category: cat.id, unit: "pcs", hpp: 10000, price: 20000, active: true, hide_online: true })).body;
await api(O, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 10, note: "uji" });
const cart = { items: [{ product: prod.id, qty: 2 }], employee: "toko" };
const a = (await api(O, "POST", "/api/pos/checkout", { ...cart, payments: [{ method: tunai.id, amount: 40000 }] })).body.sale;
// a bon with a DP and a later payment, then voided
const b = (await api(O, "POST", "/api/pos/checkout", { ...cart, customer: users.pel.id, payments: [{ method: tunai.id, amount: 10000 }], credit: true })).body.sale;
const rc = (await api(su, "GET", `/api/collections/receivables/records?filter=${encodeURIComponent(`sale="${b.id}"`)}`)).body.items[0];
check("bon payment saved", (await api(O, "POST", "/api/receivables/pay", { receivable: rc.id, amount: 5000, payment_method: tunai.id })).status === 200);
check("lunas sale can't be deleted", (await api(O, "POST", `/api/pos/delete/${a.id}`, { confirm: a.number })).status === 400);
await api(O, "POST", `/api/pos/void/${a.id}`, { reason: "uji hapus" });
await api(O, "POST", `/api/pos/void/${b.id}`, { reason: "uji hapus" });
const before = await snap(), stock0 = (await api(O, "GET", `/api/collections/products/records/${prod.id}`)).body.stock;
check("kasir can't delete", (await api(tok.kasir, "POST", `/api/pos/delete/${a.id}`, { confirm: a.number })).status === 403);
check("admin can't delete", (await api(tok.admin, "POST", `/api/pos/delete/${a.id}`, { confirm: a.number })).status === 403);
check("wrong number refused", (await api(O, "POST", `/api/pos/delete/${a.id}`, { confirm: "TRX-X" })).status === 400);
check("owner deletes a voided sale", (await api(O, "POST", `/api/pos/delete/${a.id}`, { confirm: a.number })).status === 200);
check("superadmin deletes a voided bon", (await api(tok.superadmin, "POST", `/api/pos/delete/${b.id}`, { confirm: b.number })).status === 200);
const gone = async (c, f) => (await api(su, "GET", `/api/collections/${c}/records?filter=${encodeURIComponent(f)}`)).body.totalItems === 0;
check("sales gone", await gone("sales", `id="${a.id}" || id="${b.id}"`));
check("items and payments gone", await gone("sale_items", `sale="${a.id}" || sale="${b.id}"`) && await gone("sale_payments", `sale="${a.id}" || sale="${b.id}"`));
check("bon and its payments gone", await gone("receivables", `id="${rc.id}"`) && await gone("receivable_payments", `receivable="${rc.id}"`));
const after = await snap();
check("Buku Kas, Laba Rugi, Transaksi totals unchanged", after === before, [before.slice(0, 400), after.slice(0, 400)]);
check("stock unchanged", (await api(O, "GET", `/api/collections/products/records/${prod.id}`)).body.stock === stock0);
check("deleting again → 404", (await api(O, "POST", `/api/pos/delete/${a.id}`, { confirm: a.number })).status === 404);
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
for (const u of Object.values(users)) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

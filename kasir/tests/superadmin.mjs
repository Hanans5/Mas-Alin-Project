// Superadmin: the owner's rights (laba, Buku Kas, settings, voids, pre-order
// cancel, user management) but no reach over owner accounts and no handing
// out the owner/superadmin role; admin still sees no laba. Creates its own
// users and disables them at the end.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/superadmin.mjs
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
const mk = async (username, role) => (await api(su, "POST", "/api/collections/users/records", { username, role, name: username, password: pw, passwordConfirm: pw })).body;
const owner = await mk("sowner" + run, "owner"), sa = await mk("ssuper" + run, "superadmin"), admin = await mk("sadmin" + run, "admin"), kasir = await mk("skasir" + run, "kasir");
const login = async (u) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: pw })).body.token;
const S = await login(sa.username), A = await login(admin.username);
check("superadmin logs in", !!S && !!A, sa);

const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), R = `from=${today}&to=${today}`;
// owner rights
check("Laba Rugi", (await api(S, "GET", `/api/reports/profit-loss?${R}`)).status === 200);
check("Buku Kas", (await api(S, "GET", `/api/reports/cashbook?${R}`)).status === 200);
check("Dasbor shows laba kotor", "gross_profit" in ((await api(S, "GET", "/api/reports/dashboard")).body.today || {}));
check("Laporan has the Laba column", (await api(S, "GET", `/api/reports/table?type=karyawan&${R}`)).body.columns?.some((c) => c.key === "laba"));
const st = (await api(S, "GET", "/api/collections/settings/records?perPage=1")).body.items[0];
check("changes Pengaturan", (await api(S, "PATCH", `/api/collections/settings/records/${st.id}`, { open_hours: st.open_hours })).status === 200);
const tunai = (await api(S, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai");
const ce = await api(S, "POST", "/api/collections/cash_entries/records", { date: today + " 00:00:00.000Z", type: "masuk", amount: 1000, payment_method: tunai.id, note: "uji superadmin " + run, by: sa.id });
check("writes a Buku Kas entry", ce.status === 200, ce.body);
check("deletes it again", (await api(S, "DELETE", `/api/collections/cash_entries/records/${ce.body.id}`)).status === 204);
const cat = (await api(S, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(S, "POST", "/api/collections/products/records", { name: "Uji SA " + run, sku: "SA-" + run, category: cat.id, unit: "pcs", hpp: 10000, price: 20000, active: true, hide_online: true })).body;
await api(S, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 5, note: "uji" });
const sale = await api(S, "POST", "/api/pos/checkout", { items: [{ product: prod.id, qty: 1, price: 18000 }], employee: "toko", payments: [{ method: tunai.id, amount: 18000 }] });
check("custom price at the till (owner only)", sale.status === 200 && sale.body.sale.total === 18000, sale.body);
check("voids a sale", (await api(S, "POST", `/api/pos/void/${sale.body.sale.id}`, { reason: "uji superadmin" })).status === 200);
// user management, within limits
const k2 = await api(S, "POST", "/api/collections/users/records", { username: "skasir2" + run, role: "kasir", name: "x", password: pw, passwordConfirm: pw });
check("creates a kasir login", k2.status === 200, k2.body);
check("edits a kasir login", (await api(S, "PATCH", `/api/collections/users/records/${kasir.id}`, { name: "Kasir uji " + run })).status === 200);
check("can't create an owner", (await api(S, "POST", "/api/collections/users/records", { username: "sown2" + run, role: "owner", name: "x", password: pw, passwordConfirm: pw })).status >= 400);
check("can't create a superadmin", (await api(S, "POST", "/api/collections/users/records", { username: "ssa2" + run, role: "superadmin", name: "x", password: pw, passwordConfirm: pw })).status >= 400);
check("can't promote a kasir to owner", (await api(S, "PATCH", `/api/collections/users/records/${kasir.id}`, { role: "owner" })).status >= 400);
check("can't edit an owner", (await api(S, "PATCH", `/api/collections/users/records/${owner.id}`, { name: "diubah" })).status >= 400);
check("can't disable an owner", (await api(S, "PATCH", `/api/collections/users/records/${owner.id}`, { disabled: true })).status >= 400);
check("can't delete an owner", (await api(S, "DELETE", `/api/collections/users/records/${owner.id}`)).status >= 400);
check("owner account untouched", (await api(su, "GET", `/api/collections/users/records/${owner.id}`)).body.disabled === false);
check("can't change own role", (await api(S, "PATCH", `/api/collections/users/records/${sa.id}`, { role: "owner" })).status >= 400);
// admin unchanged
check("admin: no Laba Rugi", (await api(A, "GET", `/api/reports/profit-loss?${R}`)).status === 403);
check("admin: no Laba column", !(await api(A, "GET", `/api/reports/table?type=karyawan&${R}`)).body.columns?.some((c) => c.key === "laba"));
check("admin: can't touch a superadmin", (await api(A, "PATCH", `/api/collections/users/records/${sa.id}`, { name: "x" })).status >= 400);

for (const u of [owner, sa, admin, kasir, k2.body]) if (u?.id) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

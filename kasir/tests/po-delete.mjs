// Deleting a cancelled pre-order: owner/superadmin only, typed number, BATAL
// only. It leaves the Pre-Order list; Buku Kas, Laba Rugi (DP hangus) and
// stock don't move. Creates its own users/product; disables them at the end.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/po-delete.mjs
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
const mk = async (role) => (await api(su, "POST", "/api/collections/users/records", { username: "pd" + role.slice(0, 4) + run, role, name: "PD " + role, password: pw, passwordConfirm: pw })).body;
const U = { owner: await mk("owner"), superadmin: await mk("superadmin"), admin: await mk("admin"), kasir: await mk("kasir"), pel: await mk("pelanggan") };
const T = {};
for (const k of ["owner", "superadmin", "admin", "kasir"]) T[k] = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: U[k].username, password: pw })).body.token;
const O = T.owner;
const tunai = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai").id;
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(O, "POST", "/api/collections/products/records", { name: "Uji PO Hapus " + run, sku: "PD-" + run, category: cat.id, unit: "pcs", hpp: 20000, price: 47000, active: true, hide_online: true })).body;
const mkPo = async () => (await api(T.kasir, "POST", "/api/po/create", { items: [{ product: prod.id, qty: 1 }], customer: U.pel.id, employee: "toko", payments: [{ method: tunai, amount: 24000 }] })).body.preorder;
const a = await mkPo(), b = await mkPo(), c = await mkPo();
await api(O, "POST", `/api/po/${a.id}/cancel`, { mode: "refund", method: tunai, reason: "uji" });
await api(O, "POST", `/api/po/${b.id}/cancel`, { mode: "hangus", reason: "uji" });
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), R = `from=${today}&to=${today}`;
const stable = (v) => v && typeof v === "object" ? (Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))) : v;
const snap = async () => JSON.stringify(stable([(await api(O, "GET", `/api/reports/cashbook?${R}`)).body, (await api(O, "GET", `/api/reports/profit-loss?${R}`)).body]));
const before = await snap(), stock0 = (await api(O, "GET", `/api/collections/products/records/${prod.id}`)).body.stock;
check("kasir can't delete", (await api(T.kasir, "POST", `/api/po/${a.id}/delete`, { confirm: a.number })).status === 403);
check("admin can't delete", (await api(T.admin, "POST", `/api/po/${a.id}/delete`, { confirm: a.number })).status === 403);
check("wrong number refused", (await api(O, "POST", `/api/po/${a.id}/delete`, { confirm: "PO-X" })).status === 400);
check("active (not BATAL) pre-order refused", (await api(O, "POST", `/api/po/${c.id}/delete`, { confirm: c.number })).status === 400);
check("owner deletes a refunded BATAL pre-order", (await api(O, "POST", `/api/po/${a.id}/delete`, { confirm: a.number })).status === 200);
check("superadmin deletes a DP-hangus BATAL pre-order", (await api(T.superadmin, "POST", `/api/po/${b.id}/delete`, { confirm: b.number })).status === 200);
check("deleting again → 404", (await api(O, "POST", `/api/po/${a.id}/delete`, { confirm: a.number })).status === 404);
check("Buku Kas and Laba Rugi unchanged (DP, refund, DP hangus kept)", (await snap()) === before);
check("stock unchanged", (await api(O, "GET", `/api/collections/products/records/${prod.id}`)).body.stock === stock0);
const listed = (await api(O, "GET", `/api/collections/preorders/records?perPage=200&filter=${encodeURIComponent(`deleted = false && (id = "${a.id}" || id = "${b.id}" || id = "${c.id}")`)}`)).body.items.map((x) => x.id);
check("Pre-Order list (deleted = false) hides the two, keeps the active one", listed.length === 1 && listed[0] === c.id, listed);
const rows = (await api(O, "GET", `/api/reports/table?type=preorder&${R}`)).body.rows || [];
check("Laporan Pre-Order still lists them as 'batal (…, dihapus)'", rows.some((r) => r.number === a.number && /dihapus/.test(r.status)) && rows.some((r) => r.number === b.number && /hangus, dihapus/.test(r.status)), rows.filter((r) => [a.number, b.number].includes(r.number)));
await api(O, "POST", `/api/po/${c.id}/cancel`, { mode: "refund", method: tunai, reason: "uji selesai" });
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
for (const u of Object.values(U)) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

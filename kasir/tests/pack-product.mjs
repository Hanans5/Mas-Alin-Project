// Pack products: a product with its own code/price that is N pcs of a base
// product (pack_of + pack_isi). Selling it takes N pcs per pack from the base;
// void, tukar/retur, reports, invoice and pre-order all go through the base.
// Creates its own users/products; voids its sales, disables the rest.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/pack-product.mjs
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
const mk = async (role) => (await api(su, "POST", "/api/collections/users/records", { username: "pp" + role.slice(0, 4) + run, role, name: "PP " + role, password: pw, passwordConfirm: pw })).body;
const U = { owner: await mk("owner"), kasir: await mk("kasir"), pel: await mk("pelanggan") };
const T = {};
for (const k of ["owner", "kasir"]) T[k] = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: U[k].username, password: pw })).body.token;
const O = T.owner, K = T.kasir;
const tunai = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai").id;
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const base = (await api(O, "POST", "/api/collections/products/records", { name: "Uji Lakban " + run, sku: "PPA-" + run, category: cat.id, unit: "pcs", hpp: 7300, price: 13000, active: true, hide_online: true })).body;
await api(O, "POST", "/api/stock/move", { product: base.id, type: "masuk", qty: 50, note: "uji" });
const pack = (await api(O, "POST", "/api/collections/products/records", { name: "Uji Lakban 1 Pack " + run, sku: "PPB-" + run, category: cat.id, unit: "pack", hpp: 43800, price: 55000, active: true, hide_online: true, pack_of: base.id, pack_isi: 6 })).body;
check("pack product saved with pack_of + isi", pack.pack_of === base.id && pack.pack_isi === 6, pack);
const stock = async (p) => (await api(O, "GET", `/api/collections/products/records/${p.id}`)).body.stock;
const items = async (sale) => (await api(O, "GET", `/api/collections/sale_items/records?filter=${encodeURIComponent(`sale="${sale}"`)}&sort=created`)).body.items;
const pay = (n) => [{ method: tunai, amount: n }];
const sales = [];
const s1 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pack.id, qty: 1, price: 1 }], employee: "toko", payments: pay(55000) });
sales.push(s1.body.sale?.id);
const i1 = s1.status === 200 ? await items(s1.body.sale.id) : [];
check("kasir sells 1 pack: 55.000, base −6, client price ignored", s1.status === 200 && s1.body.sale.total === 55000 && (await stock(base)) === 44 && i1[0]?.product === base.id && i1[0].qty === 6 && i1[0].pack_size === 6 && i1[0].tier === "pack" && i1[0].hpp === 7300, [s1.body, i1]);
check("pack product's own stock untouched (0)", (await stock(pack)) === 0);
const s2 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: pack.id, qty: 2 }, { product: base.id, qty: 1 }], employee: "toko", payments: pay(123000) });
sales.push(s2.body.sale?.id);
check("2 packs + 1 loose: 110.000 + 13.000, base −13", s2.status === 200 && s2.body.sale.total === 123000 && (await stock(base)) === 31, s2.body);
check("more packs than base stock: refused", (await api(K, "POST", "/api/pos/checkout", { items: [{ product: pack.id, qty: 6 }], employee: "toko", payments: pay(330000) })).status === 400);
check("stock move on a pack product: refused", (await api(O, "POST", "/api/stock/move", { product: pack.id, type: "masuk", qty: 5 })).status === 400);
check("pack product + a different base pack on one sale: refused", (await api(K, "POST", "/api/pos/preview", { items: [{ product: pack.id, qty: 1 }, { product: base.id, qty: 1, tier: "pack", pack_size: 5 }] })).status === 400);
const sw = await api(K, "POST", "/api/pos/swap", { sale: s1.body.sale.id, returns: [{ product: base.id, qty: 6 }], items: [{ product: pack.id, qty: 1 }], employee: "toko" });
check("tukar: return the 6 pcs for another pack, stock unchanged", sw.status === 200 && (await stock(base)) === 31, sw.body);
if (sw.body.sale) sales.unshift(sw.body.sale.id);
const ret = await api(K, "POST", "/api/pos/swap", { sale: s2.body.sale.id, returns: [{ product: base.id, qty: 2 }], items: [{ product: base.id, qty: 2 }], employee: "toko", payments: pay(10000) });
check("retur 2 pcs out of a pack sale for 2 loose pcs: stock unchanged", ret.status === 200 && (await stock(base)) === 31, ret.body);
if (ret.body.sale) sales.unshift(ret.body.sale.id);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const row = (await api(O, "GET", `/api/reports/table?type=produk&from=${today}&to=${today}`)).body.rows?.find((r) => r.nama === base.name);
check("Laporan produk: under the base, pcs and HPP per pcs", row && row.qty === 6 + 13 + 6 - 6 + 2 - 2 && row.hpp === 7300 * row.qty, row);
const tok = (await api(K, "POST", `/api/invoice/${s1.body.sale.id}/link`)).body.token;
const inv = (await api(null, "GET", `/api/invoice/view/${tok}`)).body;
check("invoice shows the pack line (6 pcs per pack)", inv.items?.[0]?.pack_size === 6 && inv.items[0].subtotal === 55000, inv.items);
for (const id of sales) if (id) await api(O, "POST", `/api/pos/void/${id}`, { reason: "uji pack product" });
check("void all: base back to 50", (await stock(base)) === 50, await stock(base));
const po = await api(K, "POST", "/api/po/create", { items: [{ product: pack.id, qty: 2 }], customer: U.pel.id, employee: "toko", payments: pay(110000) });
check("pre-order of 2 packs: 110.000", po.status === 200 && po.body.preorder?.total === 110000, po.body);
if (po.status === 200) {
  const done = await api(K, "POST", `/api/po/${po.body.preorder.id}/complete`, { payments: [] });
  check("pre-order pickup: base −12", done.status === 200 && (await stock(base)) === 38, [done.status, done.body.message]);
}
for (const p of [pack, base]) await api(su, "PATCH", `/api/collections/products/records/${p.id}`, { active: false });
for (const u of Object.values(U)) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

// Selling by the pack: qty in packs, stock and every report in pcs. Checks
// pricing (own size, pro rata, fallback), mixed pack + pcs, stock on sale /
// void / tukar (retur), Laba Rugi HPP, pre-order and that the client can't
// set the price. Creates its own users/products; voids its sales.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/pack.mjs
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
const mk = async (role) => (await api(su, "POST", "/api/collections/users/records", { username: "pk" + role.slice(0, 4) + run, role, name: "Pack " + role, password: pw, passwordConfirm: pw })).body;
const U = { owner: await mk("owner"), kasir: await mk("kasir"), pel: await mk("pelanggan") };
const T = {};
for (const k of ["owner", "kasir"]) T[k] = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: U[k].username, password: pw })).body.token;
const O = T.owner, K = T.kasir;
const pms = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items, tunai = pms.find((m) => m.name === "Tunai").id;
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const mkProd = async (x) => { const p = (await api(O, "POST", "/api/collections/products/records", { category: cat.id, unit: "pcs", hpp: 9000, price: 13000, active: true, hide_online: true, ...x })).body; await api(O, "POST", "/api/stock/move", { product: p.id, type: "masuk", qty: 50, note: "uji" }); return p; };
const A = await mkProd({ name: "Uji Lakban " + run, sku: "PKA-" + run, pack_size: 6, price_pack: 70000 });
const B = await mkProd({ name: "Uji Pack Kosong " + run, sku: "PKB-" + run, pack_size: 4 });
const C = await mkProd({ name: "Uji Tanpa Pack " + run, sku: "PKC-" + run });
const stock = async (p) => (await api(O, "GET", `/api/collections/products/records/${p.id}`)).body.stock;
const items = async (sale) => (await api(O, "GET", `/api/collections/sale_items/records?filter=${encodeURIComponent(`sale="${sale}"`)}&sort=created`)).body.items;
const pay = (n) => [{ method: tunai, amount: n }];
const sales = [];

// 1. kasir sells 2 packs of the product's own size
const s1 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: A.id, qty: 2, tier: "pack", pack_size: 6, price: 1 }], employee: "toko", payments: pay(140000) });
sales.push(s1.body.sale?.id);
const i1 = s1.status === 200 ? await items(s1.body.sale.id) : [];
check("kasir: 2 packs × 6 = 12 pcs at the pack price (client price ignored)", s1.status === 200 && s1.body.sale.total === 140000 && i1.length === 1 && i1[0].qty === 12 && i1[0].pack_size === 6 && i1[0].tier === "pack" && i1[0].subtotal === 140000 && i1[0].hpp === 9000, [s1.body, i1]);
check("stock −12 pcs", (await stock(A)) === 38);
const mv = (await api(O, "GET", `/api/collections/stock_moves/records?filter=${encodeURIComponent(`product="${A.id}" && ref="${s1.body.sale?.number}"`)}`)).body.items;
check("stock history: one move of −12", mv.length === 1 && mv[0].qty === -12, mv);
// 2. another size on the line: pro rata
const pv = await api(K, "POST", "/api/pos/preview", { items: [{ product: A.id, qty: 1, tier: "pack", pack_size: 5 }] });
check("pack of 5 (product pack is 6): pro rata 58.333", pv.status === 200 && pv.body.total === Math.round(70000 * 5 / 6) && pv.body.lines[0].qty === 5, pv.body);
// 3. no pack price: size × pcs price
const pvB = await api(K, "POST", "/api/pos/preview", { items: [{ product: B.id, qty: 3, tier: "pack", pack_size: 4 }] });
check("no pack price: 3 packs × 4 × 13.000", pvB.body.total === 3 * 4 * 13000 && pvB.body.lines[0].qty === 12, pvB.body);
// 4. product without a pack size, bad sizes, too little stock
check("product without pack: refused", (await api(K, "POST", "/api/pos/preview", { items: [{ product: C.id, qty: 1, tier: "pack", pack_size: 6 }] })).status === 400);
check("pack size 0: refused", (await api(K, "POST", "/api/pos/preview", { items: [{ product: A.id, qty: 1, tier: "pack", pack_size: 0 }] })).status === 400);
check("more pcs than stock: refused", (await api(K, "POST", "/api/pos/checkout", { items: [{ product: A.id, qty: 7, tier: "pack", pack_size: 6 }], employee: "toko", payments: pay(490000) })).status === 400);
check("pelanggan login can't use pack", (await api((await api(null, "POST", "/api/collections/users/auth-with-password", { identity: U.pel.username, password: pw })).body.token, "POST", "/api/pos/preview", { items: [{ product: A.id, qty: 1, tier: "pack", pack_size: 6 }] })).status === 403);
// 5. mixed: 1 pack + 2 loose pcs of the same product
const s2 = await api(K, "POST", "/api/pos/checkout", { items: [{ product: A.id, qty: 1, tier: "pack", pack_size: 6 }, { product: A.id, qty: 2 }], employee: "toko", payments: pay(96000) });
sales.push(s2.body.sale?.id);
const i2 = s2.status === 200 ? await items(s2.body.sale.id) : [];
check("1 pack + 2 pcs: two lines, 70.000 + 26.000, stock −8", s2.status === 200 && s2.body.sale.total === 96000 && i2.length === 2 && i2[0].qty + i2[1].qty === 8 && (await stock(A)) === 30, [s2.body.sale, i2]);
// 6. tukar: return 3 pcs from the pack sale for 3 pcs of C
const sw = await api(K, "POST", "/api/pos/swap", { sale: s1.body.sale.id, returns: [{ product: A.id, qty: 3 }], items: [{ product: C.id, qty: 3 }], employee: "toko", payments: pay(10000) });
check("tukar returns 3 pcs out of the packs: stock A +3, C −3", sw.status === 200 && (await stock(A)) === 33 && (await stock(C)) === 47, sw.body);
if (sw.body.sale) sales.unshift(sw.body.sale.id);
// 7. Laba Rugi counts HPP per pcs
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const rowA = (await api(O, "GET", `/api/reports/table?type=produk&from=${today}&to=${today}`)).body.rows?.find((r) => r.nama === A.name);
check("Laporan produk: pcs and HPP in pcs", rowA && rowA.qty === 12 + 8 - 3 && rowA.hpp === 9000 * rowA.qty, rowA);
// 8. void puts the pcs back
for (const id of sales) if (id) await api(O, "POST", `/api/pos/void/${id}`, { reason: "uji pack" });
check("void: stock back to 50 / 50", (await stock(A)) === 50 && (await stock(C)) === 50, [await stock(A), await stock(C)]);
// 9. pre-order with packs
const po = await api(K, "POST", "/api/po/create", { items: [{ product: A.id, qty: 2, tier: "pack", pack_size: 6 }], customer: U.pel.id, employee: "toko", payments: pay(140000) });
check("pre-order: 2 packs priced 140.000, items keep pack_size", po.status === 200 && po.body.preorder?.total === 140000 && (Array.isArray(po.body.preorder.items) ? po.body.preorder.items : JSON.parse(po.body.preorder.items))[0].pack_size === 6, po.body);
if (po.status === 200) {
  const done = await api(K, "POST", `/api/po/${po.body.preorder.id}/complete`, { payments: [] });
  const ip = done.body.sale ? await items(done.body.sale.id) : [];
  check("pre-order pickup: sale line 12 pcs pack, stock −12", done.status === 200 && ip[0]?.qty === 12 && ip[0]?.pack_size === 6 && (await stock(A)) === 38, [done.status, done.body.message, ip]);
}
await api(su, "PATCH", `/api/collections/products/records/${A.id}`, { active: false });
for (const p of [B, C]) await api(su, "PATCH", `/api/collections/products/records/${p.id}`, { active: false });
for (const u of Object.values(U)) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

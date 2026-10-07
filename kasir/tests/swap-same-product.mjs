// Repro: a swap that returns and gives out the SAME product must leave stock
// equal to the stock ledger. Sandbox only.
//   PB=http://127.0.0.1:8099 OWNER_PASS=… node tests/swap-same-product.mjs
const PB = process.env.PB || "http://127.0.0.1:8099";
if (/:8090\b/.test(PB)) throw new Error("sandbox only");
const api = async (t, m, p, b) => { const r = await fetch(PB + p, { method: m, headers: { "Content-Type": "application/json", Authorization: t || "" }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${p} ${j.message}`); return j; };
const O = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: "alin", password: process.env.OWNER_PASS })).token;
const run = Date.now().toString(36);
const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).items[0];
const tunai = (await api(O, "GET", `/api/collections/payment_methods/records?filter=${encodeURIComponent('name="Tunai"')}`)).items[0].id;
const p = await api(O, "POST", "/api/collections/products/records", { name: "Uji Tukar Sama " + run, sku: "SWP-" + run, category: cat.id, unit: "pcs", hpp: 50000, price: 60000, active: true, hide_online: true });
await api(O, "POST", "/api/stock/move", { product: p.id, type: "masuk", qty: 10 });
const sale = await api(O, "POST", "/api/pos/checkout", { items: [{ product: p.id, qty: 1 }], employee: "toko", payments: [{ method: tunai, amount: 60000 }] });
// Wrong size: bring back 1, take 1 of the same model; then 1 back for 2.
await api(O, "POST", "/api/pos/swap", { sale: sale.sale.id, returns: [{ product: p.id, qty: 1 }], items: [{ product: p.id, qty: 1 }], employee: "toko" });
const after1 = (await api(O, "GET", `/api/collections/products/records/${p.id}`)).stock;
const sale2 = await api(O, "POST", "/api/pos/checkout", { items: [{ product: p.id, qty: 1 }], employee: "toko", payments: [{ method: tunai, amount: 60000 }] });
await api(O, "POST", "/api/pos/swap", { sale: sale2.sale.id, returns: [{ product: p.id, qty: 1 }], items: [{ product: p.id, qty: 2 }], employee: "toko", payments: [{ method: tunai, amount: 60000 }] });
const after2 = (await api(O, "GET", `/api/collections/products/records/${p.id}`)).stock;
const ledger = (await api(O, "GET", `/api/collections/stock_moves/records?perPage=50&filter=${encodeURIComponent(`product="${p.id}"`)}`)).items.reduce((a, m) => a + m.qty, 0);
const ok1 = after1 === 9, ok2 = after2 === 7 && ledger === 7;
console.log(`${ok1 ? "ok  " : "FAIL"} swap 1 for 1 of the same product: stock ${after1} (expected 9)`);
console.log(`${ok2 ? "ok  " : "FAIL"} swap 1 for 2 of the same product: stock ${after2}, ledger ${ledger} (expected 7 / 7)`);
await api(O, "PATCH", `/api/collections/products/records/${p.id}`, { active: false });
process.exit(ok1 && ok2 ? 0 : 1);

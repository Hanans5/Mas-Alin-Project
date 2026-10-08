// A4 invoice link: staff make it, anyone with it sees that one invoice (no
// login, masked phone, no cost prices), owner/admin can revoke it.
// Creates its own users/product/sales; voids the sales and disables the rest.
//   PB=http://127.0.0.1:8091 SU_EMAIL=… SU_PASS=… node tests/invoice.mjs
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
const mk = async (role, extra = {}) => (await api(su, "POST", "/api/collections/users/records", { username: "i" + role.slice(0, 4) + run, role, name: "Inv " + role + " " + run, password: pw, passwordConfirm: pw, ...extra })).body;
const U = { owner: await mk("owner"), kasir: await mk("kasir"), pel: await mk("pelanggan", { phone: "081234567890" }) };
const T = {};
for (const k of ["owner", "kasir"]) T[k] = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: U[k].username, password: pw })).body.token;
const tunai = (await api(T.owner, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai");
const cat = (await api(T.owner, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(T.owner, "POST", "/api/collections/products/records", { name: "Uji Invoice " + run, sku: "IV-" + run, category: cat.id, unit: "pcs", hpp: 10000, price: 20000, active: true, hide_online: true })).body;
await api(T.owner, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 20, note: "uji" });
const cart = { items: [{ product: prod.id, qty: 2 }], employee: "toko" };
const a = (await api(T.kasir, "POST", "/api/pos/checkout", { ...cart, payments: [{ method: tunai.id, amount: 50000 }] })).body.sale;
const b = (await api(T.owner, "POST", "/api/pos/checkout", { ...cart, customer: U.pel.id, payments: [{ method: tunai.id, amount: 15000 }], credit: true })).body.sale;

const la = await api(T.kasir, "POST", `/api/invoice/${a.id}/link`);
check("kasir makes a link", la.status === 200 && /^[A-Za-z0-9]{40}$/.test(la.body.token), la.body);
check("same link the second time", (await api(T.kasir, "POST", `/api/invoice/${a.id}/link`)).body.token === la.body.token);
check("no link without login", (await api(null, "POST", `/api/invoice/${a.id}/link`)).status === 401);
const va = await api(null, "GET", `/api/invoice/view/${la.body.token}`);
check("public view without login", va.status === 200 && va.body.sale.number === a.number, va.body);
check("walk-in shows Toko, kasir login signs as its name", va.body.customer?.name === "Toko" && va.body.signer === "Inv kasir " + run, [va.body.customer, va.body.signer]);
check("cash line = handed over, change apart", va.body.payments?.[0]?.amount === 50000 && va.body.sale.change === 10000 && va.body.sale.paid === 40000 && va.body.sale.status === "LUNAS", va.body.sale);
const raw = JSON.stringify(va.body);
check("no cost price, ids or token in the payload", !/hpp|"id"|cashier|invoice_token/.test(raw), raw.slice(0, 200));
check("token not readable through the records API", !("invoice_token" in (await api(T.owner, "GET", `/api/collections/sales/records/${a.id}`)).body));
const lb = (await api(T.owner, "POST", `/api/invoice/${b.id}/link`)).body.token;
const vb = (await api(null, "GET", `/api/invoice/view/${lb}`)).body;
check("bon: DP status, sisa, owner login signs as Toko", vb.sale?.status === "DP" && vb.sale.sisa === 25000 && vb.signer === "Toko", [vb.sale, vb.signer]);
check("pelanggan phone masked", vb.customer?.phone === "0812*****890" && vb.customer.code === U.pel.username.toUpperCase(), vb.customer);
check("bad token → 404", (await api(null, "GET", "/api/invoice/view/" + "x".repeat(40))).status === 404);
check("kasir can't revoke", (await api(T.kasir, "POST", `/api/invoice/${a.id}/revoke`)).status === 403);
check("owner revokes", (await api(T.owner, "POST", `/api/invoice/${a.id}/revoke`)).status === 200);
check("revoked link → 404", (await api(null, "GET", `/api/invoice/view/${la.body.token}`)).status === 404);
check("new link after revoke differs", (await api(T.owner, "POST", `/api/invoice/${a.id}/link`)).body.token !== la.body.token);
check("invoice page is served", (await fetch(PB + "/invoice.html")).status === 200);
for (const s of [a, b]) await api(T.owner, "POST", `/api/pos/void/${s.id}`, { reason: "uji invoice" });
check("voided sale shows DIBATALKAN", (await api(null, "GET", `/api/invoice/view/${lb}`)).body.sale?.status === "DIBATALKAN");
await api(su, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
for (const u of Object.values(U)) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

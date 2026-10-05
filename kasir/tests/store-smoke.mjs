// Online store end to end: order → proof → confirm → sale → ship → done,
// plus cancel, wrong token, oversell. Creates real orders; leaves them as
// demo history (they're cancelled or completed by the end).
//   PB=http://127.0.0.1:8090 OWNER_PASS=… [OWNER_USER=alin] node tests/store-smoke.mjs
const PB = process.env.PB || "http://127.0.0.1:8090";
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`); if (!ok) failures++; };
async function api(token, method, path, body) {
  const r = await fetch(PB + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const O = (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: process.env.OWNER_USER || "alin", password: process.env.OWNER_PASS })).body.token;
const cat = (await api(null, "GET", "/api/store/catalog")).body;
const p = cat.products.find((x) => x.stock > 20);
const stockBefore = p.stock;
check("catalog hides cost price", !("hpp" in p), Object.keys(p));

const base = { name: "Uji Pembeli", phone: "0812-3456-7890", email: "", payment: "transfer",
  delivery: "kirim", address: { province: "Jawa Timur", city: "Surabaya", district: "Gubeng", postal: "60281", street: "Jl. Raya Gubeng No. 12" },
  courier: "JNE", service: "REG" };
const made = await api(null, "POST", "/api/store/orders", { ...base, items: [{ product: p.id, qty: 2 }] });
check("place order", made.status === 200 && /^WEB-\d{6}-\d{3}$/.test(made.body.number), made.body);
const { number, token } = made.body;

const view = await api(null, "GET", `/api/store/orders/${number}?t=${token}`);
check("view with token", view.status === 200 && view.body.total === p.price * 2 + view.body.shipping + view.body.unique_code, view.body);
check("shipping JNE REG to Jatim, 500 g = 1 kg = 12.000", view.body.shipping === 12000, view.body.shipping);
const wrong = await api(null, "GET", `/api/store/orders/${number}?t=nope`);
check("wrong token is 404", wrong.status === 404, wrong.status);
const after = (await api(null, "GET", "/api/store/catalog")).body.products.find((x) => x.id === p.id).stock;
check("stock reserved at order time", after === stockBefore - 2, { stockBefore, after });

const oversell = await api(null, "POST", "/api/store/orders", { ...base, items: [{ product: p.id, qty: 99999 }] });
check("cannot order more than stock", oversell.status === 400, oversell.body);
const noAddr = await api(null, "POST", "/api/store/orders", { ...base, address: { province: "Jawa Timur" }, items: [{ product: p.id, qty: 1 }] });
check("address required for delivery", noAddr.status === 400, noAddr.body);
const anonAdmin = await api(null, "POST", `/api/store/admin/x/confirm`);
check("admin route needs login", anonAdmin.status === 401 || anonAdmin.status === 403, anonAdmin.status);

// proof upload (multipart)
const fd = new FormData();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
fd.append("proof", new Blob([png], { type: "image/png" }), "bukti.png");
const up = await fetch(`${PB}/api/store/orders/${number}/proof?t=${token}`, { method: "POST", body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
check("upload proof → menunggu_verifikasi", up.status === 200 && up.body.status === "menunggu_verifikasi" && up.body.has_proof, up.body);

const rec = (await api(O, "GET", `/api/collections/web_orders/records?filter=${encodeURIComponent(`number="${number}"`)}`)).body.items[0];
const fee = await api(O, "POST", `/api/store/admin/${rec.id}/shipping`, { fee: 15000 });
check("admin adjusts ongkir", fee.status === 200 && fee.body.total === p.price * 2 + 15000 + rec.unique_code, fee.body);
const conf = await api(O, "POST", `/api/store/admin/${rec.id}/confirm`);
check("confirm payment → diproses + sale", conf.status === 200 && conf.body.status === "diproses" && !!conf.body.sale, conf.body);
const sale = (await api(O, "GET", `/api/collections/sales/records/${conf.body.sale}`)).body;
check("sale is lunas, goods only", sale.status === "lunas" && sale.total === p.price * 2 && sale.note.includes(number), sale);
const stockAfterConfirm = (await api(null, "GET", "/api/store/catalog")).body.products.find((x) => x.id === p.id).stock;
check("confirm doesn't move stock twice", stockAfterConfirm === stockBefore - 2, stockAfterConfirm);
const shipShort = await api(O, "POST", `/api/store/admin/${rec.id}/ship`, { resi: "123" });
check("resi required", shipShort.status === 400, shipShort.body);
const ship = await api(O, "POST", `/api/store/admin/${rec.id}/ship`, { resi: "JNE0012345678" });
check("ship with resi", ship.status === 200 && ship.body.status === "dikirim", ship.body);
const done = await api(O, "POST", `/api/store/admin/${rec.id}/complete`);
check("complete", done.status === 200 && done.body.status === "selesai", done.body);
const hist = (await api(null, "GET", `/api/store/orders/${number}?t=${token}`)).body.history;
check("history has 6 steps", Array.isArray(hist) && hist.length === 6, hist);

// customer cancels an unpaid pickup order → stock back
const qrisOrder = await api(null, "POST", "/api/store/orders", { ...base, delivery: "ambil", payment: "qris", items: [{ product: p.id, qty: 1 }] });
check("QRIS order refused (transfer only)", qrisOrder.status === 400, qrisOrder.body);
const m2 = (await api(null, "POST", "/api/store/orders", { ...base, delivery: "ambil", payment: "transfer", items: [{ product: p.id, qty: 1 }] })).body;
const v2 = (await api(null, "GET", `/api/store/orders/${m2.number}?t=${m2.token}`)).body;
check("pickup order has no shipping", v2.shipping === 0 && v2.delivery === "ambil", v2);
const c2 = await api(null, "POST", `/api/store/orders/${m2.number}/cancel?t=${m2.token}`);
check("customer cancels unpaid order", c2.status === 200, c2.body);
const s3 = (await api(null, "GET", "/api/store/catalog")).body.products.find((x) => x.id === p.id).stock;
check("stock returned after cancel", s3 === stockBefore - 2, s3);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

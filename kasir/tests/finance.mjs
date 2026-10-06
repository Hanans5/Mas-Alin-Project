// Money paths at the till, end to end: split payment (Tunai + Transfer),
// change only from cash, DP and pure bon on a named customer, paying a bon
// off in parts, retired points/vouchers, and every rupiah landing in Buku Kas
// under the right method. Creates its own users/product and disables them.
//   PB=http://127.0.0.1:8090 SU_EMAIL=… SU_PASS=… node tests/finance.mjs
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
const owner = await mk("fowner" + run, "owner"), kasir = await mk("fkasir" + run, "kasir"), cust = await mk("fcust" + run, "pelanggan");
const login = async (u) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: pw })).body.token;
const O = await login(owner.username), K = await login(kasir.username);
check("test users log in", !!O && !!K && !!cust.id);

const methods = (await api(O, "GET", "/api/collections/payment_methods/records")).body.items;
const id = (n) => methods.find((m) => m.name === n)?.id;
const TUNAI = id("Tunai"), TRANSFER = id("Transfer"), QRIS = id("QRIS");
check("only Tunai and Transfer are active", methods.filter((m) => m.active).map((m) => m.name).sort().join(",") === "Transfer,Tunai", methods.map((m) => [m.name, m.active]));

const cat = (await api(O, "GET", "/api/collections/categories/records?perPage=1")).body.items[0];
const prod = (await api(O, "POST", "/api/collections/products/records", { name: "Uji Keuangan " + run, sku: "FIN-" + run, category: cat.id, unit: "pcs", hpp: 50000, price: 62000, min_stock: 0, active: true, hide_online: true })).body;
await api(O, "POST", "/api/stock/move", { product: prod.id, type: "masuk", qty: 50, note: "uji keuangan" });
const emp = (await api(O, "POST", "/api/collections/employees/records", { name: "Uji Keuangan " + run, active: true })).body;
const item = (qty) => [{ product: prod.id, qty }];
const sale = (body) => api(K, "POST", "/api/pos/checkout", { employee: emp.id, ...body });
const paysOf = async (saleId) => (await api(O, "GET", `/api/collections/sale_payments/records?filter=${encodeURIComponent(`sale="${saleId}"`)}&expand=payment_method`)).body.items
  .map((p) => `${p.expand.payment_method.name}:${p.amount}`).sort().join(",");
const numbers = [];

// F1 split, paid in full: 124.000 with Tunai 100.000 + Transfer 30.000 → change 6.000 from cash
const f1 = await sale({ items: item(2), payments: [{ method: TUNAI, amount: 100000 }, { method: TRANSFER, amount: 30000 }] });
check("split: lunas, paid 124.000, change 6.000", f1.status === 200 && f1.body.sale.status === "lunas" && f1.body.sale.paid === 124000 && f1.body.sale.change === 6000, f1.body);
check("split rows: Tunai 94.000 (net of change) + Transfer 30.000", await paysOf(f1.body.sale?.id) === "Transfer:30000,Tunai:94000", await paysOf(f1.body.sale?.id));
check("checkout returns its payment rows", f1.body.payments?.length === 2, f1.body.payments);
numbers.push(f1.body.sale.number);

// Refusals
const f2 = await sale({ items: item(1), payments: [{ method: TRANSFER, amount: 70000 }] });
check("transfer above total refused (no change from transfer)", f2.status === 400, f2.body);
const f3 = await sale({ items: item(1), payments: [{ method: QRIS, amount: 62000 }] });
check("QRIS refused (switched off)", f3.status === 400, f3.body);
const f4 = await sale({ items: item(1), payments: [{ method: TUNAI, amount: 20000 }] });
check("short payment without bon refused", f4.status === 400, f4.body);
const f5 = await sale({ items: item(1), payments: [{ method: TUNAI, amount: 20000 }], credit: true });
check("bon without a pelanggan refused", f5.status === 400, f5.body);
const f5b = await sale({ items: item(1), payments: [{ method: TUNAI, amount: -5 }] });
check("negative amount refused", f5b.status === 400, f5b.body);

// F6 DP: 62.000, Tunai 20.000 now, 42.000 bon, due date
const f6 = await sale({ items: item(1), customer: cust.id, payments: [{ method: TUNAI, amount: 20000 }], credit: true, due_date: "2026-12-31" });
check("DP: status piutang, paid 20.000, change 0", f6.status === 200 && f6.body.sale.status === "piutang" && f6.body.sale.paid === 20000 && f6.body.sale.change === 0, f6.body);
const rc6 = (await api(O, "GET", `/api/collections/receivables/records?filter=${encodeURIComponent(`sale="${f6.body.sale?.id}"`)}`)).body.items[0];
check("DP: bon 42.000 open, due 31 Des", rc6?.amount === 42000 && rc6?.paid === 0 && rc6?.status === "belum" && String(rc6?.due_date).startsWith("2026-12-31"), rc6);
numbers.push(f6.body.sale.number);

// F7 pure bon (ngebon): nothing paid now
const f7 = await sale({ items: item(1), customer: cust.id, payments: [], credit: true });
check("bon: piutang, paid 0, no payment rows, no method", f7.status === 200 && f7.body.sale.paid === 0 && f7.body.sale.payment_method === "" && (await paysOf(f7.body.sale?.id)) === "", f7.body);
const rc7 = (await api(O, "GET", `/api/collections/receivables/records?filter=${encodeURIComponent(`sale="${f7.body.sale?.id}"`)}`)).body.items[0];
check("bon: 62.000 open", rc7?.amount === 62000 && rc7?.status === "belum", rc7);
numbers.push(f7.body.sale.number);

// F8 pay the DP's bon in two parts and two methods
const p1 = await api(O, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 30000, payment_method: TRANSFER });
check("bon payment 1: Transfer 30.000, left 12.000", p1.status === 200 && p1.body.left === 12000, p1.body);
const pq = await api(O, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 12000, payment_method: QRIS });
check("bon payment by QRIS refused", pq.status === 400, pq.body);
const over = await api(O, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 12001, payment_method: TUNAI });
check("bon overpayment refused", over.status === 400, over.body);
// the shared kasir login takes bon payments at the counter
const found = await api(K, "GET", `/api/bon/open?q=${encodeURIComponent(cust.username)}`);
check("kasir finds the pelanggan's open bons by name", found.status === 200 && found.body.items.some((b) => b.id === rc6.id && b.amount - b.paid === 12000) && found.body.items.some((b) => b.id === rc7.id), found.body);
const byNo = await api(K, "GET", `/api/bon/open?q=${encodeURIComponent(f6.body.sale.number.toLowerCase())}`);
check("kasir finds a bon by receipt number", byNo.status === 200 && byNo.body.items.length === 1 && byNo.body.items[0].id === rc6.id, byNo.body);
const kpay = await api(K, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 2000, payment_method: TUNAI });
check("kasir takes a bon payment: Tunai 2.000, left 10.000", kpay.status === 200 && kpay.body.left === 10000, kpay.body);
const kover = await api(K, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 10001, payment_method: TUNAI });
check("kasir cannot overpay a bon either", kover.status === 400, kover.body);
const C = await login(cust.username);
const custSearch = await api(C, "GET", "/api/bon/open");
const custPay = await api(C, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 1000, payment_method: TUNAI });
check("pelanggan can't search bons or record payments", custSearch.status === 403 && custPay.status === 403, [custSearch.status, custPay.status]);
const p2 = await api(O, "POST", "/api/receivables/pay", { receivable: rc6.id, amount: 10000, payment_method: TUNAI });
check("bon payment 3: Tunai 10.000, paid off", p2.status === 200 && p2.body.left === 0, p2.body);
const gone = await api(K, "GET", `/api/bon/open?q=${encodeURIComponent(f6.body.sale.number)}`);
check("a paid-off bon leaves the open list", gone.status === 200 && gone.body.items.length === 0, gone.body);
const s6 = (await api(O, "GET", `/api/collections/sales/records/${f6.body.sale.id}`)).body;
check("paid-off bon marks the sale lunas, sale.paid stays 20.000 (no double count)", s6.status === "lunas" && s6.paid === 20000, s6);

// F10 retired points and vouchers: fields are ignored
const before = (await api(O, "GET", `/api/collections/users/records/${cust.id}`)).body.points;
const f10 = await sale({ items: item(1), customer: cust.id, payments: [{ method: TUNAI, amount: 62000 }], voucher_code: "IDULADHA", points_used: 5 });
const after = (await api(O, "GET", `/api/collections/users/records/${cust.id}`)).body.points;
check("voucher/points ignored: total 62.000, no points earned or used", f10.status === 200 && f10.body.sale.total === 62000 && f10.body.sale.points_earned === 0 && f10.body.sale.points_used === 0 && after === before, { sale: f10.body.sale, before, after });
numbers.push(f10.body.sale.number);

// F13 legacy request shape still works
const f13 = await sale({ items: item(1), payment_method: TRANSFER, paid: 62000 });
check("legacy payment_method + paid → one Transfer row", f13.status === 200 && (await paysOf(f13.body.sale?.id)) === "Transfer:62000", f13.body);
numbers.push(f13.body.sale.number);

// F11 Buku Kas: every rupiah of these sales, by method
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const cb = (await api(O, "GET", `/api/reports/cashbook?from=${today}&to=${today}`)).body;
const mine = cb.lines.filter((l) => numbers.includes(l.ref));
const sum = (m) => mine.filter((l) => l.method === m && l.type === "masuk").reduce((a, l) => a + l.amount, 0);
// Tunai: 94.000 (F1) + 20.000 (F6 DP) + 2.000 + 10.000 (bon) + 62.000 (F10) = 188.000; Transfer: 30.000 (F1) + 30.000 (bon) + 62.000 (F13) = 122.000
check("Buku Kas Tunai = 188.000", sum("Tunai") === 188000, mine);
check("Buku Kas Transfer = 122.000", sum("Transfer") === 122000, mine);
check("Buku Kas labels DP and bon payments (3)", mine.some((l) => l.source === "DP penjualan" && l.amount === 20000) && mine.filter((l) => l.source === "Bayar piutang").length === 3, mine.map((l) => [l.source, l.method, l.amount]));
check("nothing in Buku Kas for the pure bon yet", !mine.some((l) => l.ref === f7.body.sale.number), mine.filter((l) => l.ref === f7.body.sale.number));

// Sales report shows the split
const rep = (await api(O, "GET", `/api/reports/table?type=penjualan&from=${today}&to=${today}`)).body;
const r1 = rep.rows.find((x) => x.number === f1.body.sale.number), r7 = rep.rows.find((x) => x.number === f7.body.sale.number);
check("sales report: method 'Tunai + Transfer' / 'Bon', paid column", /Tunai/.test(r1?.metode) && /Transfer/.test(r1?.metode) && r7?.metode === "Bon" && r7?.status === "bon" && r1?.paid === 124000, { r1, r7 });

// F12 voiding takes the sale's money out of Buku Kas
await api(O, "POST", `/api/pos/void/${f1.body.sale.id}`, { reason: "uji keuangan" });
const cb2 = (await api(O, "GET", `/api/reports/cashbook?from=${today}&to=${today}`)).body;
check("voided sale leaves Buku Kas", !cb2.lines.some((l) => l.ref === f1.body.sale.number), cb2.lines.filter((l) => l.ref === f1.body.sale.number));
check("Buku Kas total in drops by exactly 124.000", cb.total_in - cb2.total_in === 124000, [cb.total_in, cb2.total_in]);

// F14 swap difference: same rules (no change from transfer)
const base = await sale({ items: item(1), payments: [{ method: TUNAI, amount: 62000 }] });
const swOver = await api(K, "POST", "/api/pos/swap", { sale: base.body.sale.id, returns: [{ product: prod.id, qty: 1 }], items: item(2), payments: [{ method: TRANSFER, amount: 70000 }], employee: emp.id });
check("swap: transfer above the difference refused", swOver.status === 400, swOver.body);
const sw = await api(K, "POST", "/api/pos/swap", { sale: base.body.sale.id, returns: [{ product: prod.id, qty: 1 }], items: item(2), payments: [{ method: TUNAI, amount: 70000 }], employee: emp.id });
check("swap: difference 62.000 paid Tunai 70.000, change 8.000, one row of 62.000", sw.status === 200 && sw.body.sale.paid === 62000 && sw.body.sale.change === 8000 && (await paysOf(sw.body.sale?.id)) === "Tunai:62000", sw.body);

// clean up: void what's left, switch the test karyawan/product off, disable users
for (const s of [f6, f7, f10, f13, base].map((x) => x.body.sale?.id).filter(Boolean)) {
  if (s === base.body.sale?.id) await api(O, "POST", `/api/pos/void/${sw.body.sale?.id}`, { reason: "uji keuangan" });
  await api(O, "POST", `/api/pos/void/${s}`, { reason: "uji keuangan" });
}
await api(O, "PATCH", `/api/collections/employees/records/${emp.id}`, { active: false });
await api(O, "PATCH", `/api/collections/products/records/${prod.id}`, { active: false });
for (const u of [owner, kasir, cust]) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

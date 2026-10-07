// One year of simulated shop activity with the CURRENT features — 7 Oct 2025
// to 6 Oct 2026 — for testing on a SANDBOX copy, never the live database.
// Everything goes through the real routes; the API stamps "now" on rows and
// tests/simulate-year-backdate.mjs then moves them to their simulated time.
//
// Exercises: one shared kasir login + karyawan per sale (and "Toko"), a
// karyawan leaving and one joining, kodian (full 20 pcs), owner custom
// prices and discounts, Tunai / Transfer / Pecah pembayaran with change,
// DP and full bon with instalments paid at the till or in Piutang, tukar
// barang (and a voided swap), voids, online orders (confirm, ship, resi fix,
// pickup, cancel by buyer / by shop, ongkir correction, left to expire),
// restocks with supplier payments, stock opname, damaged stock, expenses.
//
//   PB=http://127.0.0.1:8099 SU_EMAIL=… SU_PASS=… OWNER_PASS=… KASIR_PASS=… node tests/simulate-year.mjs
// Writes tests/sim-year-events.json for the backdate step.
import { writeFileSync } from "node:fs";

const PB = process.env.PB || "http://127.0.0.1:8099";
if (/:8090\b/.test(PB) || /necutbarber/.test(PB)) throw new Error("Refusing to run against the live server.");
const WIB = 7 * 3600e3;
const START = "2025-10-07", END = "2026-10-06", STORE_OPEN = "2026-01-05";

let seed = 20251007;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
const randint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const round = (n, to) => Math.floor(n / to) * to;

async function api(token, method, path, body, headers = {}) {
  const r = await fetch(PB + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${j.message} ${JSON.stringify(j.data || {})}`);
  return j;
}
const login = async (u, p) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: p })).token;
const all = async (t, coll, q = "") => (await api(t, "GET", `/api/collections/${coll}/records?perPage=500${q}`)).items;
const at = (day, h, m) => new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60e3 - WIB).toISOString().replace("T", " ");
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const days = []; for (let d = START; d <= END; d = addDays(d, 1)) days.push(d);
const wibDay = (ts) => new Date(Date.parse(ts.replace(" ", "T")) + WIB).toISOString().slice(0, 10);
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();

// ── logins (sandbox only) ──────────────────────────
const su = (await api(null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.SU_EMAIL, password: process.env.SU_PASS })).token;
// Online orders come from many buyers: let the sandbox read their IP from a header.
await api(su, "PATCH", "/api/settings", { trustedProxy: { headers: ["X-Forwarded-For"], useLeftmostIP: true } });
const alin = (await all(su, "users", `&filter=${encodeURIComponent(`username="alin"`)}`))[0];
await api(su, "PATCH", `/api/collections/users/records/${alin.id}`, { password: process.env.OWNER_PASS, passwordConfirm: process.env.OWNER_PASS });
let kasirUser = (await all(su, "users", `&filter=${encodeURIComponent(`username="kasir"`)}`))[0];
if (kasirUser) await api(su, "PATCH", `/api/collections/users/records/${kasirUser.id}`, { disabled: false, role: "kasir", password: process.env.KASIR_PASS, passwordConfirm: process.env.KASIR_PASS });
else kasirUser = await api(su, "POST", "/api/collections/users/records", { username: "kasir", name: "Kasir Toko", role: "kasir", password: process.env.KASIR_PASS, passwordConfirm: process.env.KASIR_PASS });
const O = await login("alin", process.env.OWNER_PASS);
const K = await login("kasir", process.env.KASIR_PASS);

// ── people and catalogue ───────────────────────────
const methods = await all(O, "payment_methods");
const TUNAI = methods.find((m) => m.name === "Tunai").id, TRANSFER = methods.find((m) => m.name === "Transfer").id;
const employees = (await all(O, "employees", `&filter=${encodeURIComponent("active=true")}&sort=created`)).map((e, i) => ({ id: e.id, weight: [5, 4, 4, 3, 2, 1][i] || 2, active: true }));
const customers = (await all(su, "users", `&filter=${encodeURIComponent(`role="pelanggan"`)}`)).map((u) => ({
  id: u.id, name: u.name || u.username, phone: u.phone || "", reseller: /^(Toko|Bu Haji)/.test(u.name || ""), weight: 0.3 + rnd() * 2,
}));
const products = await all(O, "products", `&filter=${encodeURIComponent("active=true")}`);
const P = Object.fromEntries(products.map((p) => [p.id, p]));
const popularity = { "Tunik List": 9, "Blouse List": 8, "Blouse Slempang": 6, "Tunik Kerah TM": 5, "Tunik Bolero TM": 4, "Tunik Kancing TM": 4, "Tunik Ayam TM": 3, "Tunik Ziper Emas TM": 3, "Tunik Floy TM": 2, "Tunik Tamiya TM": 2 };
const pickProduct = () => weighted(products.map((p) => [p, popularity[p.name] || 1]));
const stock = Object.fromEntries(products.map((p) => [p.id, 0]));
const { provinces } = await api(null, "GET", "/api/store/shipping");

// ── the timeline ───────────────────────────────────
// Kinds run in this order within a minute: fixed items, then sales.
const events = [];
const push = (ev) => events.push(ev);
const inRange = (d, a, b) => d >= a && d <= b;
days.forEach((day, i) => {
  const dom = +day.slice(8);
  let n = 13;
  if (dow(day) === 6 || dow(day) === 0) n *= 1.5;
  if (dom >= 25 || dom <= 3) n *= 1.2;                           // payday
  if (inRange(day, "2025-12-20", "2025-12-31")) n *= 1.3;          // year-end holidays
  if (inRange(day, "2026-02-18", "2026-03-04")) n *= 1.3;          // early Ramadan
  if (inRange(day, "2026-03-05", "2026-03-18")) n *= 2.1;          // the Lebaran rush
  if (inRange(day, "2026-03-19", "2026-03-23")) n = 0;             // closed for Idul Fitri
  if (inRange(day, "2026-05-20", "2026-05-26")) n *= 1.3;          // before Idul Adha
  if (inRange(day, "2026-07-13", "2026-07-18")) n *= 1.2;          // new school year
  if (inRange(day, "2026-08-12", "2026-08-18")) n *= 1.3;          // Agustusan
  if (inRange(day, "2026-09-28", "2026-10-02")) n *= 1.4;          // Hari Batik Nasional (2 Oct)
  n *= 0.85 + 0.3 * (i / days.length);                             // the shop grows
  n *= 0.8 + rnd() * 0.4;
  const count = Math.round(n);
  const times = Array.from({ length: count }, () => randint(9 * 60, 20 * 60 + 45)).sort((a, b) => a - b);
  for (const t of times) push({ kind: "sale", day, ts: at(day, Math.floor(t / 60), t % 60) });
  // Online orders, from the store's opening.
  if (day >= STORE_OPEN && !inRange(day, "2026-03-19", "2026-03-23")) {
    const web = Math.round((0.6 + 2.2 * ((i - days.indexOf(STORE_OPEN)) / days.length)) * (0.5 + rnd()) * (inRange(day, "2026-03-01", "2026-03-15") ? 2 : 1));
    for (let k = 0; k < web; k++) { const t = randint(6 * 60, 23 * 60); push({ kind: "web", day, ts: at(day, Math.floor(t / 60), t % 60) }); }
  }
  const exp = (category, amount, note, h = 10) => push({ kind: "expense", day, ts: at(day, h, 0), category, amount, note });
  if (dom === 1) { exp("Gaji", 9000000, "Gaji karyawan " + day.slice(0, 7)); exp("Sewa", 2500000, "Sewa kios " + day.slice(0, 7)); }
  if (dom === 5) exp("Listrik", randint(52, 78) * 10000, "Token PLN");
  if (dom === 7) exp("Internet", 350000, "Indihome");
  if (dom === 20) exp("Air", randint(9, 15) * 10000, "PDAM");
  if (dow(day) === 1) exp("Belanja bahan", randint(10, 22) * 10000, "Plastik, lakban, kertas thermal", 9);
  if (rnd() < 0.08) exp("Transport", randint(3, 12) * 10000, "Ongkir ambil barang", 15);
  if (rnd() < 0.03) exp("Perawatan", randint(10, 40) * 10000, pick(["Servis AC", "Ganti lampu", "Perbaikan rak", "Cat etalase"]), 11);
  if (day === "2026-03-12") exp("THR", 9000000, "THR karyawan", 17);
  // Stock count at the end of each quarter; a damaged piece now and then.
  if (["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].includes(day)) push({ kind: "opname", day, ts: at(day, 21, 0) });
  if (rnd() < 0.02) push({ kind: "rusak", day, ts: at(day, 20, 55) });
  // Staff changes: one karyawan leaves, a new one joins.
  if (day === "2026-02-28") push({ kind: "leave", day, ts: at(day, 21, 10) });
  if (day === "2026-04-01") push({ kind: "join", day, ts: at(day, 8, 30) });
});
push({ kind: "opening", day: START, ts: at(START, 7, 30) });
push({ kind: "cash", day: START, ts: at(START, 8, 0), type: "masuk", amount: 2000000, note: "Modal awal laci kasir" });
events.sort((a, b) => a.ts.localeCompare(b.ts) || (a.kind === "sale") - (b.kind === "sale"));

// ── run ────────────────────────────────────────────
const log = { sales: [], voids: [], payments: [], moves: [], expenses: [], cash: [], web: [], employees: [] };
const later = [];   // queued follow-ups {ts, fn}
const queue = (ts, fn) => { later.push({ ts, fn }); later.sort((a, b) => a.ts.localeCompare(b.ts)); };
const stats = { sale: 0, kodian: 0, custom: 0, discount: 0, split: 0, tunai: 0, transfer: 0, bon: 0, bonFull: 0, bonPaidKasir: 0, bonPaidOwner: 0, swap: 0, swapVoid: 0, void: 0, toko: 0, web: 0, webDone: 0, webCancelBuyer: 0, webCancelShop: 0, webOpen: 0, webExpire: 0, webPickup: 0, resiFix: 0, ongkir: 0, restock: 0, opname: 0, failed: 0 };
const sold = [];    // recent sales eligible for a swap
const minute = (ts, n) => new Date(Date.parse(ts.replace(" ", "T")) + n * 60e3).toISOString().replace("T", " ");
const workTs = (day) => at(day, randint(10, 19), randint(0, 59));
const empPick = () => weighted(employees.filter((e) => e.active).map((e) => [e.id, e.weight]));
const fail = (what, e) => { stats.failed++; if (stats.failed < 25) console.error(`\n${what}: ${e.message}`); };

async function restock(p, ts, day) {
  const qty = randint(15, 35) * 10;
  const m = await api(O, "POST", "/api/stock/move", { product: p.id, type: "masuk", qty, note: pick(["Kiriman konveksi", "Ambil dari penjahit", "Kiriman supplier Pekalongan"]) });
  stock[p.id] += qty; stats.restock++;
  log.moves.push({ id: m.id, ts });
  const c = await api(O, "POST", "/api/collections/cash_entries/records", { date: day + " 00:00:00.000Z", type: "keluar", amount: qty * p.hpp, payment_method: TRANSFER, note: `Bayar stok ${p.name} ${qty} pcs` });
  log.cash.push({ id: c.id, ts });
}
async function ensureStock(cart, ts, day) {
  for (const pid of Object.keys(cart)) if (stock[pid] - cart[pid] < 25) await restock(P[pid], minute(ts, -2), day);
}

// Till money for a total: exact transfer, cash with change, or a split.
function payFor(total, kind) {
  if (kind === "transfer") return [{ method: TRANSFER, amount: total }];
  if (kind === "split") {
    const tr = Math.max(1000, round(total * (0.3 + rnd() * 0.4), 1000));
    const rest = total - tr;
    const cash = [1000, 10000, 50000].map((n) => Math.ceil(rest / n) * n).find(() => rnd() < 0.5) || rest;
    return [{ method: TRANSFER, amount: tr }, { method: TUNAI, amount: cash }];
  }
  const handed = [10000, 20000, 50000, 100000].map((n) => Math.ceil(total / n) * n).find(() => rnd() < 0.55) || total;
  return [{ method: TUNAI, amount: handed }];
}

async function doSale(ev) {
  const byOwner = rnd() < 0.12;
  const tok = byOwner ? O : K;
  const member = rnd() < 0.4 ? weighted(customers.map((c) => [c, c.weight])) : null;
  const bulk = (member?.reseller && rnd() < 0.55) || (!member && rnd() < 0.012);
  const cart = {}, custom = {};
  if (bulk) {
    for (let i = randint(1, 3); i > 0; i--) cart[pickProduct().id] = weighted([[20, 5], [40, 3], [25, 2], [60, 1]]);
  } else {
    for (let i = weighted([[1, 50], [2, 30], [3, 12], [4, 6], [5, 2]]); i > 0; i--) { const p = pickProduct(); cart[p.id] = (cart[p.id] || 0) + weighted([[1, 80], [2, 16], [3, 4]]); }
  }
  await ensureStock(cart, ev.ts, ev.day);
  if (byOwner && rnd() < 0.15) { const pid = pick(Object.keys(cart)); custom[pid] = Math.max(P[pid].hpp + 500, P[pid].price - randint(2, 6) * 1000); }
  const items = Object.entries(cart).map(([product, qty]) => (custom[product] ? { product, qty, price: custom[product] } : { product, qty }));
  const employee = byOwner ? (rnd() < 0.6 ? "toko" : empPick()) : (rnd() < 0.05 ? "toko" : empPick());
  const body = { items, customer: member?.id || "", employee };
  if (byOwner && rnd() < 0.05) body.discount = randint(1, 5) * 2000;
  const pv = await api(tok, "POST", "/api/pos/preview", body);
  const total = pv.total;

  const credit = member && (member.reseller ? rnd() < 0.25 : rnd() < 0.04);
  let payments, due = "";
  if (credit) {
    const dp = rnd() < 0.4 ? 0 : round(total * (0.2 + rnd() * 0.4), 1000);
    payments = dp ? [{ method: rnd() < 0.6 ? TUNAI : TRANSFER, amount: dp }] : [];
    due = addDays(ev.day, pick([7, 14, 14, 30]));
    stats.bon++; if (!dp) stats.bonFull++;
  } else {
    const kind = weighted([["tunai", 60], ["transfer", 32], ["split", 8]]);
    payments = payFor(total, kind); stats[kind]++;
  }
  const r = await api(tok, "POST", "/api/pos/checkout", { ...body, payments, credit: !!credit, due_date: due });
  for (const [pid, q] of Object.entries(cart)) stock[pid] -= q;
  log.sales.push({ id: r.sale.id, ts: ev.ts });
  stats.sale++;
  if (r.items.some((i) => i.tier === "kodian")) stats.kodian++;
  if (Object.keys(custom).length) stats.custom++;
  if (body.discount) stats.discount++;
  if (employee === "toko") stats.toko++;

  // A typo now and then: the owner voids it a few minutes later.
  if (rnd() < 0.004) {
    const vts = minute(ev.ts, randint(3, 20));
    await api(O, "POST", `/api/pos/void/${r.sale.id}`, { reason: pick(["Salah input qty", "Pembeli batal", "Salah pilih barang"]) });
    for (const [pid, q] of Object.entries(cart)) stock[pid] += q;
    log.voids.push({ id: r.sale.id, ts: vts }); stats.void++;
    return;
  }
  if (credit) {
    const rc = (await all(O, "receivables", `&filter=${encodeURIComponent(`sale="${r.sale.id}"`)}`))[0];
    const owed = rc.amount;
    const payDay = (n) => workTs(addDays(ev.day, n));
    if (rnd() < 0.1) return; // never paid: stays open (some long overdue)
    if (rnd() < 0.4) {
      const part = round(owed * (0.3 + rnd() * 0.3), 1000);
      queue(payDay(randint(4, 12)), () => payBon(rc.id, part, "Cicilan"));
      queue(payDay(randint(15, 45)), () => payBon(rc.id, owed - part, "Pelunasan"));
    } else queue(payDay(randint(3, 35)), () => payBon(rc.id, owed, "Pelunasan"));
  } else if (!bulk && rnd() < 0.014) {
    // The buyer comes back to swap (wrong size, colour, motif).
    queue(workTs(addDays(ev.day, randint(1, 7))), (ts) => doSwap(r.sale.id, cart, ts, wibDay(ts)));
  }
}

async function payBon(rc, amount, note) {
  const atKasir = rnd() < 0.75; // most bons are paid at the counter, on the shared kasir login
  const r = await api(atKasir ? K : O, "POST", "/api/receivables/pay", { receivable: rc, amount, payment_method: rnd() < 0.6 ? TUNAI : TRANSFER, note });
  atKasir ? stats.bonPaidKasir++ : stats.bonPaidOwner++;
  return r.payment;
}

async function doSwap(saleId, cart, ts, day) {
  const back = pick(Object.keys(cart));
  const q = Math.min(cart[back], randint(1, 2));
  const info = await api(K, "GET", `/api/pos/swap/${saleId}`);
  const line = info.items.find((x) => x.product === back);
  if (!line || line.left < q) return;
  // Something else worth at least as much.
  const choices = products.filter((p) => p.id !== back && p.price >= line.price);
  if (!choices.length) return;
  const np = pick(choices);
  await ensureStock({ [np.id]: q }, ts, day);
  const diff = np.price * q - line.price * q;
  const body = { sale: saleId, returns: [{ product: back, qty: q }], items: [{ product: np.id, qty: q }], employee: empPick(), payments: diff > 0 ? payFor(diff, rnd() < 0.7 ? "tunai" : "transfer") : [] };
  const r = await api(K, "POST", "/api/pos/swap", body);
  stock[back] += q; stock[np.id] -= q; stats.swap++;
  log.sales.push({ id: r.sale.id, ts });
  if (stats.swap % 25 === 0) { // the odd swap rung up wrong and cancelled
    await api(O, "POST", `/api/pos/void/${r.sale.id}`, { reason: "Tukar salah input" });
    stock[back] -= q; stock[np.id] += q; stats.swapVoid++;
    log.voids.push({ id: r.sale.id, ts: minute(ts, 5) });
  }
}

const nameFirst = ["Siti", "Nur", "Ani", "Dwi", "Lestari", "Wulan", "Fitri", "Indah", "Ratna", "Yuni", "Maya", "Desi", "Ayu", "Nisa", "Laila", "Hesti", "Novi", "Putri", "Dian", "Retno"];
const cities = ["Semarang", "Jakarta Selatan", "Bandung", "Surabaya", "Yogyakarta", "Tegal", "Batang", "Medan", "Makassar", "Denpasar", "Bekasi", "Depok"];
async function doWeb(ev) {
  const member = rnd() < 0.3 ? pick(customers.filter((c) => c.phone)) : null;
  const phone = member ? member.phone : "08" + randint(11, 99) + randint(10000000, 99999999);
  const cart = {};
  for (let i = weighted([[1, 60], [2, 30], [3, 10]]); i > 0; i--) { const p = pickProduct(); cart[p.id] = (cart[p.id] || 0) + weighted([[1, 85], [2, 12], [3, 3]]); }
  await ensureStock(cart, ev.ts, ev.day);
  const pickup = rnd() < 0.12;
  const province = pick(provinces);
  const weight = Object.entries(cart).reduce((a, [pid, q]) => a + (P[pid].weight || 250) * q, 0);
  let courier = "", service = "";
  if (!pickup) {
    const opts = (await api(null, "GET", `/api/store/shipping?province=${encodeURIComponent(province)}&weight=${weight}`)).options;
    const o = pick(opts); courier = o.courier; service = o.service;
  }
  const ip = `10.${randint(0, 255)}.${randint(0, 255)}.${randint(1, 254)}`;
  const body = {
    items: Object.entries(cart).map(([product, qty]) => ({ product, qty })), name: member ? member.name : `${pick(nameFirst)} ${pick(["A.", "S.", "R.", "W."])}`, phone,
    delivery: pickup ? "ambil" : "kirim", payment: "transfer", courier, service,
    address: pickup ? undefined : { province, city: pick(cities), district: "Kec. Contoh", postal: String(randint(10000, 99999)), street: `Jl. Simulasi No. ${randint(1, 200)}` },
  };
  const o = await api(null, "POST", "/api/store/orders", body, { "X-Forwarded-For": ip });
  for (const [pid, q] of Object.entries(cart)) stock[pid] -= q;
  const rec = (await all(O, "web_orders", `&filter=${encodeURIComponent(`number="${o.number}"`)}`))[0];
  const entry = { id: rec.id, created: ev.ts, steps: [ev.ts] }; // steps[i] = time of history[i]
  log.web.push(entry); stats.web++;
  const step = async (ts, action, b = {}) => { await api(O, "POST", `/api/store/admin/${rec.id}/${action}`, b); entry.steps.push(ts); };
  const last = ev.day >= addDays(END, -4);
  const fate = weighted([["done", 78], ["buyer", 9], ["expire", 6], ["shop", 4], ["open", last ? 30 : 0]]);
  if (fate === "buyer") {
    queue(minute(ev.ts, randint(10, 600)), async (ts) => { await api(null, "POST", `/api/store/orders/${o.number}/cancel?t=${o.token}`); entry.steps.push(ts); for (const [pid, q] of Object.entries(cart)) stock[pid] += q; stats.webCancelBuyer++; });
    return;
  }
  if (fate === "expire" || fate === "open") { entry.expire = fate === "expire"; fate === "expire" ? stats.webExpire++ : stats.webOpen++; return; }
  const t0 = minute(ev.ts, randint(30, 900));
  if (!pickup && rnd() < 0.1) queue(minute(t0, -10), async (ts) => { await step(ts, "shipping", { fee: rec.shipping + 5000 }); stats.ongkir++; });
  queue(t0, async (ts) => {
    await step(ts, "confirm");
    if (fate === "shop") { queue(minute(ts, randint(60, 600)), async (t2) => { await step(t2, "cancel", { reason: "Stok motif habis" }); for (const [pid, q] of Object.entries(cart)) stock[pid] += q; stats.webCancelShop++; }); return; }
    const t1 = minute(ts, randint(120, 1500));
    if (t1 > at(END, 21, 0)) return;
    queue(t1, async (t2) => {
      if (pickup) { await step(t2, "ready"); stats.webPickup++; }
      else {
        await step(t2, "ship", { resi: "SIM" + randint(1e8, 9e8) });
        if (rnd() < 0.05) { const t3 = minute(t2, 90); await step(t3, "resi", { resi: "SIMFIX" + randint(1e8, 9e8) }); stats.resiFix++; }
      }
      const t3 = minute(t2, randint(2, 5) * 1440);
      if (t3 < at(END, 21, 0)) queue(t3, async (t4) => { await step(t4, "complete"); stats.webDone++; });
    });
  });
}

async function runLater(upTo) {
  while (later.length && later[0].ts <= upTo) {
    const job = later.shift();
    try {
      const id = await job.fn(job.ts);
      if (typeof id === "string") log.payments.push({ id, ts: job.ts });
    } catch (e) { fail("follow-up", e); }
  }
}

let n = 0;
for (const ev of events) {
  await runLater(ev.ts);
  try {
    if (ev.kind === "sale") await doSale(ev);
    else if (ev.kind === "web") await doWeb(ev);
    else if (ev.kind === "expense") {
      const x = await api(O, "POST", "/api/collections/expenses/records", { date: ev.day + " 00:00:00.000Z", category: ev.category, amount: ev.amount, note: ev.note, payment_method: ["Gaji", "THR", "Belanja bahan", "Transport"].includes(ev.category) ? TUNAI : TRANSFER });
      log.expenses.push({ id: x.id, ts: ev.ts });
    } else if (ev.kind === "cash") {
      const c = await api(O, "POST", "/api/collections/cash_entries/records", { date: ev.day + " 00:00:00.000Z", type: ev.type, amount: ev.amount, payment_method: TUNAI, note: ev.note });
      log.cash.push({ id: c.id, ts: ev.ts });
    } else if (ev.kind === "opening") {
      for (const p of products) {
        const qty = (popularity[p.name] || 1) * 40 + 100;
        const m = await api(O, "POST", "/api/stock/move", { product: p.id, type: "masuk", qty, note: "stok awal (simulasi)" });
        stock[p.id] += qty; log.moves.push({ id: m.id, ts: ev.ts });
      }
    } else if (ev.kind === "opname") {
      for (const p of products) {
        const counted = Math.max(0, stock[p.id] - weighted([[0, 6], [1, 3], [2, 1]]));
        const m = await api(O, "POST", "/api/stock/move", { product: p.id, type: "opname", counted, note: "Stok opname akhir kuartal" }).catch(() => null);
        if (m) { stock[p.id] = counted; log.moves.push({ id: m.id, ts: ev.ts }); }
      }
      stats.opname++;
    } else if (ev.kind === "rusak") {
      const p = pickProduct();
      if (stock[p.id] > 30) { const m = await api(O, "POST", "/api/stock/move", { product: p.id, type: "keluar", qty: 1, note: "Rusak (jahitan lepas)" }); stock[p.id]--; log.moves.push({ id: m.id, ts: ev.ts }); }
    } else if (ev.kind === "leave") {
      const e = employees[employees.length - 1];
      await api(O, "PATCH", `/api/collections/employees/records/${e.id}`, { active: false }); e.active = false;
      log.employees.push({ id: e.id, ts: ev.ts, what: "keluar" });
    } else if (ev.kind === "join") {
      const e = await api(O, "POST", "/api/collections/employees/records", { name: "Karyawan Baru (simulasi)", phone: "", active: true });
      employees.push({ id: e.id, weight: 3, active: true });
      log.employees.push({ id: e.id, ts: ev.ts, what: "masuk" });
    }
  } catch (e) { fail(ev.kind, e); }
  if (++n % 200 === 0) process.stdout.write(`\r${ev.day}  ${stats.sale} penjualan, ${stats.web} pesanan online, ${stats.failed} gagal   `);
}
// Follow-ups due after the last simulated day never happened (still-open bons, orders in flight).
await runLater(at(END, 21, 0));
console.log("\n" + JSON.stringify(stats, null, 1));
writeFileSync(new URL("./sim-year-events.json", import.meta.url), JSON.stringify(log));

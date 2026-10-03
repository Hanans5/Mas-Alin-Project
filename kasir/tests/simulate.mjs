// Six months of simulated shop activity for demos — 5 Apr to 3 Oct 2026.
// Everything goes through the real routes (checkout, stock, piutang), so every
// number obeys the same rules as a real sale. The API stamps "now" on rows;
// tests/simulate-backdate.mjs then moves them to their simulated time.
//
//   PB=http://127.0.0.1:8090 SU_EMAIL=… SU_PASS=… OWNER_PASS=… node tests/simulate.mjs
// Writes tests/sim-events.json (row id → simulated time) for the backdate step.
import { writeFileSync } from "node:fs";

const PB = process.env.PB || "http://127.0.0.1:8090";
const WIB = 7 * 3600e3;
const START = "2026-04-05", END = "2026-10-03";

// Deterministic randomness, so a re-run produces the same shop.
let seed = 20260405;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rnd() * tot; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
const randint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

async function api(token, method, path, body) {
  const r = await fetch(PB + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${j.message} ${JSON.stringify(j.data || {})}`);
  return j;
}
const login = async (u, p) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: p })).token;
const all = async (t, coll, q = "") => (await api(t, "GET", `/api/collections/${coll}/records?perPage=500${q}`)).items;

// WIB wall time → PocketBase UTC string
const at = (day, h, m) => new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60e3 - WIB).toISOString().replace("T", " ");
const days = []; for (let d = START; d <= END; d = new Date(Date.parse(d + "T00:00:00Z") + 86400e3).toISOString().slice(0, 10)) days.push(d);

const su = (await api(null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.SU_EMAIL, password: process.env.SU_PASS })).token;
const O = await login("alin", process.env.OWNER_PASS);
const simPass = "sim-" + Math.random().toString(36).slice(2, 12);

// ── people ─────────────────────────────────────────
async function ensureUser(username, role, name, phone) {
  const found = (await all(su, "users", `&filter=${encodeURIComponent(`username="${username}"`)}`))[0];
  if (found) {
    await api(su, "PATCH", `/api/collections/users/records/${found.id}`, { disabled: false, password: simPass, passwordConfirm: simPass });
    return found.id;
  }
  return (await api(su, "POST", "/api/collections/users/records", { username, role, name, phone, password: simPass, passwordConfirm: simPass })).id;
}
const kasirNames = [["dewi", "Dewi Kasir"], ["rina", "Rina Kasir"]];
for (const [u, n] of kasirNames) await ensureUser(u, "kasir", n, "");
const kasirTok = {}; for (const [u] of kasirNames) kasirTok[u] = await login(u, simPass);

const first = ["Siti", "Nur", "Ani", "Dwi", "Rina", "Lestari", "Wulan", "Fitri", "Indah", "Ratna", "Yuni", "Sri", "Endang", "Maya", "Tika", "Desi", "Eka", "Ayu", "Nisa", "Rizka", "Laila", "Umi", "Hesti", "Novi", "Kartika", "Putri", "Dian", "Retno", "Wati", "Asih", "Bu Haji Romlah", "Bu Tutik", "Mbak Lina", "Pak Darto", "Bu Sumi", "Mas Fajar", "Bu Yati", "Mbak Ika", "Bu Nanik", "Toko Barokah"];
const last = ["Rahayu", "Aminah", "Susanti", "Hidayah", "Kusuma", "Wardani", "Pratiwi", "Handayani", "Safitri", "Anggraini", "Marlina", "Nurhayati"];
const members = [];
for (let i = 0; i < first.length; i++) {
  const name = first[i].startsWith("Bu ") || first[i].startsWith("Pak ") || first[i].startsWith("Mas ") || first[i].startsWith("Mbak ") || first[i].startsWith("Toko ") ? first[i] : `${first[i]} ${pick(last)}`;
  const username = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 28) + (i % 7 === 0 ? i : "");
  const phone = "08" + String(randint(11, 99)) + String(randint(10000000, 99999999));
  const id = await ensureUser(username, "pelanggan", name, phone);
  // Resellers buy in bulk; the rest are regulars of varying loyalty.
  members.push({ id, name, reseller: /^Toko|Bu Haji/.test(name), weight: 0.3 + rnd() * 2, joined: days[Math.floor(rnd() * rnd() * days.length)] });
}

// ── catalogue ──────────────────────────────────────
const methods = await all(O, "payment_methods");
const mId = (n) => methods.find((m) => m.name === n).id;
const products = (await all(O, "products", `&filter=${encodeURIComponent("active=true")}`)).map((p) => p);
// Best sellers sell more: Tunik List and Blouse List are the shop's staples.
const popularity = { "Tunik List": 9, "Blouse List": 8, "Blouse Slempang": 6, "Tunik Kerah TM": 5, "Tunik Bolero TM": 4, "Tunik Kancing TM": 4, "Tunik Ayam TM": 3, "Tunik Ziper Emas TM": 3, "Tunik Floy TM": 2, "Tunik Tamiya TM": 2 };
const stock = Object.fromEntries(products.map((p) => [p.id, p.stock]));

// ── vouchers (valid during the run, real end dates set by the backdate step) ──
const vouchers = [
  { code: "BUKATOKO", kind: "nominal", value: 10000, min_purchase: 100000, quota: 50, from: "2026-04-05", to: "2026-04-19" },
  { code: "IDULADHA", kind: "persen", value: 10, max_discount: 25000, min_purchase: 150000, quota: 0, from: "2026-05-20", to: "2026-05-31" },
  { code: "MERDEKA17", kind: "persen", value: 17, max_discount: 30000, min_purchase: 100000, quota: 170, from: "2026-08-10", to: "2026-08-20" },
  { code: "GAJIAN", kind: "nominal", value: 5000, min_purchase: 75000, quota: 0, from: "2026-04-25", to: "2026-10-31" },
];
for (const v of vouchers) {
  const ex = (await all(O, "vouchers", `&filter=${encodeURIComponent(`code="${v.code}"`)}`))[0];
  const body = { code: v.code, kind: v.kind, value: v.value, max_discount: v.max_discount || 0, min_purchase: v.min_purchase, quota: v.quota, valid_until: "2030-01-01 00:00:00.000Z", active: true };
  v.id = ex ? (await api(O, "PATCH", `/api/collections/vouchers/records/${ex.id}`, body)).id : (await api(O, "POST", "/api/collections/vouchers/records", body)).id;
}

// ── build the event timeline ───────────────────────
const events = [];
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay(); // 0 Sun … 6 Sat
days.forEach((day, i) => {
  const dom = +day.slice(8);
  let n = 16;
  if (dow(day) === 6 || dow(day) === 0) n *= 1.6;          // weekends busy
  if (dom >= 25 || dom <= 3) n *= 1.25;                     // payday
  if (day >= "2026-05-22" && day <= "2026-05-27") n *= 1.4; // before Idul Adha
  if (day >= "2026-08-12" && day <= "2026-08-18") n *= 1.35; // Agustusan
  if (day >= "2026-07-13" && day <= "2026-07-18") n *= 1.2; // new school year
  n *= 0.8 + 0.4 * (i / days.length);                       // the shop grows
  n *= 0.8 + rnd() * 0.4;
  if (day === "2026-06-14") n = 0;                          // closed: family event
  const count = Math.round(n);
  const times = Array.from({ length: count }, () => randint(9 * 60, 20 * 60 + 45)).sort((a, b) => a - b);
  for (const t of times) events.push({ kind: "sale", day, ts: at(day, Math.floor(t / 60), t % 60) });
  // Fixed monthly costs, paid on set days.
  const exp = (category, amount, note, h = 10) => events.push({ kind: "expense", day, ts: at(day, h, 0), category, amount, note });
  if (dom === 1) { exp("Gaji", 2400000, "Gaji Dewi"); exp("Gaji", 2400000, "Gaji Rina"); exp("Sewa", 2500000, "Sewa kios bulan " + day.slice(0, 7)); }
  if (dom === 5) exp("Listrik", randint(52, 78) * 10000, "Token PLN");
  if (dom === 7) exp("Internet", 350000, "Indihome");
  if (dom === 20) exp("Air", randint(9, 15) * 10000, "PDAM");
  if (dow(day) === 1) exp("Belanja bahan", randint(10, 22) * 10000, "Plastik, kantong, label harga", 9);
  if (rnd() < 0.08) exp("Transport", randint(3, 12) * 10000, "Ongkir ambil barang", 15);
  if (rnd() < 0.03) exp("Perawatan", randint(10, 40) * 10000, pick(["Servis AC", "Ganti lampu", "Perbaikan rak", "Cat ulang etalase"]), 11);
  // No bank deposits here: Buku Kas is one book across Tunai/QRIS/Transfer, so
  // moving drawer cash to the bank is not money leaving the business.
});
events.push({ kind: "cash", day: START, ts: at(START, 8, 30), type: "masuk", amount: 2000000, note: "Modal awal laci kasir" });
events.sort((a, b) => a.ts.localeCompare(b.ts));

// ── run it ─────────────────────────────────────────
const log = { sales: [], payments: [], moves: [], expenses: [], cash: [], vouchers: vouchers.map((v) => ({ id: v.id, from: v.from, to: v.to })) };
const pendingDebts = []; // {receivable, amount, payDay}
let cashSinceDeposit = 0, done = 0, failed = 0;

async function restock(p, day, ts) {
  const qty = randint(20, 40) * 10;
  const m = await api(O, "POST", "/api/stock/move", { product: p.id, type: "masuk", qty, note: pick(["Kiriman konveksi", "Ambil dari penjahit", "Kiriman supplier Pekalongan"]) });
  stock[p.id] += qty;
  log.moves.push({ id: m.id, ts });
  // Paying the supplier is cash out but not an expense (it's HPP when sold).
  const c = await api(O, "POST", "/api/collections/cash_entries/records", { date: day + " 00:00:00.000Z", type: "keluar", amount: qty * p.hpp, payment_method: mId("Transfer"), note: `Bayar stok ${p.name} ${qty} pcs` });
  log.cash.push({ id: c.id, ts });
}

for (const ev of events) {
  // Debts that come due are paid before the day's business.
  while (pendingDebts.length && pendingDebts[0].payTs <= ev.ts) {
    const d = pendingDebts.shift();
    try {
      const r = await api(O, "POST", "/api/receivables/pay", { receivable: d.receivable, amount: d.amount, payment_method: mId(rnd() < 0.6 ? "Tunai" : "Transfer"), note: d.partial ? "Cicilan" : "Pelunasan" });
      log.payments.push({ id: r.payment, ts: d.payTs });
    } catch (e) { failed++; }
  }
  if (ev.kind === "expense") {
    const x = await api(O, "POST", "/api/collections/expenses/records", { date: ev.day + " 00:00:00.000Z", category: ev.category, amount: ev.amount, note: ev.note, payment_method: mId(ev.category === "Gaji" || ev.category === "Belanja bahan" || ev.category === "Transport" ? "Tunai" : "Transfer") });
    log.expenses.push({ id: x.id, ts: ev.ts });
    continue;
  }
  if (ev.kind === "cash") {
    const amount = ev.amountFn ? Math.floor(cashSinceDeposit * 0.8 / 100000) * 100000 : ev.amount;
    if (amount <= 0) continue;
    if (ev.amountFn) cashSinceDeposit = 0;
    const c = await api(O, "POST", "/api/collections/cash_entries/records", { date: ev.day + " 00:00:00.000Z", type: ev.type, amount, payment_method: mId("Tunai"), note: ev.note });
    log.cash.push({ id: c.id, ts: ev.ts });
    continue;
  }

  // ── a sale ──
  const eligible = members.filter((m) => m.joined <= ev.day);
  const member = rnd() < 0.42 && eligible.length ? weighted(eligible.map((m) => [m, m.weight])) : null;
  const reseller = member?.reseller && rnd() < 0.5;
  const lineCount = reseller ? randint(2, 4) : weighted([[1, 50], [2, 30], [3, 12], [4, 6], [5, 2]]);
  const cart = {};
  for (let i = 0; i < lineCount; i++) {
    const p = weighted(products.map((p) => [p, popularity[p.name] || 1]));
    cart[p.id] = (cart[p.id] || 0) + (reseller ? randint(4, 10) : weighted([[1, 80], [2, 16], [3, 4]]));
  }
  const justBefore = new Date(Date.parse(ev.ts.replace(" ", "T")) - 60e3).toISOString().replace("T", " ");
  for (const pid of Object.keys(cart)) if (stock[pid] - cart[pid] < 15) await restock(products.find((p) => p.id === pid), ev.day, justBefore);
  const items = Object.entries(cart).map(([product, qty]) => ({ product, qty }));
  const subtotal = items.reduce((a, it) => a + products.find((p) => p.id === it.product).price * it.qty, 0);

  const live = vouchers.filter((v) => ev.day >= v.from && ev.day <= v.to && subtotal >= v.min_purchase);
  const voucher = live.length && rnd() < (live[0].code === "GAJIAN" ? 0.15 : 0.45) ? pick(live) : null;
  const usePoints = member && rnd() < 0.18 ? -1 : 0;
  const credit = member && !reseller ? rnd() < 0.035 : member && rnd() < 0.25;
  const method = weighted([["Tunai", 55], ["QRIS", 35], ["Transfer", 10]]);
  const kasir = (+ev.ts.slice(11, 13) + 7) % 24 < 15 ? "dewi" : "rina"; // shift change at 15:00 WIB

  const body = { items, customer: member?.id || "", voucher_code: voucher?.code || "", payment_method: mId(method) };
  try {
    if (usePoints) {
      const me = await api(O, "GET", `/api/collections/users/records/${member.id}`);
      if (me.points >= 20) body.points_used = Math.min(me.points, randint(20, 80));
    }
    let pv;
    try { pv = await api(kasirTok[kasir], "POST", "/api/pos/preview", body); }
    catch (e) { if (!body.voucher_code) throw e; body.voucher_code = ""; pv = await api(kasirTok[kasir], "POST", "/api/pos/preview", body); }
    let paid = pv.total;
    if (credit) paid = Math.floor(pv.total * (rnd() < 0.5 ? 0 : 0.3 + rnd() * 0.4) / 1000) * 1000;
    else if (method === "Tunai") paid = [10000, 20000, 50000, 100000].map((n) => Math.ceil(pv.total / n) * n).find((v) => rnd() < 0.55) || pv.total;
    const r = await api(kasirTok[kasir], "POST", "/api/pos/checkout", { ...body, paid, credit, due_date: credit ? new Date(Date.parse(ev.day + "T00:00:00Z") + 14 * 86400e3).toISOString().slice(0, 10) : "" });
    for (const it of items) stock[it.product] -= it.qty;
    if (method === "Tunai") cashSinceDeposit += r.sale.paid;
    log.sales.push({ id: r.sale.id, ts: ev.ts });
    if (credit) {
      const rc = (await all(O, "receivables", `&filter=${encodeURIComponent(`sale="${r.sale.id}"`)}`))[0];
      const owed = rc.amount;
      // Most pay within 1–3 weeks, some in two instalments; a few are still open.
      const lateDay = (n) => new Date(Date.parse(ev.day + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
      if (rnd() < 0.35) {
        const half = Math.floor(owed / 2 / 1000) * 1000;
        pendingDebts.push({ receivable: rc.id, amount: half, payTs: at(lateDay(randint(5, 10)), randint(10, 19), randint(0, 59)), partial: true });
        pendingDebts.push({ receivable: rc.id, amount: owed - half, payTs: at(lateDay(randint(14, 30)), randint(10, 19), randint(0, 59)) });
      } else {
        pendingDebts.push({ receivable: rc.id, amount: owed, payTs: at(lateDay(randint(3, 24)), randint(10, 19), randint(0, 59)) });
      }
      pendingDebts.sort((a, b) => a.payTs.localeCompare(b.payTs));
    }
    done++;
  } catch (e) {
    failed++;
    if (failed < 10) console.error("sale failed:", e.message);
  }
  if (done % 250 === 0) process.stdout.write(`\r${ev.day}  ${done} transaksi`);
}
// Payments due after the last simulated day stay open — that's the live piutang.
console.log(`\nselesai: ${done} transaksi, ${log.payments.length} pembayaran piutang, ${log.moves.length} restok, ${log.expenses.length} pengeluaran, ${failed} gagal, ${pendingDebts.length} cicilan masih terbuka`);
writeFileSync(new URL("./sim-events.json", import.meta.url), JSON.stringify(log));

// Lock the simulated logins again — the site is public.
for (const u of ["dewi", "rina", ...members.map((m) => m.id)]) {
  const id = u.length === 15 ? u : (await all(su, "users", `&filter=${encodeURIComponent(`username="${u}"`)}`))[0]?.id;
  if (id) await api(su, "PATCH", `/api/collections/users/records/${id}`, { disabled: true });
}

// Step 2 of the one-year simulation (tests/simulate-year.mjs): move every row
// it created to its simulated time and renumber sales (TRX-YYMMDD-NNNN) and
// web orders (WEB-YYMMDD-NNN) per WIB day, fixing every reference to the old
// numbers (stock_moves.ref, sale and stock notes). One SQLite transaction.
//   DB=<sandbox>/pb_data/data.db node tests/simulate-year-backdate.mjs
// Unpaid orders left to expire get a past deadline; the real cron (every 5
// min) then expires them and returns their stock "now". Afterwards run
//   DB=… node tests/simulate-year-backdate.mjs --expired
// to move those rows to each order's deadline.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const path = process.env.DB;
if (!path || /nelin-batik\/pb_data/.test(path)) throw new Error("Set DB to the SANDBOX data.db (never the live one).");
const log = JSON.parse(readFileSync(new URL("./sim-year-events.json", import.meta.url), "utf8"));
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 15000");
if (process.argv.includes("--expired")) {
  db.exec(`BEGIN IMMEDIATE;
    UPDATE stock_moves SET created = (SELECT w.expires_at FROM web_orders w WHERE w.number = stock_moves.ref),
                           updated = (SELECT w.expires_at FROM web_orders w WHERE w.number = stock_moves.ref)
     WHERE type = 'batal_pesanan' AND note LIKE 'Kedaluwarsa%';
    UPDATE web_orders SET updated = expires_at, history = json_set(history, '$[#-1].at', replace(expires_at, ' ', 'T'))
     WHERE status = 'kedaluwarsa';
    COMMIT;`);
  console.log("expired orders backdated:", db.prepare("SELECT COUNT(*) AS n FROM web_orders WHERE status = 'kedaluwarsa'").get().n);
  process.exit(0);
}
const WIB = 7 * 3600e3;
const wibDay = (ts) => new Date(Date.parse(ts.replace(" ", "T")) + WIB).toISOString().slice(0, 10);
const plus = (ts, ms) => new Date(Date.parse(ts.replace(" ", "T")) + ms).toISOString().replace("T", " ");
const iso = (ts) => ts.replace(" ", "T");

db.exec("BEGIN IMMEDIATE");
try {
  const saleTs = new Map(log.sales.map((x) => [x.id, x.ts]));
  const voidTs = new Map(log.voids.map((x) => [x.id, x.ts]));

  // ── web orders: history times, created, expiry; their sale gets the confirm time
  const webRows = new Map(db.prepare("SELECT id, number, status, history, sale FROM web_orders").all().map((r) => [r.id, r]));
  const webCancelTs = new Map(); // web number → time stock came back
  const setWeb = db.prepare("UPDATE web_orders SET created = ?, updated = ?, expires_at = ?, history = ? WHERE id = ?");
  const nowPlus = new Date(Date.now() + 20 * 3600e3).toISOString().replace("T", " ");
  let warn = 0;
  for (const w of log.web) {
    const r = webRows.get(w.id);
    if (!r) { warn++; continue; }
    const h = JSON.parse(r.history || "[]");
    if (h.length !== w.steps.length) { warn++; console.warn(`history/steps mismatch on ${r.number}: ${h.length} vs ${w.steps.length}`); }
    h.forEach((x, i) => { if (w.steps[i]) x.at = iso(w.steps[i]); });
    const confirm = h.findIndex((x) => x.status === "diproses");
    if (r.sale && confirm >= 0) saleTs.set(r.sale, w.steps[confirm]);
    const cancel = h.findIndex((x) => x.status === "batal");
    if (cancel >= 0) { webCancelTs.set(r.number, w.steps[cancel]); if (r.sale) voidTs.set(r.sale, w.steps[cancel]); }
    // Left to expire → already past its deadline (the cron picks it up); still open → a fresh deadline.
    const expires = r.status === "menunggu_bayar" && !w.expire ? nowPlus : plus(w.created, 24 * 3600e3);
    setWeb.run(w.created, w.steps[w.steps.length - 1], expires, JSON.stringify(h), w.id);
  }

  // ── sales: time, then renumber in time order per WIB day
  const setSale = db.prepare("UPDATE sales SET created = ?, updated = ? WHERE id = ?");
  for (const [id, ts] of saleTs) setSale.run(ts, voidTs.get(id) || ts, id);
  const rename = new Map(); // old number → new number
  const renumber = (table, prefix, pad, ids) => {
    const rows = db.prepare(`SELECT id, number, created FROM ${table} ORDER BY created, number`).all().filter((r) => ids.has(r.id));
    const tmp = db.prepare(`UPDATE ${table} SET number = ? WHERE id = ?`);
    for (const r of rows) tmp.run("TMP-" + r.id, r.id);
    const perDay = {};
    for (const r of rows) {
      const d = wibDay(r.created);
      perDay[d] = (perDay[d] || 0) + 1;
      const num = `${prefix}-${d.slice(2).replace(/-/g, "")}-${String(perDay[d]).padStart(pad, "0")}`;
      tmp.run(num, r.id);
      rename.set(r.number, num);
    }
    return Object.keys(perDay).length;
  };
  const saleDays = renumber("sales", "TRX", 4, new Set(saleTs.keys()));
  const webCreated = new Map(log.web.map((w) => [w.id, w.created]));
  const setWebCreated = db.prepare("UPDATE web_orders SET created = ? WHERE id = ?");
  for (const [id, ts] of webCreated) setWebCreated.run(ts, id);
  renumber("web_orders", "WEB", 3, new Set(webCreated.keys()));
  const fix = (s) => (s ? s.replace(/\b(TRX-\d{6}-\d{4}|WEB-\d{6}-\d{3})\b/g, (m) => rename.get(m) || m) : s);

  // ── rows that belong to a sale
  for (const t of ["sale_items", "sale_payments"]) {
    const st = db.prepare(`UPDATE ${t} SET created = ?, updated = ? WHERE sale = ?`);
    for (const [id, ts] of saleTs) st.run(ts, ts, id);
  }
  const rcv = db.prepare("UPDATE receivables SET created = ? WHERE sale = ?");
  for (const [id, ts] of saleTs) rcv.run(ts, id);
  const sn = db.prepare("UPDATE sales SET note = ? WHERE id = ?");
  for (const r of db.prepare("SELECT id, note FROM sales WHERE note != ''").all()) { const n = fix(r.note); if (n !== r.note) sn.run(n, r.id); }

  // ── stock moves: explicit ones from the log, the rest follow their sale / order
  const setMove = db.prepare("UPDATE stock_moves SET created = ?, updated = ? WHERE id = ?");
  for (const x of log.moves) setMove.run(x.ts, x.ts, x.id);
  const byNumber = new Map(db.prepare("SELECT id, number FROM sales").all().map((r) => [r.number, r.id])); // new numbers now
  const webByNumber = new Map(log.web.map((w) => [w.id, w]));
  const webIdOf = new Map(db.prepare("SELECT id, number FROM web_orders").all().map((r) => [r.number, r.id]));
  const oldOf = new Map([...rename].map(([o, n]) => [n, o]));
  const mv = db.prepare("UPDATE stock_moves SET ref = ?, note = ?, created = ?, updated = ? WHERE id = ?");
  let moved = 0;
  for (const m of db.prepare("SELECT id, type, ref, note FROM stock_moves WHERE ref != ''").all()) {
    const ref = fix(m.ref), note = fix(m.note);
    let ts = null;
    if (ref.startsWith("TRX-")) {
      const sid = byNumber.get(ref);
      ts = m.type === "batal" ? voidTs.get(sid) : saleTs.get(sid);
    } else if (ref.startsWith("WEB-")) {
      const w = webByNumber.get(webIdOf.get(ref));
      const oldNumber = oldOf.get(ref);
      ts = m.type === "pesanan" ? w?.created : webCancelTs.get(oldNumber);
    }
    if (ts) { mv.run(ref, note, ts, ts, m.id); moved++; } else if (ref !== m.ref || note !== m.note) mv.run(ref, note, null, null, m.id);
  }
  // A null timestamp would be a bug — make sure none slipped through.
  db.prepare("UPDATE stock_moves SET created = updated WHERE created IS NULL").run();

  // ── money and staff rows
  const simple = (table, list) => { const st = db.prepare(`UPDATE ${table} SET created = ?, updated = ? WHERE id = ?`); for (const x of list) st.run(x.ts, x.ts, x.id); };
  simple("receivable_payments", log.payments);
  simple("expenses", log.expenses);
  simple("cash_entries", log.cash);
  for (const e of log.employees) db.prepare(`UPDATE employees SET ${e.what === "masuk" ? "created = ?, updated = ?" : "updated = ?"} WHERE id = ?`).run(...(e.what === "masuk" ? [e.ts, e.ts] : [e.ts]), e.id);

  db.exec("COMMIT");
  console.log(`backdated ${saleTs.size} sales over ${saleDays} days, ${log.web.length} web orders, ${moved} sale/order stock moves, ${log.moves.length} manual moves, ${log.payments.length} bon payments, ${log.expenses.length} expenses, ${log.cash.length} cash entries${warn ? `, ${warn} warnings` : ""}`);
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

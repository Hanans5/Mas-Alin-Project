// Step 2 of the demo simulation: move every row tests/simulate.mjs created to
// its simulated time, and renumber those sales per WIB day (TRX-260405-0001…).
// One SQLite transaction; touches only rows listed in tests/sim-events.json.
//   node tests/simulate-backdate.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const log = JSON.parse(readFileSync(new URL("./sim-events.json", import.meta.url), "utf8"));
const db = new DatabaseSync(new URL("../pb_data/data.db", import.meta.url).pathname);
db.exec("PRAGMA busy_timeout = 10000");
const WIB = 7 * 3600e3;
const wibDay = (ts) => new Date(Date.parse(ts.replace(" ", "T")) + WIB).toISOString().slice(0, 10);

db.exec("BEGIN IMMEDIATE");
try {
  const setTs = (table) => db.prepare(`UPDATE ${table} SET created = ?, updated = ? WHERE id = ?`);
  // Sales: time first, then renumber in time order.
  const s = setTs("sales");
  for (const x of log.sales) s.run(x.ts, x.ts, x.id);
  const ids = new Set(log.sales.map((x) => x.id));
  const rows = db.prepare("SELECT id, number, created FROM sales ORDER BY created, number").all().filter((r) => ids.has(r.id));
  const tmp = db.prepare("UPDATE sales SET number = ? WHERE id = ?");
  for (const r of rows) tmp.run("TMP-" + r.id, r.id); // dodge the unique index while shuffling
  const fin = db.prepare("UPDATE sales SET number = ? WHERE id = ?");
  const refs = db.prepare("UPDATE stock_moves SET ref = ?, created = ?, updated = ? WHERE ref = ? AND type = 'penjualan'");
  const items = db.prepare("UPDATE sale_items SET created = ?, updated = ? WHERE sale = ?");
  const recv = db.prepare("UPDATE receivables SET created = ? WHERE sale = ?");
  // Days that already have real/test sales continue after their highest number.
  const perDay = {};
  for (const r of db.prepare("SELECT number FROM sales WHERE number LIKE 'TRX-%'").all()) {
    if (ids.has(r.id)) continue;
    const [, ymd, n] = r.number.split("-");
    const d = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
    perDay[d] = Math.max(perDay[d] || 0, parseInt(n, 10));
  }
  for (const r of rows) {
    const d = wibDay(r.created);
    perDay[d] = (perDay[d] || 0) + 1;
    const num = `TRX-${d.slice(2).replace(/-/g, "")}-${String(perDay[d]).padStart(4, "0")}`;
    fin.run(num, r.id);
    refs.run(num, r.created, r.created, r.number);
    items.run(r.created, r.created, r.id);
    recv.run(r.created, r.id);
  }

  const p = setTs("receivable_payments"); for (const x of log.payments) p.run(x.ts, x.ts, x.id);
  const m = setTs("stock_moves"); for (const x of log.moves) m.run(x.ts, x.ts, x.id);
  const e = setTs("expenses"); for (const x of log.expenses) e.run(x.ts, x.ts, x.id);
  const c = setTs("cash_entries"); for (const x of log.cash) c.run(x.ts, x.ts, x.id);

  // Vouchers get their real campaign window back.
  const v = db.prepare("UPDATE vouchers SET created = ?, valid_until = ? WHERE id = ?");
  for (const x of log.vouchers) {
    const start = new Date(Date.parse(x.from + "T00:00:00Z") - WIB).toISOString().replace("T", " ");
    const end = new Date(Date.parse(x.to + "T23:59:59Z") - WIB).toISOString().replace("T", " ");
    v.run(start, end, x.id);
  }

  // The demo catalogue "existed" since opening day.
  const opening = "2026-04-04 01:00:00.000Z"; // 08:00 WIB, the day before the first sale
  db.prepare("UPDATE stock_moves SET created = ?, updated = ? WHERE note = 'stok awal (demo)'").run(opening, opening);
  db.prepare("UPDATE products SET created = ? WHERE created > ? AND sku LIKE '___-___-00__'").run(opening, opening);
  db.prepare("UPDATE categories SET created = ? WHERE name IN ('TUNIK','BLOUSE')").run(opening);

  db.exec("COMMIT");
  console.log(`backdated ${rows.length} sales over ${Object.keys(perDay).length} days, ${log.payments.length} payments, ${log.moves.length} restocks, ${log.expenses.length} expenses, ${log.cash.length} cash entries`);
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

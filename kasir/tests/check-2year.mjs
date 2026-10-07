// Two-year copy of check-year.mjs (7 Oct 2024 – 6 Oct 2026, tests/simulate-2year.mjs).
// Checks a sandbox that holds the simulated data: the database's own
// invariants (stock, money, bons, kodian, swaps, web orders, numbering) and
// that every report agrees with every other over a year, month by month.
//   PB=http://127.0.0.1:8099 DB=<sandbox>/pb_data/data.db OWNER_PASS=… KASIR_PASS=… node tests/check-year.mjs
import { DatabaseSync } from "node:sqlite";

const PB = process.env.PB || "http://127.0.0.1:8099";
const db = new DatabaseSync(process.env.DB, { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0];
let pass = 0, failN = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : failN++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? "  → " + detail : ""}`); };
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const api = async (t, path) => { const t0 = performance.now(); const r = await fetch(PB + path, { headers: { Authorization: t } }); const j = await r.json(); return { ok: r.ok, status: r.status, j, ms: performance.now() - t0, bytes: JSON.stringify(j).length }; };
const login = async (u, p) => (await (await fetch(PB + "/api/collections/users/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: u, password: p }) })).json()).token;
const WIB = 7 * 3600e3;
const wibDay = (ts) => new Date(Date.parse(ts.replace(" ", "T")) + WIB).toISOString().slice(0, 10);
const FROM = "2024-10-07", TO = "2026-10-06";

console.log("── database invariants");
const badStock = q(`SELECT p.name, p.stock, COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.product = p.id),0) AS ledger FROM products p WHERE p.stock != COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.product = p.id),0)`);
check("stock = sum of the stock ledger, every product", !badStock.length, JSON.stringify(badStock));
check("no negative stock", one("SELECT COUNT(*) FROM products WHERE stock < 0") === 0);
const badTotal = one(`SELECT COUNT(*) FROM sales s WHERE s.total != s.subtotal - s.discount OR s.subtotal != COALESCE((SELECT SUM(subtotal) FROM sale_items WHERE sale = s.id),0)`);
check("total = subtotal − discount = Σ item lines", badTotal === 0, badTotal + " sales");
const badPaid = q(`SELECT s.number, s.paid, (SELECT SUM(amount) FROM sale_payments WHERE sale = s.id) AS rows FROM sales s
  WHERE s.paid != COALESCE((SELECT SUM(amount) FROM sale_payments WHERE sale = s.id),0)`);
check("sales.paid = Σ sale_payments (cash net of change)", !badPaid.length, JSON.stringify(badPaid.slice(0, 3)));
const badLunas = one(`SELECT COUNT(*) FROM sales s WHERE s.status = 'lunas' AND s.kind = 'jual' AND NOT EXISTS (SELECT 1 FROM receivables WHERE sale = s.id) AND s.paid != s.total`);
check("every non-bon sale is paid exactly its total", badLunas === 0, badLunas + " sales");
check("change only from cash (no change on transfer-only sales)", one(`SELECT COUNT(*) FROM sales s WHERE s.change > 0 AND NOT EXISTS (SELECT 1 FROM sale_payments sp JOIN payment_methods m ON m.id = sp.payment_method WHERE sp.sale = s.id AND m.is_cash = 1)`) === 0);
check("only Tunai and Transfer used", one(`SELECT COUNT(*) FROM sale_payments sp JOIN payment_methods m ON m.id = sp.payment_method WHERE m.name NOT IN ('Tunai','Transfer')`) === 0);
const badRc = q(`SELECT s.number, rc.amount, s.total, s.paid FROM receivables rc JOIN sales s ON s.id = rc.sale WHERE rc.amount != s.total - s.paid`);
check("bon amount = total − DP", !badRc.length, JSON.stringify(badRc.slice(0, 3)));
const badRcPaid = one(`SELECT COUNT(*) FROM receivables rc WHERE rc.paid != COALESCE((SELECT SUM(amount) FROM receivable_payments WHERE receivable = rc.id),0)`);
check("bon paid = Σ its payments", badRcPaid === 0, badRcPaid + " bons");
check("bon status lunas ⇔ fully paid", one(`SELECT COUNT(*) FROM receivables WHERE status != 'batal' AND ((status = 'lunas') != (paid >= amount))`) === 0);
check("sale status follows its bon", one(`SELECT COUNT(*) FROM receivables rc JOIN sales s ON s.id = rc.sale WHERE (rc.status = 'lunas' AND s.status != 'lunas') OR (rc.status = 'belum' AND s.status != 'piutang') OR (rc.status = 'batal' AND s.status != 'batal')`) === 0);
check("no bon is overpaid", one("SELECT COUNT(*) FROM receivables WHERE paid > amount") === 0);
check("every bon has a pelanggan", one("SELECT COUNT(*) FROM receivables WHERE customer = ''") === 0);
const badKodi = one(`SELECT COUNT(*) FROM sale_items i JOIN products p ON p.id = i.product WHERE i.tier = 'kodian' AND i.price != p.price_kodi`);
check("kodian lines are at the product's kodian price", badKodi === 0, badKodi + " lines");
// Since 2026-10-07 the owner's "Harga kodian" puts a whole line at the kodian price, even under 20 pcs.
const offKodi = q(`SELECT i.sale, i.product, u.role, (SELECT COUNT(*) FROM sale_items j WHERE j.sale = i.sale AND j.product = i.product AND j.tier = 'normal') AS normals
  FROM sale_items i JOIN sales s ON s.id = i.sale LEFT JOIN users u ON u.id = s.cashier WHERE i.tier = 'kodian' AND i.qty % 20 != 0`);
check(`kodian under 20 pcs / broken kodi only as the owner's whole-line "Harga kodian" (${offKodi.length} lines)`, offKodi.every((r) => r.role === "owner" && r.normals === 0), JSON.stringify(offKodi.filter((r) => r.role !== "owner" || r.normals).slice(0, 3)));
check("normal-price remainder below 20 pcs when kodian applies", one(`SELECT COUNT(*) FROM sale_items i JOIN products p ON p.id = i.product WHERE i.tier = 'normal' AND i.qty >= 20 AND p.price_kodi > 0`) === 0);
check("custom prices only rung up by the owner", one(`SELECT COUNT(*) FROM sale_items i JOIN sales s ON s.id = i.sale JOIN users u ON u.id = s.cashier WHERE i.tier = 'kustom' AND u.role != 'owner'`) === 0);
check("discounts only by owner/admin", one(`SELECT COUNT(*) FROM sales s JOIN users u ON u.id = s.cashier WHERE s.discount > 0 AND u.role NOT IN ('owner','admin')`) === 0);
check("every karyawan on a sale exists", one(`SELECT COUNT(*) FROM sales s WHERE s.employee != '' AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = s.employee)`) === 0);
check("no sale by an inactive karyawan after they left", one(`SELECT COUNT(*) FROM sales s JOIN employees e ON e.id = s.employee WHERE e.active = 0 AND s.created > e.updated`) === 0);
const swapBad = q(`SELECT s.number FROM sales s WHERE s.kind = 'tukar' AND (s.ref_sale = '' OR s.total < 0 OR s.total != COALESCE((SELECT SUM(subtotal) FROM sale_items WHERE sale = s.id),0))`);
check("swaps point at their sale and pay the difference (never money back)", !swapBad.length, JSON.stringify(swapBad));
const overReturn = q(`SELECT o.number, i.product, SUM(i.qty) AS sold, COALESCE((SELECT -SUM(r.qty) FROM sale_items r JOIN sales w ON w.id = r.sale WHERE w.ref_sale = o.id AND w.status != 'batal' AND r.product = i.product AND r.qty < 0),0) AS back
  FROM sale_items i JOIN sales o ON o.id = i.sale WHERE i.qty > 0 AND o.kind = 'jual' GROUP BY o.id, i.product HAVING back > sold`);
check("never more returned than sold", !overReturn.length, JSON.stringify(overReturn));
check("no voided sale with a live swap", one(`SELECT COUNT(*) FROM sales o WHERE o.status = 'batal' AND EXISTS (SELECT 1 FROM sales w WHERE w.ref_sale = o.id AND w.status != 'batal')`) === 0);
check("voided sales put their stock back", one(`SELECT COUNT(*) FROM sales s WHERE s.status = 'batal' AND s.note NOT LIKE 'Pesanan online%' AND
  (SELECT COALESCE(SUM(qty),0) FROM stock_moves WHERE ref = s.number) != 0`) === 0);
const webBad = q(`SELECT w.number, w.status, s.status AS sale FROM web_orders w LEFT JOIN sales s ON s.id = w.sale
  WHERE (w.status IN ('diproses','dikirim','siap_diambil','selesai') AND (s.id IS NULL OR s.status = 'batal')) OR (w.status = 'batal' AND s.id IS NOT NULL AND s.status != 'batal')
     OR (w.status IN ('menunggu_bayar','kedaluwarsa') AND w.sale != '')`);
check("web order status matches its sale", !webBad.length, JSON.stringify(webBad.slice(0, 3)));
const webStock = q(`SELECT w.number, w.status, COALESCE((SELECT SUM(qty) FROM stock_moves WHERE ref = w.number),0) AS net FROM web_orders w`)
  .filter((r) => (["batal", "kedaluwarsa"].includes(r.status) ? r.net !== 0 : r.net >= 0));
check("web stock: reserved while live, fully returned when cancelled/expired", !webStock.length, JSON.stringify(webStock.slice(0, 3)));
check("shipped orders carry a resi", one(`SELECT COUNT(*) FROM web_orders WHERE status = 'dikirim' AND resi = ''`) === 0);
const badNum = q("SELECT number, created FROM sales").filter((r) => r.number.slice(4, 10) !== wibDay(r.created).slice(2).replace(/-/g, ""));
check("receipt number date = WIB day of the sale", !badNum.length, JSON.stringify(badNum.slice(0, 3)));
const gaps = q(`SELECT substr(number,5,6) d, COUNT(*) n, MAX(CAST(substr(number,12) AS INT)) mx FROM sales GROUP BY d HAVING n != mx`);
check("receipt numbers run 0001… per day without gaps", !gaps.length, JSON.stringify(gaps.slice(0, 3)));
const nowUtc = new Date().toISOString().replace("T", " ");
const future = ["sales", "sale_payments", "receivable_payments", "stock_moves", "web_orders"].map((t) => [t, one(`SELECT COUNT(*) FROM ${t} WHERE created > ?`, nowUtc)]).filter((x) => x[1]);
check("nothing dated in the future", !future.length, JSON.stringify(future));
check("no leftover TMP numbers", one("SELECT COUNT(*) FROM sales WHERE number LIKE 'TMP-%'") + one("SELECT COUNT(*) FROM web_orders WHERE number LIKE 'TMP-%'") === 0);

console.log("\n── reports over the year (API)");
const O = await login("alin", process.env.OWNER_PASS);
const live = `status != 'batal' AND created >= '2024-10-06 17:00' AND created < '2026-10-06 17:00'`;
const sqlOmzet = one(`SELECT SUM(total) FROM sales WHERE ${live}`);
const sqlHpp = one(`SELECT SUM(i.hpp * i.qty) FROM sale_items i JOIN sales s ON s.id = i.sale WHERE s.${live.replace(/ AND created/g, " AND s.created")}`);
const pl = (await api(O, `/api/reports/profit-loss?from=${FROM}&to=${TO}`)).j;
check("Laba Rugi omzet = Σ live sales", pl.revenue === sqlOmzet, `${pl.revenue} vs ${sqlOmzet}`);
check("Laba Rugi HPP = Σ items × HPP", pl.hpp === sqlHpp, `${pl.hpp} vs ${sqlHpp}`);
const T = {};
for (const t of ["penjualan", "produk", "kategori", "pelanggan", "karyawan", "piutang", "pengeluaran", "retur"]) {
  const r = await api(O, `/api/reports/table?type=${t}&from=${FROM}&to=${TO}`);
  T[t] = r.j;
  check(`Laporan ${t}: loads (${r.j.rows?.length} rows, ${Math.round(r.ms)} ms, ${(r.bytes / 1024).toFixed(0)} KB)`, r.ok && r.ms < 3000, r.status + " " + r.j.message);
}
check("Penjualan total = Laba Rugi omzet", T.penjualan.totals.total === pl.revenue);
check("Karyawan total = Penjualan total", T.karyawan.totals.penjualan === T.penjualan.totals.total, `${T.karyawan.totals.penjualan} vs ${T.penjualan.totals.total}`);
check("Pelanggan total = Penjualan total", T.pelanggan.totals.penjualan === T.penjualan.totals.total);
check("Produk = Kategori = Penjualan subtotal", T.produk.totals.amount === T.kategori.totals.amount && T.produk.totals.amount === T.penjualan.totals.subtotal, `${T.produk.totals.amount} / ${T.kategori.totals.amount} / ${T.penjualan.totals.subtotal}`);
check("Laba (Penjualan) = Laba Rugi gross profit", T.penjualan.totals.laba === pl.gross_profit, `${T.penjualan.totals.laba} vs ${pl.gross_profit}`);
check("Produk laba − discounts = gross profit", T.produk.totals.laba - pl.discount === pl.gross_profit);
check("Transaksi count = live sales", T.karyawan.totals.transaksi === one(`SELECT COUNT(*) FROM sales WHERE ${live}`));
check("Pengeluaran = Laba Rugi expenses", T.pengeluaran.totals.amount === pl.total_expenses);
check("Tukar barang lists every live swap", T.retur.rows.length === one(`SELECT COUNT(*) FROM sales WHERE kind = 'tukar' AND ${live}`));
const karyawan = T.karyawan.rows.map((r) => r.nama);
check("Karyawan report has the leaver, the new hire and Toko", karyawan.includes("Toko") && karyawan.some((n) => /simulasi/.test(n)) && karyawan.length >= 8, karyawan.join(", "));
const pm = T.penjualan.rows.filter((r) => r.metode.includes("+")).length;
check("Pecah pembayaran sales show both methods", pm > 0, pm + " rows");

const sp = (await api(O, `/api/reports/sales?from=${FROM}&to=${TO}`)).j;
const methodSum = sp.perMethod.reduce((a, m) => a + m.paid, 0);
check("Per-method money = Σ sales.paid", methodSum === one(`SELECT SUM(paid) FROM sales WHERE ${live}`));
check("Per-day omzet = Laba Rugi omzet", sp.perDay.reduce((a, d) => a + d.total, 0) === pl.revenue);

const cb = await api(O, `/api/reports/cashbook?from=${FROM}&to=${TO}`);
const inSql = one(`SELECT SUM(sp.amount) FROM sale_payments sp JOIN sales s ON s.id = sp.sale WHERE s.status != 'batal'`) +
  one(`SELECT COALESCE(SUM(rp.amount),0) FROM receivable_payments rp JOIN receivables rc ON rc.id = rp.receivable JOIN sales s ON s.id = rc.sale WHERE s.status != 'batal'`) +
  one(`SELECT COALESCE(SUM(amount),0) FROM cash_entries WHERE type = 'masuk'`);
const outSql = one("SELECT SUM(amount) FROM expenses") + one(`SELECT COALESCE(SUM(amount),0) FROM cash_entries WHERE type = 'keluar'`);
check(`Buku Kas year loads (${cb.j.lines.length} lines, ${Math.round(cb.ms)} ms, ${(cb.bytes / 1024).toFixed(0)} KB)`, cb.ok && cb.ms < 3000);
check("Buku Kas opening on day one = 0", cb.j.opening === 0, cb.j.opening);
check("Buku Kas money in = till payments + bon payments + manual in", cb.j.total_in === inSql, `${rp(cb.j.total_in)} vs ${rp(inSql)}`);
check("Buku Kas money out = expenses + supplier payments", cb.j.total_out === outSql, `${rp(cb.j.total_out)} vs ${rp(outSql)}`);
// Month by month: each month opens where the last one closed, and the months add up to the year.
let prevClose = 0, sumIn = 0, sumOut = 0, broken = [];
for (let m = 0; m < 25; m++) {
  const d = new Date(Date.UTC(2024, 9 + m, 1)), e = new Date(Date.UTC(2024, 10 + m, 0));
  const from = m === 0 ? FROM : d.toISOString().slice(0, 10), to = m === 24 ? TO : e.toISOString().slice(0, 10);
  if (from > TO) break;
  const x = (await api(O, `/api/reports/cashbook?from=${from}&to=${to < TO ? to : TO}`)).j;
  if (x.opening !== prevClose) broken.push(`${from}: ${x.opening} ≠ ${prevClose}`);
  prevClose = x.closing; sumIn += x.total_in; sumOut += x.total_out;
}
check("Buku Kas: every month opens at last month's close", !broken.length, broken.join("; "));
check("Buku Kas: months add up to the year", sumIn === cb.j.total_in && sumOut === cb.j.total_out && prevClose === cb.j.closing);

const dash = (await api(O, "/api/reports/dashboard")).j;
const openSql = one("SELECT COALESCE(SUM(amount - paid),0) FROM receivables WHERE status = 'belum'");
const openCount = one("SELECT COUNT(*) FROM receivables WHERE status = 'belum'");
check("Dasbor open bon = Σ open bons", dash.receivables.amount === openSql);
const bonOpen = (await api(O, "/api/bon/open")).j;
check(`Bayar bon list total = open bons (${openCount} open)`, bonOpen.total === openSql, `${rp(bonOpen.total)} vs ${rp(openSql)}, ${bonOpen.items.length} listed`);
const spend = (await api(O, "/api/customers/spend")).j;
const spendSum = Object.values(spend).reduce((a, c) => a + c.total, 0);
check("Pelanggan page spending = Σ member sales", spendSum === one("SELECT SUM(total) FROM sales WHERE status != 'batal' AND customer != ''"));
const topCust = Object.entries(spend).sort((a, b) => b[1].total - a[1].total)[0];
const sum1 = (await api(O, `/api/customers/${topCust[0]}/summary?from=${FROM}&to=${TO}`)).j;
check("Pelanggan summary all-time = spending list", sum1.all.total === topCust[1].total && sum1.bon_total === topCust[1].bon);

console.log("\n── every report for each Laporan period (owner)");
const today = new Date(Date.now() + WIB).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const monthsBack = (n) => { const d = new Date(Date.parse(today + "T00:00:00Z")); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
const periods = {
  "Hari ini": [today, today], "Kemarin": [shift(today, -1), shift(today, -1)], "Bulan ini": [today.slice(0, 8) + "01", today],
  "Bulan lalu": [new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10), shift(today.slice(0, 8) + "01", -1)],
  "Tahun ini": [today.slice(0, 4) + "-01-01", today], "Tahun lalu": [`${+today.slice(0, 4) - 1}-01-01`, `${+today.slice(0, 4) - 1}-12-31`],
  "1 bulan": [monthsBack(1), today], "3 bulan": [monthsBack(3), today], "6 bulan": [monthsBack(6), today], "Setahun": [FROM, TO],
};
let slowest = 0, errs = [];
for (const [name, [f, t]] of Object.entries(periods)) {
  const rows = [];
  for (const type of ["penjualan", "produk", "kategori", "pelanggan", "karyawan", "piutang", "pengeluaran", "retur"]) {
    const r = await api(O, `/api/reports/table?type=${type}&from=${f}&to=${t}`);
    if (!r.ok) errs.push(`${name}/${type}: ${r.status}`);
    slowest = Math.max(slowest, r.ms); rows.push(r.j.rows?.length ?? "x");
  }
  for (const p of ["profit-loss", "cashbook", "sales"]) { const r = await api(O, `/api/reports/${p}?from=${f}&to=${t}`); if (!r.ok) errs.push(`${name}/${p}: ${r.status}`); slowest = Math.max(slowest, r.ms); }
  console.log(`     ${name.padEnd(10)} ${f} → ${t}  rows per report: ${rows.join(" / ")}`);
}
check(`all 110 report calls answer (slowest ${Math.round(slowest)} ms)`, !errs.length, errs.join("; "));

console.log("\n── roles on a year of data");
const K = await login("kasir", process.env.KASIR_PASS);
check("kasir: no Laba Rugi / Buku Kas / Laporan", !(await api(K, `/api/reports/profit-loss?from=${FROM}&to=${TO}`)).ok && !(await api(K, `/api/reports/cashbook?from=${FROM}&to=${TO}`)).ok && !(await api(K, `/api/reports/table?type=penjualan&from=${FROM}&to=${TO}`)).ok);
check("kasir: can list open bons at the counter", (await api(K, "/api/bon/open")).ok);
check("kasir: receivables records API stays closed", ((await api(K, "/api/collections/receivables/records")).j.items || []).length === 0);

console.log(`\n${pass} ok, ${failN} failed`);
process.exit(failN ? 1 : 0);

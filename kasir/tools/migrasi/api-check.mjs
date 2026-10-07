// After the import: the report routes the screens use, as owner, admin and
// kasir, must show the expected.json totals. PASS/FAIL per check, exit 1 on a FAIL.
//   PB=… OWNER_USER=… OWNER_PASS=… ADMIN_USER=… KASIR_USER=… node api-check.mjs <expected.json>
import { readFileSync } from "node:fs";

const want = JSON.parse(readFileSync(process.argv[2], "utf8"));
const PB = process.env.PB, pass = process.env.OWNER_PASS;
const login = async (u) => (await (await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity: u, password: pass }) })).json()).token;
const get = async (tok, path) => { const r = await fetch(PB + path, { headers: { Authorization: tok } }); return { status: r.status, body: await r.json() }; };
const [O, A, K] = await Promise.all([process.env.OWNER_USER, process.env.ADMIN_USER, process.env.KASIR_USER].map(login));
let fails = 0;
const check = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${label.padEnd(44)} ${ok ? "PASS" : `FAIL  got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`}`);
};
const L = want.legacy_sales, LT = want.legacy_totals;
const R = `from=${L.first}&to=${L.last}`, ALL = "from=2000-01-01&to=2099-12-31";

if (process.env.SIM_SALES) {
  // The old history as receipts: the screens read them directly, the summary add-ons are gone.
  const W = want.simulated_sales;
  const pl = (await get(O, `/api/reports/profit-loss?${ALL}`)).body;
  check("Laba Rugi: penjualan / laba kotor", [pl.gross_sales, pl.legacy_sales, pl.gross_profit], [L.total, 0, L.profit]);
  check("Laba Rugi: pengeluaran", pl.total_expenses, want.expenses.total);
  const cb = (await get(O, `/api/reports/cashbook?${ALL}`)).body;
  check("Buku Kas: masuk / keluar / saldo akhir", [cb.total_in, cb.total_out, cb.closing], [W.cash_in, want.cash_out_total, W.closing]);
  check("Buku Kas: sections add up to TOTAL", cb.groups.reduce((a, g) => a + g.closing, 0), cb.closing);
  const sales = (await get(O, `/api/reports/sales?${R}`)).body;
  check("Ringkasan: days / omzet, no add-on", [sales.perDay.length, sales.perDay.reduce((a, d) => a + d.total, 0), sales.legacy.length], [L.days, L.total, 0]);
  const spend = Object.values((await get(O, "/api/customers/spend")).body);
  check("Pelanggan list: total belanja", [spend.length, spend.reduce((a, s) => a + s.total, 0), spend.reduce((a, s) => a + s.trx, 0), spend.some((s) => s.legacy)],
    [LT.pelanggan.coded_rows, LT.pelanggan.coded_total, LT.pelanggan.coded_trx, false]);
  for (const [type, kind, key] of [["pelanggan", "pelanggan", "penjualan"], ["karyawan", "karyawan", "penjualan"], ["produk", "produk", "amount"]]) {
    const t = (await get(O, `/api/reports/table?type=${type}&${R}`)).body;
    check(`Laporan ${type}: total / laba, no add-on`, [t.rows.length, t.totals[key], t.totals.laba, "lama" in t.totals], [LT[kind].rows, LT[kind].total, L.profit, false]);
  }
  check("kasir: no summary card on the last day", (await get(K, `/api/legacy/day?day=${L.last}`)).body.legacy, null);
  const one = (await get(O, `/api/collections/sales/records?filter=${encodeURIComponent('number="TRX0001"')}`)).body.items[0];
  const v = await fetch(`${PB}/api/pos/void/${one.id}`, { method: "POST", headers: { Authorization: O, "content-type": "application/json" }, body: JSON.stringify({ reason: "uji" }) });
  check("void of a sistem lama receipt refused", v.status, 400);
  check("swap of a sistem lama receipt refused", (await get(K, "/api/pos/swap/TRX0001")).status, 400);
  const bon = (await get(O, `/api/collections/receivables/records?perPage=1&filter=${encodeURIComponent('status="lunas"')}`)).body;
  check("bons: all lunas", bon.totalItems, W.bon_count);
} else {
  const pl = (await get(O, `/api/reports/profit-loss?${ALL}`)).body;
  check("Laba Rugi: penjualan sistem lama", pl.legacy_sales, L.total);
  check("Laba Rugi: laba kotor", pl.gross_profit, L.profit);
  check("Laba Rugi: pengeluaran", pl.total_expenses, want.expenses.total);
  const cb = (await get(O, `/api/reports/cashbook?${ALL}`)).body;
  check("Buku Kas: keluar / saldo akhir", [cb.total_out, cb.closing], [want.cash_out_total, -want.cash_out_total]);
  check("Buku Kas: Tunai = TOTAL", cb.groups.find((g) => g.name === "Tunai")?.total_out, cb.total_out);
  const sales = (await get(O, `/api/reports/sales?${R}`)).body;
  check("Ringkasan: sistem lama days / omzet", [sales.legacy.length, sales.legacy.reduce((a, d) => a + d.total, 0)], [L.days, L.total]);
  const spend = Object.values((await get(O, "/api/customers/spend")).body);
  check("Pelanggan list: total belanja", [spend.length, spend.reduce((a, s) => a + s.total, 0), spend.reduce((a, s) => a + s.trx, 0)],
    [LT.pelanggan.coded_rows, LT.pelanggan.coded_total, LT.pelanggan.coded_trx]);
  for (const [type, kind, key] of [["pelanggan", "pelanggan", "penjualan"], ["karyawan", "karyawan", "penjualan"], ["produk", "produk", "amount"]]) {
    const t = (await get(O, `/api/reports/table?type=${type}&${R}`)).body;
    check(`Laporan ${type}: total / sistem lama / laba`, [t.totals[key], t.totals.lama, t.totals.laba], [LT[kind].total, LT[kind].total, L.profit]);
  }
  const adm = (await get(A, `/api/reports/table?type=karyawan&${R}`)).body;
  check("admin: no Laba column", adm.columns.some((c) => c.key === "laba"), false);
  check("admin: Laba Rugi refused", (await get(A, `/api/reports/profit-loss?${R}`)).status, 403);
  const day = (await get(K, `/api/legacy/day?day=${L.last}`)).body.legacy;
  check("kasir: Transaksi card on the last day", !!day && day.count > 0 && !("profit" in day), true);
  check("kasir: Laporan refused", (await get(K, `/api/reports/table?type=karyawan&${R}`)).status, 403);
}
console.log(`api-check: ${fails ? fails + " failed" : "all passed"}`);
process.exit(fails ? 1 : 0);

/// <reference path="../../pb_data/types.d.ts" />
// Migrasi sistem lama → kasir baru, in one transaction. simulate.sh copies this
// file into a SANDBOX's pb_migrations and runs `pocketbase migrate up` with
// NB_MIGRASI_DATA = the private data folder (never in git):
//   data-induk.txt        #CATEGORIES #PRODUCTS #CUSTOMERS #EMPLOYEES #EXPENSES
//   laporan-penjualan.txt the old Laporan Penjualan (pdftotext -layout)
//   total-per-pelanggan-karyawan-produk.txt  #CUSTOMER_TOTALS #EMPLOYEE_TOTALS #PRODUCT_TOTALS
//   logo-struk.png        black-on-white struk logo
//   struk-header.txt      the lines under the logo on the struk
//   kodian.txt            kodian price per sku (optional)
//   expected.json         the totals every step must hit
// Replaces everything the old system owns: sales activity, stock ledger,
// pelanggan, expenses, Buku Kas entries, old-system history. Keeps the owner,
// admin and kasir logins. Any mismatch throws and the whole import rolls back.
migrate((app) => {
  const dir = $os.getenv("NB_MIGRASI_DATA");
  if (!dir) throw new Error("NB_MIGRASI_DATA is not set");
  const read = (f) => toString($os.readFile(`${dir}/${f}`));
  const want = JSON.parse(read("expected.json"));
  const must = (label, got, exp) => { if (got !== exp) throw new Error(`${label}: got ${got}, expected ${exp}`); };
  const sections = (txt) => {
    const sec = {}; let cur = null;
    for (const l of txt.split("\n")) {
      if (l.startsWith("#")) { cur = l.split(/[\s:]/)[0]; sec[cur] = []; continue; }
      if (l.trim() && cur) sec[cur].push(l.trim());
    }
    return sec;
  };
  const ex = (sql) => app.db().newQuery(sql).execute();
  const col = (n) => app.findCollectionByNameOrId(n);
  const one = (c, f, v) => { try { return app.findFirstRecordByData(c, f, v); } catch (_) { return null; } };

  // 1. clear what the old system replaces
  for (const t of ["sale_payments", "sale_items", "receivable_payments", "receivables", "sales", "stock_moves",
    "web_orders", "vouchers", "expenses", "cash_entries", "legacy_sales", "legacy_totals"]) ex(`DELETE FROM ${t}`);
  for (const u of app.findAllRecords("users", $dbx.hashExp({ role: "pelanggan" }))) app.delete(u);
  let owner = null;
  try { owner = app.findFirstRecordByFilter("users", "role = 'owner' && disabled = false"); } catch (_) {}
  const by = owner ? owner.id : "";

  // 2. payment methods: only Tunai and Transfer are active
  for (const [name, cash] of [["Tunai", true], ["Transfer", false]]) {
    const m = one("payment_methods", "name", name) || new Record(col("payment_methods"));
    m.set("name", name); m.set("is_cash", cash); m.set("active", true); app.save(m);
  }
  for (const m of app.findAllRecords("payment_methods")) if (!["Tunai", "Transfer"].includes(m.getString("name")) && m.getBool("active")) { m.set("active", false); app.save(m); }
  const tunai = one("payment_methods", "name", "Tunai");

  const D = sections(read("data-induk.txt"));

  // 3. categories (upsert by name; others removed after the products)
  const catNames = D["#CATEGORIES"][0].split("|");
  const cats = {};
  for (const n of catNames) {
    let r = one("categories", "name", n);
    if (!r) { r = new Record(col("categories")); r.set("name", n); app.save(r); }
    cats[n] = r.id;
  }

  // 4. products: upsert by sku, else name (keeps photo, description, weight,
  // kodian price, hide_online); one opening-stock ledger row each
  const keep = [];
  let stock = 0, stockHpp = 0, stockPrice = 0, active = 0;
  for (const l of D["#PRODUCTS"]) {
    const [sku, name, cat, st, unit, hpp, price, act] = l.split("|");
    if (!cats[cat]) throw new Error("unknown category " + cat);
    const r = one("products", "sku", sku) || one("products", "name", name) || new Record(col("products"));
    r.set("name", name); r.set("sku", sku); r.set("category", cats[cat]); r.set("unit", unit);
    r.set("hpp", +hpp); r.set("price", +price); r.set("active", act === "1"); r.set("stock", +st);
    app.save(r); keep.push(r.id);
    const m = new Record(col("stock_moves"));
    m.set("product", r.id); m.set("type", "opname"); m.set("qty", +st); m.set("counted", +st); m.set("stock_after", +st);
    m.set("note", "Saldo awal dari sistem lama"); m.set("by", by); app.save(m);
    stock += +st; stockHpp += +st * +hpp; stockPrice += +st * +price; if (act === "1") active++;
  }
  for (const r of app.findAllRecords("products")) if (!keep.includes(r.id)) app.delete(r);
  // kodian prices from the old kasir (kodian.txt: sku|price, 0 = none), when the file is there
  let kodian = null;
  try { kodian = read("kodian.txt"); } catch (_) {}
  if (kodian) for (const l of kodian.split("\n")) {
    if (!l.trim() || l.startsWith("#")) continue;
    const [sku, k] = l.trim().split("|");
    const r = one("products", "sku", sku);
    if (!r) throw new Error("kodian: unknown sku " + sku);
    r.set("price_kodi", +k); app.save(r);
  }
  for (const r of app.findAllRecords("categories")) if (!catNames.includes(r.getString("name"))) app.delete(r);
  must("categories", catNames.length, want.categories);
  must("products", keep.length, want.products.count);
  must("active products", active, want.products.active);
  must("stock", stock, want.products.stock);
  must("stock × hpp", stockHpp, want.products.stock_hpp);
  must("stock × price", stockPrice, want.products.stock_price);

  // 5. pelanggan: username = code in lower case, random password nobody knows
  for (const l of D["#CUSTOMERS"]) {
    const [code, name, address, phone] = l.split("|");
    const u = new Record(col("users"));
    u.set("username", code.toLowerCase()); u.set("name", name); u.set("address", address); u.set("phone", phone);
    u.set("role", "pelanggan"); u.set("points", 0); u.set("disabled", false);
    u.setPassword($security.randomString(24));
    app.save(u);
  }
  must("pelanggan", D["#CUSTOMERS"].length, want.customers);
  // walk-in pelanggan "Toko" = the old CUS0130 (not in the export), when the
  // 1791210000_walkin_toko migration has run
  let walk = "";
  const st = app.findFirstRecordByFilter("settings", "id != ''");
  if (st.collection().fields.getByName("walkin_customer")) {
    const u = new Record(col("users"));
    u.set("username", "cus0130"); u.set("name", "Toko"); u.set("address", st.getString("address")); u.set("phone", st.getString("phone"));
    u.set("role", "pelanggan"); u.set("points", 0); u.set("disabled", false);
    u.setPassword($security.randomString(24));
    app.save(u);
    walk = u.id;
    st.set("walkin_customer", walk);
    app.save(st);
  }

  // 6. karyawan: upsert by name, others removed
  const emps = [];
  for (const l of D["#EMPLOYEES"]) {
    const [name, phone] = l.split("|");
    const r = one("employees", "name", name) || new Record(col("employees"));
    r.set("name", name); r.set("phone", phone || ""); r.set("active", true); app.save(r);
    emps.push(name);
  }
  for (const r of app.findAllRecords("employees")) if (!emps.includes(r.getString("name"))) app.delete(r);
  must("karyawan", emps.length, want.employees);

  // 7. expenses (WIB day at 00:00Z). Tabungan is savings, not spending: it goes
  // to Buku Kas as a manual cash-out entry instead of Pengeluaran.
  const CAT = { T: "Tabungan", M: "Uang Makan", N: "Minuman", D: "Uang Dropship", B: "Bonus Harian", L: "Lain-lain" };
  const sum = {}; const days = {};
  // The one expense note sits on its own header line: #EXPENSE_NOTE: the <day> <code> entry has note "…"
  let note = {};
  const nm = read("data-induk.txt").match(/#EXPENSE_NOTE:.*?(\d{4}-\d{2}-\d{2}) ([A-Z]\d+) entry has note "([^"]*)"/);
  if (nm) note = { day: nm[1], code: nm[2], text: nm[3] };
  for (const l of D["#EXPENSES"]) {
    const [d, ...es] = l.split(" ");
    const day = "20" + d;
    days[day] = true;
    for (const e of es) {
      const m = e.match(/^([TMNDBL])(\d+)$/);
      if (!m) throw new Error("bad expense entry " + l);
      const amount = +m[2] * 1000, cat = CAT[m[1]];
      (sum[cat] = sum[cat] || [0, 0])[0]++; sum[cat][1] += amount;
      const text = note.day === day && note.code === e ? note.text : "";
      if (m[1] === "T") {
        const c = new Record(col("cash_entries"));
        c.set("date", day + " 00:00:00.000Z"); c.set("type", "keluar"); c.set("amount", amount);
        c.set("payment_method", tunai.id); c.set("note", "Tabungan (dari sistem lama)"); c.set("by", by); app.save(c);
      } else {
        const x = new Record(col("expenses"));
        x.set("date", day + " 00:00:00.000Z"); x.set("category", cat); x.set("amount", amount);
        x.set("payment_method", tunai.id); x.set("by", by); x.set("note", text); app.save(x);
      }
    }
  }
  must("expense days", Object.keys(days).length, want.expense_days);
  must("Tabungan rows", sum.Tabungan[0], want.tabungan.count);
  must("Tabungan total", sum.Tabungan[1], want.tabungan.total);
  let expRows = 0, expTotal = 0;
  for (const c in want.expenses.by_category) {
    must(`${c} rows`, (sum[c] || [0])[0], want.expenses.by_category[c][0]);
    must(`${c} total`, (sum[c] || [0, 0])[1], want.expenses.by_category[c][1]);
    expRows += sum[c][0]; expTotal += sum[c][1];
  }
  must("expense rows", expRows, want.expenses.count);
  must("expense total", expTotal, want.expenses.total);

  // 8. old-system daily sales (Laporan Penjualan), checked against its Total row
  const num = (v) => parseInt(v.replace(/\./g, ""), 10);
  const ls = col("legacy_sales");
  const L = { days: 0, total: 0, count: 0, items: 0, profit: 0 };
  let totalRow = null;
  for (const l of read("laporan-penjualan.txt").split("\n")) {
    const t = l.match(/^\s*Total\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/);
    if (t) totalRow = [num(t[1]), num(t[2]), num(t[3]), num(t[5])];
    const m = l.match(/^\s*(\d\d)\/(\d\d)\/(\d{4})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/);
    if (!m) continue;
    const r = new Record(ls);
    r.set("day", `${m[3]}-${m[2]}-${m[1]}`); r.set("total", num(m[4])); r.set("count", num(m[5]));
    r.set("items", num(m[6])); r.set("discount", num(m[7])); r.set("profit", num(m[8]));
    app.save(r);
    L.days++; L.total += num(m[4]); L.count += num(m[5]); L.items += num(m[6]); L.profit += num(m[8]);
  }
  if (!totalRow) throw new Error("Laporan Penjualan has no Total row");
  must("Laporan total vs its Total row", [L.total, L.count, L.items, L.profit].join(), totalRow.join());
  for (const k of ["days", "total", "count", "items", "profit"]) must(`legacy_sales ${k}`, L[k], want.legacy_sales[k]);

  // 9. old-system totals per pelanggan (TOKO = walk-in, rows summed), karyawan, produk
  const T = sections(read("total-per-pelanggan-karyawan-produk.txt"));
  const acc = {};
  const add = (kind, ref, name, r) => {
    const a = acc[kind + "|" + ref] = acc[kind + "|" + ref] || { kind, ref, name, total: 0, trx: 0, items: 0, profit: 0 };
    a.total += +r[1]; a.trx += +r[2]; a.items += +r[3]; a.profit += +r[4];
  };
  const need = (rec, what) => { if (!rec) throw new Error("not found: " + what); return rec; };
  for (const l of T["#CUSTOMER_TOTALS"]) {
    const r = l.split("|");
    if (r[0] === "TOKO") add("pelanggan", walk, walk ? "Toko" : "Umum (tanpa member)", r);
    else add("pelanggan", need(one("users", "username", r[0].toLowerCase()), r[0]).id, r[0], r);
  }
  for (const l of T["#EMPLOYEE_TOTALS"]) {
    const r = l.split("|");
    add("karyawan", r[0] === "Toko" ? "toko" : need(one("employees", "name", r[0]), r[0]).id, r[0], r);
  }
  for (const l of T["#PRODUCT_TOTALS"]) { const r = l.split("|"); add("produk", need(one("products", "name", r[0]), r[0]).id, r[0], r); }
  const lt = col("legacy_totals");
  for (const a of Object.values(acc)) {
    const r = new Record(lt);
    for (const f of ["kind", "ref", "name", "total", "trx", "items", "profit"]) r.set(f, a[f]);
    app.save(r);
  }
  for (const kind in want.legacy_totals) {
    const rows = Object.values(acc).filter((a) => a.kind === kind), w = want.legacy_totals[kind];
    must(`legacy_totals ${kind} rows`, rows.length, w.rows);
    for (const f of ["total", "trx", "items", "profit"]) if (w[f] !== undefined) must(`legacy_totals ${kind} ${f}`, rows.reduce((s, a) => s + a[f], 0), w[f]);
    if (w.coded_rows !== undefined) {
      const coded = rows.filter((a) => a.ref);
      must("coded pelanggan rows", coded.length, w.coded_rows);
      must("coded pelanggan total", coded.reduce((s, a) => s + a.total, 0), w.coded_total);
      must("coded pelanggan trx", coded.reduce((s, a) => s + a.trx, 0), w.coded_trx);
    }
  }

  // 10. struk: Mas Alin's details and logo
  const s = app.findAllRecords("settings")[0];
  s.set("receipt_header", read("struk-header.txt").replace(/\s+$/, ""));
  s.set("phone", want.settings.phone);
  s.set("email", want.settings.email);
  s.set("logo", $filesystem.fileFromPath(`${dir}/logo-struk.png`));
  app.save(s);
}, (app) => {});

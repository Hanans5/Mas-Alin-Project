/// <reference path="../pb_data/types.d.ts" />
// Reports. Every date range is in WIB calendar days (?from=YYYY-MM-DD&to=…).
// Cancelled sales (status batal) and payments on their debts count nowhere.
// expenses.date and cash_entries.date hold a WIB calendar day at 00:00Z, so
// they compare on their first 10 characters, not as instants.

// GET /api/reports/dashboard — today at a glance. Profit only for the owner.
routerAdd("GET", "/api/reports/dashboard", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin", "kasir"]);
  const day = L.wibDate();
  const r = L.wibRange(day, day);
  const isKasir = L.role(e) === "kasir";
  // A kasir sees only their own till.
  const mine = isKasir ? " AND s.cashier = {:me}" : "";
  const p = { from: r.from, to: r.to, me: e.auth.id };

  const today = L.query(e.app,
    `SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS omzet, COALESCE(SUM(s.paid),0) AS paid
       FROM sales s WHERE s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}${mine}`,
    p, { count: 0, omzet: 0, paid: 0 })[0];

  const top = L.query(e.app,
    `SELECT i.name AS name, SUM(i.qty) AS qty, SUM(i.subtotal) AS amount
       FROM sale_items i JOIN sales s ON s.id = i.sale
      WHERE s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}${mine}
      GROUP BY i.product ORDER BY qty DESC LIMIT 5`,
    p, { name: "", qty: 0, amount: 0 });

  const lowStock = L.query(e.app,
    `SELECT id, name, sku, stock, min_stock FROM products
      WHERE active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock ASC LIMIT 20`,
    {}, { id: "", name: "", sku: "", stock: 0, min_stock: 0 });

  const out = { date: day, today, top, lowStock };
  if (!isKasir) {
    out.receivables = L.query(e.app,
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount - paid),0) AS amount FROM receivables WHERE status = 'belum'`,
      {}, { count: 0, amount: 0 })[0];
  }
  if (L.role(e) === "owner") {
    out.today.gross_profit = L.query(e.app,
      `SELECT COALESCE(SUM(i.subtotal - i.hpp * i.qty),0) - COALESCE((SELECT SUM(discount) FROM sales
              WHERE status != 'batal' AND created >= {:from} AND created < {:to}),0) AS v
         FROM sale_items i JOIN sales s ON s.id = i.sale
        WHERE s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}`,
      p, { v: 0 })[0].v;
  }
  return e.json(200, out);
}, $apis.requireAuth("users"));

// GET /api/reports/sales?from&to — owner/admin.
routerAdd("GET", "/api/reports/sales", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const q = e.requestInfo().query;
  const r = L.wibRange(q.from, q.to);
  const live = "s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}";

  const perDay = L.query(e.app,
    `SELECT date(datetime(s.created, '+7 hours')) AS day, COUNT(*) AS count,
            SUM(s.subtotal) AS subtotal, SUM(s.discount) AS discount, SUM(s.total) AS total
       FROM sales s WHERE ${live} GROUP BY day ORDER BY day`,
    r, { day: "", count: 0, subtotal: 0, discount: 0, total: 0 });
  const perProduct = L.query(e.app,
    `SELECT i.name AS name, p.sku AS sku, SUM(i.qty) AS qty, SUM(i.subtotal) AS amount
       FROM sale_items i JOIN sales s ON s.id = i.sale LEFT JOIN products p ON p.id = i.product
      WHERE ${live} GROUP BY i.product ORDER BY qty DESC`,
    r, { name: "", sku: "", qty: 0, amount: 0 });
  // Money kept at the till per method: payment rows, plus older sales' single method.
  const perMethod = L.query(e.app,
    `SELECT method, COUNT(DISTINCT sale) AS count, SUM(amount) AS paid FROM (
       SELECT COALESCE(m.name,'-') AS method, sp.sale AS sale, sp.amount AS amount
         FROM sale_payments sp JOIN sales s ON s.id = sp.sale LEFT JOIN payment_methods m ON m.id = sp.payment_method WHERE ${live}
       UNION ALL
       SELECT COALESCE(m.name,'-'), s.id, s.paid
         FROM sales s LEFT JOIN payment_methods m ON m.id = s.payment_method
        WHERE ${live} AND s.paid > 0 AND NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale = s.id)
     ) GROUP BY method ORDER BY paid DESC`,
    r, { method: "", count: 0, paid: 0 });
  const perCashier = L.query(e.app,
    `SELECT COALESCE(NULLIF(u.name,''), u.username) AS cashier, COUNT(*) AS count, SUM(s.total) AS total
       FROM sales s LEFT JOIN users u ON u.id = s.cashier
      WHERE ${live} GROUP BY s.cashier ORDER BY total DESC`,
    r, { cashier: "", count: 0, total: 0 });
  return e.json(200, { from: q.from, to: q.to, perDay, perProduct, perMethod, perCashier });
}, $apis.requireAuth("users"));

// GET /api/reports/profit-loss?from&to — owner only.
routerAdd("GET", "/api/reports/profit-loss", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner"]);
  const q = e.requestInfo().query;
  const r = L.wibRange(q.from, q.to);
  const p = { from: r.from, to: r.to, d1: q.from, d2: q.to };

  const s = L.query(e.app,
    `SELECT COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount
       FROM sales WHERE status != 'batal' AND created >= {:from} AND created < {:to}`,
    p, { gross: 0, discount: 0 })[0];
  const hpp = L.query(e.app,
    `SELECT COALESCE(SUM(i.hpp * i.qty),0) AS v FROM sale_items i JOIN sales s ON s.id = i.sale
      WHERE s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}`,
    p, { v: 0 })[0].v;
  const expenses = L.query(e.app,
    `SELECT category, SUM(amount) AS amount FROM expenses
      WHERE substr(date,1,10) BETWEEN {:d1} AND {:d2} GROUP BY category ORDER BY amount DESC`,
    p, { category: "", amount: 0 });

  const revenue = s.gross - s.discount;
  const grossProfit = revenue - hpp;
  const totalExpenses = expenses.reduce((a, x) => a + x.amount, 0);
  return e.json(200, {
    from: q.from, to: q.to,
    gross_sales: s.gross, discount: s.discount, revenue, hpp,
    gross_profit: grossProfit, expenses, total_expenses: totalExpenses,
    net_profit: grossProfit - totalExpenses,
  });
}, $apis.requireAuth("users"));

// GET /api/reports/cashbook?from&to — owner only. Money in and out, built at
// read time from till payments (sale_payments, one line per method; older
// sales without rows use sales.paid), bon payments, expenses and manual entries.
routerAdd("GET", "/api/reports/cashbook", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner"]);
  const q = e.requestInfo().query;
  const r = L.wibRange(q.from, q.to);

  // One UNION of every money movement, each tagged with its WIB day.
  const all = `
    SELECT date(datetime(s.created,'+7 hours')) AS day, s.created AS at, 'masuk' AS type, sp.amount AS amount,
           CASE WHEN EXISTS (SELECT 1 FROM receivables rc WHERE rc.sale = s.id) THEN 'DP penjualan' ELSE 'Penjualan' END AS source,
           s.number AS ref, COALESCE(m.name,'') AS method, '' AS note
      FROM sale_payments sp JOIN sales s ON s.id = sp.sale LEFT JOIN payment_methods m ON m.id = sp.payment_method
     WHERE s.status != 'batal'
    UNION ALL
    SELECT date(datetime(s.created,'+7 hours')), s.created, 'masuk', s.paid,
           'Penjualan', s.number, COALESCE(m.name,''), ''
      FROM sales s LEFT JOIN payment_methods m ON m.id = s.payment_method
     WHERE s.status != 'batal' AND s.paid > 0 AND NOT EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale = s.id)
    UNION ALL
    SELECT date(datetime(rp.created,'+7 hours')), rp.created, 'masuk', rp.amount,
           'Bayar piutang', s.number, COALESCE(m.name,''), rp.note
      FROM receivable_payments rp JOIN receivables rc ON rc.id = rp.receivable
      JOIN sales s ON s.id = rc.sale LEFT JOIN payment_methods m ON m.id = rp.payment_method
     WHERE s.status != 'batal'
    UNION ALL
    SELECT substr(x.date,1,10), x.date, 'keluar', x.amount,
           'Pengeluaran: ' || x.category, '', COALESCE(m.name,''), x.note
      FROM expenses x LEFT JOIN payment_methods m ON m.id = x.payment_method
    UNION ALL
    SELECT substr(c.date,1,10), c.date, c.type, c.amount,
           'Manual', '', COALESCE(m.name,''), c.note
      FROM cash_entries c LEFT JOIN payment_methods m ON m.id = c.payment_method`;

  const p = { d1: q.from, d2: q.to };
  const opening = L.query(e.app,
    `SELECT COALESCE(SUM(CASE type WHEN 'masuk' THEN amount ELSE -amount END),0) AS v FROM (${all}) WHERE day < {:d1}`,
    p, { v: 0 })[0].v;
  const lines = L.query(e.app,
    `SELECT day, type, amount, source, ref, method, note FROM (${all}) WHERE day BETWEEN {:d1} AND {:d2} ORDER BY day, at`,
    p, { day: "", type: "", amount: 0, source: "", ref: "", method: "", note: "" });

  let balance = opening, totalIn = 0, totalOut = 0;
  for (const l of lines) {
    if (l.type === "masuk") { balance += l.amount; totalIn += l.amount; } else { balance -= l.amount; totalOut += l.amount; }
    l.balance = balance;
  }
  return e.json(200, { from: q.from, to: q.to, opening, total_in: totalIn, total_out: totalOut, closing: balance, lines });
}, $apis.requireAuth("users"));

// GET /api/reports/table?type=&from=&to= — one report as a table, the same
// rows the screen, Excel and PDF show. Types follow the old system's list:
// penjualan, produk, kategori, pelanggan, karyawan (who served), piutang,
// pengeluaran, retur (item swaps). Profit columns are for the owner only.
routerAdd("GET", "/api/reports/table", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const q = e.requestInfo().query;
  const r = L.wibRange(q.from, q.to);
  const owner = L.role(e) === "owner";
  const live = "s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}";
  // Per sale: items (net of returns) and HPP, so grouping never double counts.
  const perSale = `SELECT s.*, COALESCE((SELECT SUM(qty) FROM sale_items WHERE sale = s.id), 0) AS items,
      COALESCE((SELECT SUM(hpp * qty) FROM sale_items WHERE sale = s.id), 0) AS hpp_total
      FROM sales s WHERE ${live}`;
  const C = (key, label, type) => ({ key, label, type: type || "text" });
  const profit = owner ? [C("laba", "Laba", "rp")] : [];
  let title, columns, rows;

  if (q.type === "penjualan") {
    title = "Laporan Penjualan";
    columns = [C("created", "Tanggal", "date"), C("number", "No. transaksi"), C("karyawan", "Karyawan"), C("pelanggan", "Pelanggan"), C("items", "Item", "num"),
      C("subtotal", "Subtotal", "rp"), C("discount", "Diskon", "rp"), C("total", "Total", "rp"), C("paid", "Dibayar", "rp"), C("metode", "Metode"), C("status", "Status"), ...profit];
    rows = L.query(e.app, `SELECT x.created, x.number, COALESCE(em.name, 'Toko') AS karyawan,
        COALESCE(NULLIF(c.name,''), c.username, 'Umum') AS pelanggan, x.items, x.subtotal, x.discount, x.total, x.paid,
        COALESCE((SELECT GROUP_CONCAT(pm.name, ' + ') FROM sale_payments sp JOIN payment_methods pm ON pm.id = sp.payment_method WHERE sp.sale = x.id), m.name,
          CASE WHEN x.status = 'piutang' THEN 'Bon' ELSE '-' END) AS metode,
        CASE WHEN x.kind = 'tukar' THEN 'tukar' WHEN x.status = 'piutang' THEN 'bon' ELSE x.status END AS status, x.total - x.hpp_total AS laba
        FROM (${perSale}) x LEFT JOIN employees em ON em.id = x.employee LEFT JOIN users c ON c.id = x.customer
        LEFT JOIN payment_methods m ON m.id = x.payment_method ORDER BY x.created`, r,
      { created: "", number: "", karyawan: "", pelanggan: "", items: 0, subtotal: 0, discount: 0, total: 0, paid: 0, metode: "", status: "", laba: 0 });
  } else if (q.type === "produk" || q.type === "kategori") {
    const byCat = q.type === "kategori";
    title = byCat ? "Laporan Kategori Produk" : "Laporan Produk";
    columns = byCat
      ? [C("nama", "Kategori"), C("qty", "Terjual (pcs)", "num"), C("amount", "Penjualan", "rp"), ...(owner ? [C("hpp", "HPP", "rp")] : []), ...profit]
      : [C("nama", "Produk"), C("sku", "SKU"), C("kategori", "Kategori"), C("qty", "Terjual (pcs)", "num"), C("amount", "Penjualan", "rp"), ...(owner ? [C("hpp", "HPP", "rp")] : []), ...profit];
    rows = L.query(e.app, `SELECT ${byCat ? "COALESCE(k.name, 'Tanpa kategori')" : "i.name"} AS nama, COALESCE(p.sku, '') AS sku, COALESCE(k.name, '') AS kategori,
        SUM(i.qty) AS qty, SUM(i.subtotal) AS amount, SUM(i.hpp * i.qty) AS hpp, SUM(i.subtotal) - SUM(i.hpp * i.qty) AS laba
        FROM sale_items i JOIN sales s ON s.id = i.sale LEFT JOIN products p ON p.id = i.product LEFT JOIN categories k ON k.id = p.category
        WHERE ${live} GROUP BY ${byCat ? "p.category" : "i.product"} ORDER BY amount DESC`, r,
      { nama: "", sku: "", kategori: "", qty: 0, amount: 0, hpp: 0, laba: 0 });
  } else if (q.type === "pelanggan" || q.type === "karyawan") {
    const cust = q.type === "pelanggan";
    title = cust ? "Laporan Pelanggan" : "Laporan Karyawan";
    columns = [C("nama", cust ? "Pelanggan" : "Karyawan"), C("kontak", "Kontak"), C("penjualan", "Penjualan", "rp"), C("transaksi", "Transaksi", "num"),
      C("items", "Item", "num"), C("diskon", "Diskon", "rp"), ...profit];
    // karyawan = who served (sales.employee); sales with none (the owner, online orders, older sales) show as "Toko" like the old system
    const who = cust
      ? { name: "COALESCE(NULLIF(u.name,''), u.username, 'Umum (tanpa member)')", phone: "COALESCE(u.phone, '')", join: "LEFT JOIN users u ON u.id = x.customer", by: "x.customer" }
      : { name: "COALESCE(em.name, 'Toko')", phone: "COALESCE(em.phone, '')", join: "LEFT JOIN employees em ON em.id = x.employee", by: "x.employee" };
    rows = L.query(e.app, `SELECT ${who.name} AS nama, ${who.phone} AS kontak,
        SUM(x.total) AS penjualan, COUNT(*) AS transaksi, SUM(x.items) AS items, SUM(x.discount) AS diskon, SUM(x.total - x.hpp_total) AS laba
        FROM (${perSale}) x ${who.join} GROUP BY ${who.by} ORDER BY penjualan DESC`, r,
      { nama: "", kontak: "", penjualan: 0, transaksi: 0, items: 0, diskon: 0, laba: 0 });
  } else if (q.type === "piutang") {
    title = "Laporan Piutang";
    columns = [C("created", "Tanggal", "date"), C("number", "No. transaksi"), C("pelanggan", "Pelanggan"), C("kontak", "Kontak"),
      C("amount", "Jumlah", "rp"), C("paid", "Dibayar", "rp"), C("sisa", "Sisa", "rp"), C("due", "Jatuh tempo", "day"), C("status", "Status")];
    rows = L.query(e.app, `SELECT rc.created, COALESCE(s.number, '') AS number, COALESCE(NULLIF(u.name,''), u.username, '') AS pelanggan, COALESCE(u.phone, '') AS kontak,
        rc.amount, rc.paid, rc.amount - rc.paid AS sisa, COALESCE(rc.due_date, '') AS due, rc.status
        FROM receivables rc LEFT JOIN sales s ON s.id = rc.sale LEFT JOIN users u ON u.id = rc.customer
        WHERE rc.status != 'batal' AND rc.created >= {:from} AND rc.created < {:to} ORDER BY rc.created`, r,
      { created: "", number: "", pelanggan: "", kontak: "", amount: 0, paid: 0, sisa: 0, due: "", status: "" });
  } else if (q.type === "pengeluaran") {
    title = "Laporan Pengeluaran";
    columns = [C("date", "Tanggal", "day"), C("category", "Kategori"), C("note", "Keterangan"), C("metode", "Metode"), C("amount", "Jumlah", "rp")];
    rows = L.query(e.app, `SELECT x.date, x.category, x.note, COALESCE(m.name, '-') AS metode, x.amount
        FROM expenses x LEFT JOIN payment_methods m ON m.id = x.payment_method
        WHERE x.date >= {:from} AND x.date < {:to} ORDER BY x.date`, r,
      { date: "", category: "", note: "", metode: "", amount: 0 });
  } else if (q.type === "retur") {
    title = "Laporan Tukar Barang";
    columns = [C("created", "Tanggal", "date"), C("number", "No. tukar"), C("dari", "Dari transaksi"), C("kembali", "Barang dikembalikan"),
      C("baru", "Barang baru"), C("total", "Selisih dibayar", "rp"), C("kasir", "Kasir")];
    rows = L.query(e.app, `SELECT s.created, s.number, COALESCE(o.number, '') AS dari,
        COALESCE((SELECT GROUP_CONCAT((-qty) || '× ' || name, ', ') FROM sale_items WHERE sale = s.id AND qty < 0), '') AS kembali,
        COALESCE((SELECT GROUP_CONCAT(qty || '× ' || name, ', ') FROM sale_items WHERE sale = s.id AND qty > 0), '') AS baru,
        s.total, COALESCE(NULLIF(u.name,''), u.username, '') AS kasir
        FROM sales s LEFT JOIN sales o ON o.id = s.ref_sale LEFT JOIN users u ON u.id = s.cashier
        WHERE s.kind = 'tukar' AND ${live} ORDER BY s.created`, r,
      { created: "", number: "", dari: "", kembali: "", baru: "", total: 0, kasir: "" });
  } else {
    throw new BadRequestError("Jenis laporan tidak dikenal.");
  }
  const totals = {};
  for (const c of columns) if (c.type === "rp" || c.type === "num") totals[c.key] = rows.reduce((a, x) => a + (x[c.key] || 0), 0);
  // Keep only the listed columns (profit stays server-side for admins).
  rows = rows.map((x) => { const o = {}; for (const c of columns) o[c.key] = x[c.key]; return o; });
  return e.json(200, { title, from: q.from, to: q.to, columns, rows, totals });
}, $apis.requireAuth("users"));

// ── pelanggan spending (for Mas Alin's bonuses; replaces points) ──
// GET /api/customers/spend — per pelanggan: total spent, transactions, last
// purchase and open bon. Owner/admin. Voided sales don't count; a bon sale
// counts as spending when it's made (the bon itself shows separately).
routerAdd("GET", "/api/customers/spend", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const rows = L.query(e.app, `SELECT s.customer AS id, SUM(s.total) AS total, COUNT(*) AS trx, MAX(s.created) AS last
      FROM sales s WHERE s.status != 'batal' AND s.customer != '' GROUP BY s.customer`, {}, { id: "", total: 0, trx: 0, last: "" });
  const bon = L.query(e.app, `SELECT customer AS id, SUM(amount - paid) AS bon FROM receivables WHERE status = 'belum' GROUP BY customer`, {}, { id: "", bon: 0 });
  const out = {};
  for (const r of rows) out[r.id] = { total: r.total, trx: r.trx, last: r.last, bon: 0 };
  for (const b of bon) (out[b.id] = out[b.id] || { total: 0, trx: 0, last: "", bon: 0 }).bon = b.bon;
  return e.json(200, out);
}, $apis.requireAuth("users"));

// GET /api/customers/{id}/summary?from=&to= — one pelanggan: spending all
// time, this month, this year and for the chosen period; open bon; recent
// purchases. Owner/admin.
routerAdd("GET", "/api/customers/{id}/summary", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const id = e.request.pathValue("id");
  let u;
  try { u = e.app.findRecordById("users", id); } catch (_) { throw new NotFoundError("Pelanggan tidak ditemukan."); }
  if (u.getString("role") !== "pelanggan") throw new NotFoundError("Pelanggan tidak ditemukan.");
  const q = e.requestInfo().query;
  const today = L.wibDate();
  const span = (from, to) => {
    const r = L.wibRange(from, to);
    return L.query(e.app, `SELECT COALESCE(SUM(s.total),0) AS total, COUNT(*) AS trx,
        COALESCE(SUM((SELECT SUM(qty) FROM sale_items WHERE sale = s.id)),0) AS items
        FROM sales s WHERE s.customer = {:c} AND s.status != 'batal' AND s.created >= {:from} AND s.created < {:to}`,
      { c: id, from: r.from, to: r.to }, { total: 0, trx: 0, items: 0 })[0];
  };
  const all = L.query(e.app, `SELECT COALESCE(SUM(s.total),0) AS total, COUNT(*) AS trx,
      COALESCE(SUM((SELECT SUM(qty) FROM sale_items WHERE sale = s.id)),0) AS items, COALESCE(MIN(s.created),'') AS first, COALESCE(MAX(s.created),'') AS last
      FROM sales s WHERE s.customer = {:c} AND s.status != 'batal'`, { c: id }, { total: 0, trx: 0, items: 0, first: "", last: "" })[0];
  const bon = L.query(e.app, `SELECT rc.id, s.number, s.created, rc.amount, rc.paid, COALESCE(rc.due_date,'') AS due
      FROM receivables rc JOIN sales s ON s.id = rc.sale WHERE rc.customer = {:c} AND rc.status = 'belum' ORDER BY s.created`,
    { c: id }, { id: "", number: "", created: "", amount: 0, paid: 0, due: "" });
  const recent = L.query(e.app, `SELECT s.id, s.number, s.created, s.total, s.paid, s.status, COALESCE(s.kind,'') AS kind,
      COALESCE((SELECT SUM(qty) FROM sale_items WHERE sale = s.id),0) AS items
      FROM sales s WHERE s.customer = {:c} ORDER BY s.created DESC LIMIT 30`,
    { c: id }, { id: "", number: "", created: "", total: 0, paid: 0, status: "", kind: "", items: 0 });
  return e.json(200, {
    all,
    month: span(today.slice(0, 8) + "01", today),
    year: span(today.slice(0, 5) + "01-01", today),
    period: q.from && q.to ? span(q.from, q.to) : null,
    bon, bon_total: bon.reduce((a, b) => a + b.amount - b.paid, 0), recent,
  });
}, $apis.requireAuth("users"));

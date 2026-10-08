#!/usr/bin/env python3
"""Check a kasir database after the old-system import.

  check.py <data.db> <expected.json> [--live <live data.db>]

Prints one PASS/FAIL line per check against expected.json (in the private data
folder) and exits 1 on any FAIL. With --live it also compares the imported
collections with another database, opened read-only, to prove the import
reproduces it. Only counts and sums are printed, never names or phones.
"""
import hashlib, json, os, sqlite3, sys

def open_ro(path):
    return sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)

def one(db, sql):
    return db.execute(sql).fetchone()

def checks(db, want, storage):
    c = []
    add = lambda label, got, exp: c.append((label, got, exp))
    add("categories", one(db, "SELECT COUNT(*) FROM categories")[0], want["categories"])
    p = one(db, "SELECT COUNT(*), SUM(active), SUM(stock), SUM(stock*hpp), SUM(stock*price) FROM products")
    w = want["products"]
    add("products", p[0], w["count"]); add("products active", p[1], w["active"]); add("stock (pcs)", p[2], w["stock"])
    add("stock x HPP", p[3], w["stock_hpp"]); add("stock x price", p[4], w["stock_price"])
    m = one(db, "SELECT COUNT(*), SUM(qty), SUM(type='opname'), SUM(qty=stock_after) FROM stock_moves")
    add("stock moves (1 opname per product)", (m[0], m[2], m[3]), (w["count"],) * 3)
    add("stock ledger = product stock", m[1], w["stock"])
    if "kodian" in want:
        add("kodian prices (count / sum)", one(db, "SELECT SUM(price_kodi > 0), SUM(price_kodi) FROM products WHERE active"),
            (want["kodian"]["with_price"], want["kodian"]["sum"]))
    add("pelanggan", one(db, "SELECT COUNT(*) FROM users WHERE role='pelanggan' AND username != 'cus0130'")[0], want["customers"])
    add("pelanggan disabled", one(db, "SELECT COUNT(*) FROM users WHERE role='pelanggan' AND disabled")[0], 0)
    add("karyawan (active)", one(db, "SELECT COUNT(*), SUM(active) FROM employees"), (want["employees"],) * 2)
    e = want["expenses"]
    add("pengeluaran", one(db, "SELECT COUNT(*), SUM(amount) FROM expenses"), (e["count"], e["total"]))
    for cat, (n, total) in e["by_category"].items():
        add(f"  {cat}", one(db, f"SELECT COUNT(*), SUM(amount) FROM expenses WHERE category = '{cat}'"), (n, total))
    add("pengeluaran Tabungan (moved to Buku Kas)", one(db, "SELECT COUNT(*) FROM expenses WHERE category='Tabungan'")[0], 0)
    t = want["tabungan"]
    add("Buku Kas Tabungan (keluar)", one(db, "SELECT COUNT(*), SUM(amount) FROM cash_entries WHERE type='keluar' AND note LIKE 'Tabungan%'"), (t["count"], t["total"]))
    add("expense days", one(db, "SELECT COUNT(DISTINCT d) FROM (SELECT substr(date,1,10) d FROM expenses UNION ALL SELECT substr(date,1,10) FROM cash_entries)")[0], want["expense_days"])
    add("dates at 00:00Z", one(db, "SELECT COUNT(*) FROM (SELECT date FROM expenses UNION ALL SELECT date FROM cash_entries) WHERE date NOT LIKE '% 00:00:00.000Z'")[0], 0)
    add("all paid Tunai", one(db, "SELECT COUNT(*) FROM (SELECT payment_method pm FROM expenses UNION ALL SELECT payment_method FROM cash_entries) x JOIN payment_methods m ON m.id = x.pm WHERE m.name != 'Tunai'")[0], 0)
    add("cash out total", one(db, "SELECT (SELECT SUM(amount) FROM expenses) + (SELECT SUM(amount) FROM cash_entries WHERE type='keluar')")[0], want["cash_out_total"])
    l = want["legacy_sales"]
    sim = one(db, "SELECT COUNT(*) FROM sales WHERE note LIKE 'Sistem lama%'")[0]
    if not sim:
        l = want["legacy_sales"]
        add("sistem lama days", one(db, "SELECT COUNT(*), MIN(day), MAX(day) FROM legacy_sales"), (l["days"], l["first"], l["last"]))
        add("sistem lama sales / trx / items / profit", one(db, "SELECT SUM(total), SUM(count), SUM(items), SUM(profit) FROM legacy_sales"),
            (l["total"], l["count"], l["items"], l["profit"]))
        for kind, w in want["legacy_totals"].items():
            r = one(db, f"SELECT COUNT(*), SUM(total), SUM(trx), SUM(items), SUM(profit) FROM legacy_totals WHERE kind='{kind}'")
            got = {"rows": r[0], "total": r[1], "trx": r[2], "items": r[3], "profit": r[4]}
            keys = [k for k in ("rows", "total", "trx", "items", "profit") if k in w]
            add(f"sistem lama per {kind}", tuple(got[k] for k in keys), tuple(w[k] for k in keys))
        w = want["legacy_totals"]["pelanggan"]
        add("  coded pelanggan", one(db, "SELECT COUNT(*), SUM(total), SUM(trx) FROM legacy_totals WHERE kind='pelanggan' AND ref != ''"),
            (w["coded_rows"], w["coded_total"], w["coded_trx"]))
        add("  refs point at real records", one(db, """SELECT COUNT(*) FROM legacy_totals lt WHERE
            (kind='pelanggan' AND ref != '' AND ref NOT IN (SELECT id FROM users WHERE role='pelanggan')) OR
            (kind='karyawan' AND ref != 'toko' AND ref NOT IN (SELECT id FROM employees)) OR
            (kind='produk' AND ref NOT IN (SELECT id FROM products))""")[0], 0)
        add("sales (none from the old system)", one(db, "SELECT COUNT(*) FROM sales")[0], 0)

    else:
        # The old history as simulated receipts (gen_sales.py): same totals, from the rows.
        w = want["simulated_sales"]
        add("receipts (sistem lama)", (sim, one(db, "SELECT COUNT(*) FROM sales")[0]), (w["receipts"], w["receipts"]))
        add("summary tables emptied", one(db, "SELECT (SELECT COUNT(*) FROM legacy_sales) + (SELECT COUNT(*) FROM legacy_totals)")[0], 0)
        add("days / first / last", one(db, "SELECT COUNT(DISTINCT date(datetime(created,'+7 hours'))), MIN(date(datetime(created,'+7 hours'))), MAX(date(datetime(created,'+7 hours'))) FROM sales"),
            (l["days"], l["first"], l["last"]))
        add("omzet / trx / items / laba", one(db, """SELECT (SELECT SUM(total) FROM sales), (SELECT COUNT(*) FROM sales), SUM(qty), SUM(subtotal - hpp * qty) FROM sale_items"""),
            (l["total"], l["count"], l["items"], l["profit"]))
        lt = want["legacy_totals"]
        add("per karyawan rows / omzet", one(db, "SELECT COUNT(DISTINCT employee), SUM(total) FROM sales"), (lt["karyawan"]["rows"], lt["karyawan"]["total"]))
        add("coded pelanggan rows / omzet / trx", one(db, "SELECT COUNT(DISTINCT customer), SUM(total), COUNT(*) FROM sales WHERE customer != ''"),
            (lt["pelanggan"]["coded_rows"], lt["pelanggan"]["coded_total"], lt["pelanggan"]["coded_trx"]))
        add("products sold", one(db, "SELECT COUNT(DISTINCT product), SUM(qty) FROM sale_items"), (lt["produk"]["rows"], lt["produk"]["items"]))
        add("no line below cost", one(db, "SELECT COUNT(*) FROM sale_items WHERE subtotal < hpp * qty OR qty < 1")[0], 0)
        add("bon count / amount / lunas", one(db, "SELECT COUNT(*), SUM(amount), SUM(paid), SUM(status='lunas') FROM receivables"),
            (w["bon_count"], w["bon_total"], w["bon_total"], w["bon_count"]))
        add("bon paid Tunai / Transfer", one(db, """SELECT SUM(CASE m.name WHEN 'Tunai' THEN rp.amount END), SUM(CASE m.name WHEN 'Transfer' THEN rp.amount END)
            FROM receivable_payments rp JOIN payment_methods m ON m.id = rp.payment_method"""), (w["bon_paid_tunai"], w["bon_paid_transfer"]))
        add("bon sales: nothing paid at the till", one(db, "SELECT COUNT(*) FROM sales s JOIN receivables r ON r.sale = s.id WHERE s.paid != 0 OR EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale = s.id)")[0], 0)
        add("till + bon payments = omzet", one(db, "SELECT (SELECT SUM(amount) FROM sale_payments) + (SELECT SUM(amount) FROM receivable_payments)")[0], w["cash_in"])
        add("Buku Kas closing", one(db, """SELECT (SELECT SUM(amount) FROM sale_payments) + (SELECT SUM(amount) FROM receivable_payments)
            - (SELECT SUM(amount) FROM expenses) - (SELECT SUM(amount) FROM cash_entries WHERE type='keluar') + (SELECT COALESCE(SUM(amount),0) FROM cash_entries WHERE type='masuk')""")[0], w["closing"])
        add("stock not moved by them", one(db, "SELECT COUNT(*) FROM stock_moves WHERE type != 'opname'")[0], 0)
    add("active payment methods", one(db, "SELECT GROUP_CONCAT(name) FROM (SELECT name FROM payment_methods WHERE active ORDER BY name)")[0], "Transfer,Tunai")
    s = one(db, "SELECT phone, email, logo, id FROM settings")
    add("settings phone / email", (s[0], s[1]), (want["settings"]["phone"], want["settings"]["email"]))
    logo = ""
    if s[2]:
        cid = one(db, "SELECT id FROM _collections WHERE name='settings'")[0]
        f = os.path.join(storage, cid, s[3], s[2])
        if os.path.exists(f):
            logo = hashlib.sha256(open(f, "rb").read()).hexdigest()
    add("struk logo (sha256)", logo, want["settings"]["logo_sha256"])
    return c

# Collections the import owns, compared with another database (e.g. live).
COMPARE = [
    ("categories", "SELECT COUNT(*), GROUP_CONCAT(name) FROM (SELECT name FROM categories ORDER BY name)"),
    # stock is left out: on live it moves with every sale; the opening stock is compared below
    ("products", "SELECT COUNT(*), GROUP_CONCAT(k) FROM (SELECT p.sku || '|' || p.name || '|' || c.name || '|' || p.unit || '|' || p.hpp || '|' || p.price || '|' || p.active AS k "
        "FROM products p LEFT JOIN categories c ON c.id = p.category ORDER BY p.sku)"),
    ("opening stock moves", "SELECT COUNT(*), GROUP_CONCAT(k) FROM (SELECT p.sku || '|' || m.qty AS k FROM stock_moves m JOIN products p ON p.id = m.product WHERE m.type='opname' ORDER BY 1)"),
    ("pelanggan", "SELECT COUNT(*), GROUP_CONCAT(u) FROM (SELECT username || '|' || name || '|' || phone || '|' || address AS u FROM users WHERE role='pelanggan' ORDER BY username)"),
    ("karyawan", "SELECT COUNT(*), GROUP_CONCAT(n) FROM (SELECT name || '|' || phone AS n FROM employees ORDER BY name)"),
    ("pengeluaran", "SELECT COUNT(*), SUM(amount), GROUP_CONCAT(k) FROM (SELECT amount, substr(date,1,10) || category || amount || note AS k FROM expenses ORDER BY 2)"),
    ("Buku Kas manual", "SELECT COUNT(*), SUM(amount), GROUP_CONCAT(k) FROM (SELECT amount, substr(date,1,10) || type || amount || note AS k FROM cash_entries ORDER BY 2)"),
    ("sistem lama days", "SELECT COUNT(*), GROUP_CONCAT(k) FROM (SELECT day || total || count || items || discount || profit AS k FROM legacy_sales ORDER BY day)"),
    ("sistem lama totals", "SELECT COUNT(*), GROUP_CONCAT(k) FROM (SELECT lt.kind || COALESCE(u.username, e.name, p.sku, lt.ref) || lt.total || lt.trx || lt.items || lt.profit AS k FROM legacy_totals lt "
        "LEFT JOIN users u ON u.id = lt.ref LEFT JOIN employees e ON e.id = lt.ref LEFT JOIN products p ON p.id = lt.ref ORDER BY 1)"),
    ("struk settings", "SELECT receipt_header || phone || email FROM settings"),
]

def main():
    args = sys.argv[1:]
    live = None
    if "--live" in args:
        i = args.index("--live"); live = args[i + 1]; del args[i:i + 2]
    db_path, exp_path = args
    want = json.load(open(exp_path))
    db = open_ro(db_path)
    rows = checks(db, want, os.path.join(os.path.dirname(os.path.abspath(db_path)), "storage"))
    fails = 0
    print(f"{'check':44} result")
    for label, got, exp in rows:
        ok = got == exp
        fails += not ok
        print(f"{label:44} {'PASS' if ok else 'FAIL'}" + ("" if ok else f"  got {got}, expected {exp}"))
    if live:
        ldb = open_ro(live)
        print(f"\n{'same as ' + live:44}")
        sim = one(db, "SELECT COUNT(*) FROM sales WHERE note LIKE 'Sistem lama%'")[0]
        sim_live = one(ldb, "SELECT COUNT(*) FROM sales WHERE note LIKE 'Sistem lama%'")[0]
        for label, sql in COMPARE:
            if bool(sim) != bool(sim_live) and label.startswith("sistem lama"):
                print(f"{label:44} skipped (now receipts here)"); continue
            a, b = one(db, sql), one(ldb, sql)
            ok = a == b
            fails += not ok
            print(f"{label:44} {'SAME' if ok else 'DIFFERENT'}" + ("" if ok else f"  (count {a[0]} vs {b[0]})"))
    print(f"\n{len(rows) + (len(COMPARE) if live else 0) - fails} passed, {fails} failed")
    sys.exit(1 if fails else 0)

main()

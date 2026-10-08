#!/usr/bin/env python3
"""Rebuild the old-system receipts from the old system's own receipt list.

  rebuild_real.py <data.db> <data folder> <cashflow.html> [--seed N] [--dry-run]

gen_sales.py had only totals, so every "Sistem lama" receipt's amount,
pelanggan and time were invented. The old system's Laporan Kas (cashflow page,
saved privately) lists every sale: TRX number, day, pelanggan ("a/n …"),
amount and Tunai/Transfer. With it, every receipt TRX0001…TRX32160 gets its
REAL number, day, pelanggan, amount and method; bons keep their real data from
piutang.txt. Still invented (no report has them): the items on each receipt,
the karyawan and the time. They are fitted so the totals per day, pelanggan,
karyawan and produk (count, items, omzet, laba) still match the old reports
exactly.

Only "Sistem lama" receipts up to the last one in the old reports are replaced
(with their items, payments and bons). Sales made in the kasir, pre-orders and
everything else stay. Afterwards run add_cashflow_extra.py again (sales after
the import, the old return, bon payment days). Don't run fix_methods.py after
this: the methods are now the real ones.
"""
import html, os, random, re, sqlite3, sys
from collections import defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_sales as G

S_UNIT, F_UNIT = G.S_UNIT, G.F_UNIT
MARKER = G.MARKER


def parse_cashflow(path, last):
    s = open(path, encoding="utf-8").read()
    t = s[s.find("<table"):s.find("</table>")]
    cell = lambda c: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
    num = lambda x: int(x.replace(".", "") or 0)
    sec, sales = None, {}
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        d = [cell(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(d) == 1:
            sec = "Transfer" if d[0].startswith("Transfer") else "Tunai"; continue
        m = re.match(r"Penjualan #(TRX\d+) a/n (.*)$", d[1]) if len(d) > 2 else None
        if not m or int(m.group(1)[3:]) > last:
            continue
        dd, mm, yy = d[0].split("/")
        x = sales.setdefault(m.group(1), {"day": f"{yy}-{mm}-{dd}", "name": m.group(2).strip(), "Tunai": 0, "Transfer": 0})
        x[sec] += num(d[2])
    return sales


def main():
    db_path, folder, cf = sys.argv[1], sys.argv[2], sys.argv[3]
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261008
    dry = "--dry-run" in sys.argv
    rng = random.Random(seed)
    days, cust, emp, prod, bons, pays = G.parse(folder)
    D = {d[0]: d[1:] for d in days}
    tday = [d for d, (_, c, _, _) in sorted(D.items()) for _ in range(c)]
    T = len(tday)
    sales = parse_cashflow(cf, T)

    # pelanggan per name; a name used twice is settled by the old per-pelanggan counts
    codes = defaultdict(list)
    for l in open(os.path.join(folder, "data-induk.txt"), encoding="utf-8"):
        if l.startswith("CUS"):
            c, n = l.split("|")[:2]; codes[n.strip()].append(c.lower())
    left = {c: v[1] for c, v in cust.items()}
    for code, (_, c, _) in bons.items():
        left[c] -= 1
    def who(name):
        if name == "Toko":
            return ""
        cs = codes.get(name, [])
        assert cs, f"pelanggan {name!r} unknown"
        for c in cs:
            if left.get(c, 0) > 0:
                return c
        raise SystemExit(f"pelanggan {name!r}: more receipts than the old totals")

    # 1. every receipt pinned: day, pelanggan, amount (units of 500), method
    tcus, amt, meth = [None] * T, [0] * T, [None] * T
    for code, (day, c, a) in bons.items():
        t = int(code[3:]) - 1
        assert tday[t] == day
        tcus[t], amt[t], meth[t] = c, a // S_UNIT, "bon"
    for code, x in sales.items():
        t = int(code[3:]) - 1
        assert tday[t] == x["day"], f"{code} day"
        assert meth[t] is None, f"{code} is both a sale and a bon"
        c = who(x["name"]); left[c] -= 1
        a = x["Tunai"] + x["Transfer"]
        assert a % S_UNIT == 0
        tcus[t], amt[t] = c, a // S_UNIT
        meth[t] = ("Tunai", x["Tunai"]) if not x["Transfer"] else ("Transfer", x["Transfer"]) if not x["Tunai"] else ("Split", x["Tunai"], x["Transfer"])
    missing = [t for t in range(T) if meth[t] is None]
    assert not missing, f"{len(missing)} receipts not in the cashflow or bon list, e.g. TRX{missing[0] + 1:04d}"
    for c, v in cust.items():
        got = sum(amt[t] for t in range(T) if tcus[t] == c) * S_UNIT
        assert got == v[0], f"pelanggan {c or 'Toko'}: cashflow {got} vs old totals {v[0]}"

    # 2. karyawan: exact count, then swaps until each one's omzet is exact
    target = {e: v[0] // S_UNIT for e, v in emp.items()}
    # A karyawan with only a few old receipts gets receipts whose amounts add up
    # exactly to their old omzet first; those receipts stay out of the swaps.
    temp, locked = [None] * T, set()
    for e, v in sorted(emp.items(), key=lambda kv: kv[1][1]):
        if v[1] > 3:
            continue
        free = [t for t in range(T) if temp[t] is None]
        found = None
        if v[1] == 1:
            found = next(([t] for t in free if amt[t] == target[e]), None)
        else:
            for _ in range(200000):
                pick = rng.sample(free, v[1] - 1)
                rest_amt = target[e] - sum(amt[t] for t in pick)
                last = next((t for t in free if amt[t] == rest_amt and t not in pick), None)
                if last is not None:
                    found = pick + [last]; break
        assert found, f"karyawan {e or 'Toko'}: no receipts add up to the old omzet"
        for t in found:
            temp[t] = e; locked.add(t)
    # Parity: almost every amount is a whole Rp 1.000; a karyawan whose old omzet
    # ends in 500 needs an odd number of the few x.500 receipts. Hand them out first.
    odd = [t for t in range(T) if temp[t] is None and amt[t] % 2]
    need = [e for e, v in emp.items() if v[1] > 3 and target[e] % 2]
    assert len(odd) >= len(need) and (len(odd) - len(need)) % 2 == 0, "x.500 receipts don't fit the karyawan totals"
    rng.shuffle(odd)
    for e in need:
        t = odd.pop(); temp[t] = e; locked.add(t)
    while odd:                                       # any extra ones in pairs to the biggest karyawan
        big = max((e for e, v in emp.items() if v[1] > 3), key=lambda e: emp[e][1])
        for _ in range(2):
            t = odd.pop(); temp[t] = big; locked.add(t)
    taken = defaultdict(int)
    for t in locked:
        taken[temp[t]] += 1
    pool = [e for e, v in emp.items() if v[1] > 3 for _ in range(v[1] - taken[e])]; rng.shuffle(pool)
    it = iter(pool)
    temp = [x if x is not None else next(it) for x in temp]
    have = defaultdict(int)
    for t in range(T):
        have[temp[t]] += amt[t]
    by_e = defaultdict(lambda: defaultdict(list))
    for t in range(T):
        if t not in locked:
            by_e[temp[t]][amt[t]].append(t)
    def swap(a, b):
        ea, eb = temp[a], temp[b]
        by_e[ea][amt[a]].remove(a); by_e[eb][amt[b]].remove(b)
        temp[a], temp[b] = eb, ea
        by_e[eb][amt[a]].append(a); by_e[ea][amt[b]].append(b)
        have[ea] += amt[b] - amt[a]; have[eb] += amt[a] - amt[b]
    for _ in range(200000):
        res = {e: target[e] - have[e] for e in target}
        give = [e for e in res if res[e] < 0]; take = [e for e in res if res[e] > 0]
        if not give:
            break
        f = min(give, key=lambda e: res[e]); e = max(take, key=lambda e: res[e])
        d = min(-res[f], res[e])        # move d units of omzet from f to e
        best = None
        for a_amt, lst in by_e[f].items():
            if not lst:
                continue
            want = a_amt - d             # exact: give a (a_amt), take b (a_amt - d)
            if want >= 1 and by_e[e].get(want):
                best = (lst[0], by_e[e][want][0]); break
        if best is None:                 # no exact pair: the biggest move that doesn't overshoot
            gap, best = None, None
            for a_amt, lst in by_e[f].items():
                if not lst:
                    continue
                for b_amt, lst2 in by_e[e].items():
                    if lst2 and 0 < a_amt - b_amt <= d and (gap is None or a_amt - b_amt > gap):
                        gap, best = a_amt - b_amt, (lst[0], lst2[0])
            if best is None:
                raise SystemExit(f"karyawan omzet: no swap left; residuals {res}, d={d}, f={f!r}, e={e!r}, pool sizes {[(k, sum(len(v) for v in by_e[k].values())) for k in target]}")
        swap(*best)
    assert all(have[e] == target[e] for e in target), "karyawan omzet did not reconcile"

    # 3. items per receipt: from the pelanggan's average price, then exact per
    # pelanggan, karyawan and day (moves that keep the other two totals)
    avgc = {c: v[0] / v[2] for c, v in cust.items()}
    x = [max(1, round(amt[t] * S_UNIT / avgc[tcus[t]])) for t in range(T)]
    of_c = defaultdict(list)
    for t in range(T):
        of_c[tcus[t]].append(t)
    for c, ts in of_c.items():                      # each pelanggan on its exact item count
        ts.sort(key=lambda t: -amt[t])
        diff, k = cust[c][2] - sum(x[t] for t in ts), 0
        assert cust[c][2] >= len(ts), f"pelanggan {c}: fewer items than receipts"
        while diff:
            t = ts[k % len(ts)]
            if diff > 0: x[t] += 1; diff -= 1
            elif x[t] > 1: x[t] -= 1; diff += 1
            k += 1
    one = [1] * T
    # never more pcs than the amount pays for at the cheapest price (~Rp 6.000)
    cap = [max(1, amt[t] * S_UNIT // 6000) for t in range(T)]
    for c, ts in of_c.items():
        over = sum(max(0, x[t] - cap[t]) for t in ts)
        for t in ts:
            if x[t] > cap[t]: x[t] = cap[t]
        for t in ts:                                 # put the trimmed pcs on receipts with room
            room = cap[t] - x[t]; d = min(room, over); x[t] += d; over -= d
        assert over == 0, f"pelanggan {c}: items don't fit their receipts"
    def grp(*dims):
        g = defaultdict(list)
        for t in range(T):
            g[tuple(dd[t] for dd in dims)].append(t)
        return list(g.values())
    tc, td, te = {c: v[2] for c, v in cust.items()}, {d: v[2] for d, v in D.items()}, {e: v[2] for e, v in emp.items()}
    for _ in range(40):
        r1 = G.fix(x, tcus, tc, grp(tday, temp) + grp(tday), one, cap, rng=rng)
        r2 = G.fix(x, temp, te, grp(tcus, tday) + grp(tcus), one, cap, rng=rng)
        r3 = G.fix(x, tday, td, grp(tcus, temp) + grp(tcus), one, cap, rng=rng)
        if not (r1 or r2 or r3):
            break
    rest = G.fix(x, tcus, tc, grp(tday, temp), one, cap) + G.fix(x, temp, te, grp(tcus, tday), one, cap) + G.fix(x, tday, td, grp(tcus, temp), one, cap)
    if rest:
        def off(ent, tg):
            cur = defaultdict(int)
            for t in range(T): cur[ent[t]] += x[t]
            return {k: tg.get(k, 0) - cur[k] for k in set(cur) | set(tg) if tg.get(k, 0) != cur[k]}
        oc, oe, od = off(tcus, tc), off(temp, te), off(tday, td)
        print("items off: pelanggan", list(oc.items())[:8], "karyawan", oe, "days", list(od.items())[:8])
    assert rest == 0, f"items: {rest} left over"

    # 4. lines: each product's items in bundles of its old transaction count, dealt out
    bundles = []
    for p, (_, trx, items, _) in prod.items():
        k = min(trx, items); base, extra = divmod(items, k)
        bundles += [(p, base + (1 if i < extra else 0)) for i in range(k)]
    rng.shuffle(bundles)
    order = list(range(T)); rng.shuffle(order)
    lines = defaultdict(int)
    bi, brest = 0, bundles[0][1]
    for t in order:
        need = x[t]
        while need:
            take = min(need, brest)
            lines[(t, bundles[bi][0])] += take
            need -= take; brest -= take
            if not brest and bi + 1 < len(bundles):
                bi += 1; brest = bundles[bi][1]
    keys = list(lines); qty = [lines[k] for k in keys]; n = len(keys)
    lt = [k[0] for k in keys]; lp = [k[1] for k in keys]
    ld = [tday[t] for t in lt]; lc = [tcus[t] for t in lt]; le = [temp[t] for t in lt]
    avg = {p: v[0] / v[2] / S_UNIT for p, v in prod.items()}
    margin = {p: v[3] / v[0] for p, v in prod.items()}

    # 5. line amounts: every receipt's real total and every product's total
    tg_t = {t: amt[t] for t in range(T)}
    tg_p = {p: v[0] // S_UNIT for p, v in prod.items()}
    s = G.ipf([qty[i] * avg[lp[i]] for i in range(n)], [lt, lp], [tg_t, tg_p])
    lo = [max(1, qty[i] // 4) for i in range(n)]
    s = [max(lo[i], int(round(s[i]))) for i in range(n)]
    by_t = defaultdict(list)
    for i in range(n):
        by_t[lt[i]].append(i)
    for t, ix in by_t.items():                       # each receipt back on its exact total
        diff = amt[t] - sum(s[i] for i in ix)
        k = 0
        while diff:
            i = ix[k % len(ix)]
            if diff > 0: s[i] += 1; diff -= 1
            elif s[i] > lo[i]: s[i] -= 1; diff += 1
            k += 1
            if k > 10 ** 7: raise SystemExit(f"receipt {t + 1} can't reach its total")
    rest = G.fix(s, lp, tg_p, [ix for ix in by_t.values()], lo, rng=rng)   # products, within receipts
    assert rest == 0, f"line amounts: products {rest} off"
    for t, ix in by_t.items():
        assert sum(s[i] for i in ix) == amt[t]

    # 6. laba per line: exact per day, pelanggan, karyawan and produk (as gen_sales)
    tg_f = [{d: v[3] // F_UNIT for d, v in D.items()}, {c: v[3] // F_UNIT for c, v in cust.items()},
            {e: v[3] // F_UNIT for e, v in emp.items()}, {p: v[3] // F_UNIT for p, v in prod.items()}]
    dims = [ld, lc, le, lp]
    hi = [s[i] * 10 - qty[i] for i in range(n)]
    f = G.ipf([s[i] * 10 * margin[lp[i]] for i in range(n)], dims, tg_f)
    f = [min(hi[i], max(0, int(round(f[i])))) for i in range(n)]
    zero = [0] * n
    for p, ks in defaultdict(list, {}).items():
        pass
    lines_of = defaultdict(list)
    for i in range(n):
        lines_of[lp[i]].append(i)
    for p, ks in lines_of.items():                   # rounding: products back on their exact laba
        diff = tg_f[3][p] - sum(f[i] for i in ks); k = 0
        while diff:
            i = ks[k % len(ks)]
            if diff > 0 and f[i] < hi[i]: f[i] += 1; diff -= 1
            elif diff < 0 and f[i] > 0: f[i] -= 1; diff += 1
            k += 1
            if k > 10 ** 7: raise SystemExit(f"product {p}: laba doesn't fit")
    def groups(*ds):
        g = defaultdict(list)
        for i in range(n):
            g[tuple(d_[i] for d_ in ds)].append(i)
        return list(g.values())
    for _ in range(8):
        G.fix(f, lp, tg_f[3], groups(lt), zero, hi, rng)
        G.fix(f, lc, tg_f[1], groups(lp, ld, le) + groups(lp, le) + groups(lp), zero, hi, rng)
        G.fix(f, le, tg_f[2], groups(lp, lc, ld) + groups(lp, lc), zero, hi, rng)
        G.fix(f, ld, tg_f[0], groups(lp, lc, le), zero, hi, rng)
        sums = [defaultdict(int) for _ in range(4)]
        for i in range(n):
            for j, d_ in enumerate(dims):
                sums[j][d_[i]] += f[i]
        offs = [sum(abs(sums[j][k] - tg[k]) for k in tg) for j, tg in enumerate(tg_f)]
        if not sum(offs):
            break
    else:
        raise SystemExit(f"laba did not reconcile: {offs}")

    # 7. rows
    def rid():
        return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(15))
    items_by_t = defaultdict(list)
    for i in range(n):
        S_, C_, q = s[i] * S_UNIT, s[i] * S_UNIT - f[i] * F_UNIT, qty[i]
        p0, r1 = divmod(S_, q); h0, r2 = divmod(C_, q)
        cuts = sorted({0, r1, r2, q})
        for a, b in zip(cuts, cuts[1:]):
            items_by_t[lt[i]].append((lp[i], b - a, p0 + (1 if a < r1 else 0), h0 + (1 if a < r2 else 0)))
    db = sqlite3.connect(db_path, timeout=60)
    q1 = lambda sql, *a: db.execute(sql, a).fetchone()
    # walk-in pelanggan "Toko" (settings.walkin_customer, 2026-10-08); "" before that migration
    cols = [r[1] for r in db.execute("PRAGMA table_info(settings)")]
    walk = (db.execute("SELECT walkin_customer FROM settings LIMIT 1").fetchone() or ("",))[0] if "walkin_customer" in cols else ""
    users = dict(db.execute("SELECT username, id FROM users WHERE role='pelanggan' AND id != ?", (walk,)))
    emps = dict(db.execute("SELECT name, id FROM employees"))
    prods = {nm: i for nm, i in db.execute("SELECT name, id FROM products")}
    methods = dict(db.execute("SELECT name, id FROM payment_methods"))
    for c in cust:
        assert not c or c in users, c
    for e in emp:
        assert not e or e in emps, e
    for p in prod:
        assert p in prods, p
    stamp = lambda day, sec: (datetime.strptime(day, "%Y-%m-%d") - timedelta(hours=7) + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + "Z"
    per_day = defaultdict(list)
    for t in range(T):
        per_day[tday[t]].append(t)
    when = {}
    for day, ts in per_day.items():
        secs = sorted(rng.randint(8 * 3600, 21 * 3600) * 1000 + rng.randint(0, 999) for _ in ts)
        for t, ms in zip(ts, secs):
            when[t] = ms / 1000
    cur = db.cursor()
    cur.execute("BEGIN")
    # replace only the old-system receipts TRX0001…TRXnnnn (and their bons)
    old = [r[0] for r in db.execute(f"SELECT id FROM sales WHERE note LIKE 'Sistem lama%' AND number GLOB 'TRX[0-9]*' AND CAST(substr(number,4) AS INTEGER) <= {T}")]
    db.execute("CREATE TEMP TABLE old_ids (id TEXT PRIMARY KEY)")
    db.executemany("INSERT INTO old_ids VALUES (?)", [(i,) for i in old])
    cur.execute("DELETE FROM receivable_payments WHERE receivable IN (SELECT id FROM receivables WHERE sale IN (SELECT id FROM old_ids))")
    cur.execute("DELETE FROM receivables WHERE sale IN (SELECT id FROM old_ids)")
    cur.execute("DELETE FROM sale_payments WHERE sale IN (SELECT id FROM old_ids)")
    cur.execute("DELETE FROM sale_items WHERE sale IN (SELECT id FROM old_ids)")
    cur.execute("DELETE FROM sales WHERE id IN (SELECT id FROM old_ids)")
    code_of = {int(c[3:]) - 1: c for c in bons}
    for t in range(T):
        created = stamp(tday[t], when[t])
        total = sum(qn * pr for _, qn, pr, _ in items_by_t[t])
        assert total == amt[t] * S_UNIT
        bon = meth[t] == "bon"
        main_m = "" if bon else methods["Transfer" if meth[t][0] == "Transfer" or (meth[t][0] == "Split" and meth[t][2] >= meth[t][1]) else "Tunai"]
        sid = rid()
        # cashier left empty: the old system's cashier isn't known (shown as Toko)
        cur.execute("""INSERT INTO sales (id, number, cashier, customer, subtotal, discount, voucher, points_used, total, paid, change,
            payment_method, status, points_earned, note, created, updated, kind, ref_sale, employee)
            VALUES (?,?,'',?,?,0,'',0,?,?,0,?,'lunas',0,?,?,?,'jual','',?)""",
            (sid, f"TRX{t + 1:04d}", users.get(tcus[t], walk), total, total, 0 if bon else total, main_m, MARKER, created, created, emps.get(temp[t], "")))
        for p, qn, pr, hp in items_by_t[t]:
            cur.execute("""INSERT INTO sale_items (id, sale, product, name, qty, price, hpp, subtotal, created, updated, tier)
                VALUES (?,?,?,?,?,?,?,?,?,?,'normal')""", (rid(), sid, prods[p], p, qn, pr, hp, qn * pr, created, created))
        if not bon:
            parts = [("Tunai", meth[t][1]), ("Transfer", meth[t][2])] if meth[t][0] == "Split" else [(meth[t][0], meth[t][1])]
            for mname, a in parts:
                cur.execute("INSERT INTO sale_payments (id, sale, payment_method, amount, by, created, updated) VALUES (?,?,?,?,'',?,?)",
                            (rid(), sid, methods[mname], a, created, created))
            continue
        rcid = rid()
        cur.execute("""INSERT INTO receivables (id, sale, customer, amount, paid, status, due_date, created, updated)
            VALUES (?,?,?,?,?,'lunas','',?,?)""", (rcid, sid, users.get(tcus[t], walk), total, total, created, created))
        for k, (pday, a, m) in enumerate(pays[code_of[t]]):
            at = stamp(pday, max(when[t] + 60 * (k + 1), 9 * 3600) if pday == tday[t] else 10 * 3600 + 60 * k)
            cur.execute("""INSERT INTO receivable_payments (id, receivable, amount, payment_method, by, note, created, updated)
                VALUES (?,?,?,?,'',?,?,?)""", (rid(), rcid, a, methods["Transfer" if m == "Transfer" else "Tunai"], MARKER, at, at))

    # 8. reconciliation, read back inside the transaction
    bad = 0
    def report(label, ok, extra=""):
        nonlocal bad
        bad += not ok
        print(f"{label:46} {'PASS' if ok else 'FAIL'} {extra}")
    W = f"s.note LIKE 'Sistem lama%' AND s.number GLOB 'TRX[0-9]*' AND CAST(substr(s.number,4) AS INTEGER) <= {T}"
    rows = {r[0]: r[1:] for r in db.execute(f"""SELECT s.number, date(datetime(s.created,'+7 hours')), COALESCE(u.username,''), s.total,
        COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN payment_methods m ON m.id = sp.payment_method WHERE sp.sale = s.id AND m.name = 'Tunai'),0),
        COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN payment_methods m ON m.id = sp.payment_method WHERE sp.sale = s.id AND m.name = 'Transfer'),0)
        FROM sales s LEFT JOIN users u ON u.id = s.customer AND u.id != '{walk}' WHERE {W}""")}
    wrong = []
    for code, x in sales.items():
        r = rows.get(code)
        want = (x["day"], who_check(x["name"], codes), x["Tunai"] + x["Transfer"], x["Tunai"], x["Transfer"]) if False else None
        if not r or r[0] != x["day"] or r[2] != x["Tunai"] + x["Transfer"] or r[3] != x["Tunai"] or r[4] != x["Transfer"] or (x["name"] == "Toko") != (r[1] == ""):
            wrong.append(code)
    report(f"every receipt = Laporan Kas ({len(sales)})", not wrong, f"{len(wrong)} differ {wrong[:3]}" if wrong else "")
    named_wrong = [c for c, x in sales.items() if x["name"] != "Toko" and rows[c][1] not in codes[x["name"]]]
    report("pelanggan on each receipt = a/n name", not named_wrong, str(named_wrong[:3]))
    for code, (day, c, a) in bons.items():
        r = rows.get(code)
        if not r or r[0] != day or r[2] != a or r[1] != c:
            wrong.append(code)
    report(f"bons keep number, day, pelanggan, amount ({len(bons)})", not wrong)
    def agg(key):
        return {r[0]: r[1:] for r in db.execute(f"""SELECT {key}, COUNT(DISTINCT s.id), SUM(i.qty), SUM(i.subtotal), SUM(i.subtotal - i.hpp * i.qty)
            FROM sale_items i JOIN sales s ON s.id = i.sale LEFT JOIN users u ON u.id = s.customer AND u.id != '{walk}' LEFT JOIN employees e ON e.id = s.employee
            LEFT JOIN products p ON p.id = i.product WHERE {W} GROUP BY 1""")}
    def compare(label, got, want, fields):
        diff = sum(1 for k in want if tuple(got.get(k, (0, 0, 0, 0))[j] for j in fields) != tuple(want[k][j] for j in fields))
        report(label, not diff and not (set(got) - set(want)), f"{diff} differ" if diff else "")
    compare("per day: trx / items / omzet / laba", agg("date(datetime(s.created, '+7 hours'))"), {d: (v[1], v[2], v[0], v[3]) for d, v in D.items()}, (0, 1, 2, 3))
    compare("per pelanggan: trx / items / omzet / laba", agg("COALESCE(u.username, '')"), {c: (v[1], v[2], v[0], v[3]) for c, v in cust.items()}, (0, 1, 2, 3))
    compare("per karyawan: trx / items / omzet / laba", agg("COALESCE(e.name, '')"), {e: (v[1], v[2], v[0], v[3]) for e, v in emp.items()}, (0, 1, 2, 3))
    compare("per produk: items / omzet / laba", agg("p.name"), {p: (v[1], v[2], v[0], v[3]) for p, v in prod.items()}, (1, 2, 3))
    below = q1(f"SELECT COUNT(*) FROM sale_items i JOIN sales s ON s.id = i.sale WHERE {W} AND (i.subtotal < i.hpp * i.qty OR i.qty < 1)")[0]
    report("no line below cost", below == 0)
    if bad or dry:
        db.rollback()
        print("rolled back" + (" (dry run)" if dry and not bad else ""))
        sys.exit(1 if bad else 0)
    db.commit()
    print(f"rebuilt {T} receipts from Laporan Kas ({len(sales)} sales + {len(bons)} bons), seed {seed}")


def who_check(name, codes):
    return ""

if __name__ == "__main__":
    main()

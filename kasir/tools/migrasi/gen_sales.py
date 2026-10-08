#!/usr/bin/env python3
"""Simulated per-receipt sales for the old system's history.

  gen_sales.py <data.db> <data folder> [--seed N]

The old system exported totals only: per day (laporan-penjualan.txt), per
pelanggan, karyawan and produk (total-per-pelanggan-karyawan-produk.txt),
plus the real bon list (piutang.txt). This writes receipts (sales, sale_items,
sale_payments, receivables, receivable_payments) that add up EXACTLY to every
one of those totals: count, items, omzet and laba per day, pelanggan, karyawan
and produk.

- Receipts are numbered like the old system, TRX0001… in date order; a bon
  keeps its real number, day, pelanggan and amount, with its real payments
  (T = Tunai, B = Transfer; the old "U" method is counted as Tunai).
- Other receipts are paid Tunai at the till, so Buku Kas gets the old sales.
- Which items sit on which receipt, the times and the karyawan of a bon are
  invented, deterministic for a seed. Every receipt carries the note
  "Sistem lama (rincian disimulasikan)".
- Stock does not move: products already hold the old system's final count.
- legacy_sales and legacy_totals are emptied: the receipts now carry them.

Run on a sandbox (simulate.sh does). Writes with sqlite in one transaction,
then prints a reconciliation table; exits 1 if anything is off.
"""
import os, random, re, sqlite3, sys
from collections import defaultdict
from datetime import datetime, timedelta

S_UNIT, F_UNIT = 500, 50          # every old sales figure is a multiple of 500, every profit of 50
MARKER = "Sistem lama (rincian disimulasikan)"

def parse(folder):
    rd = lambda f: open(os.path.join(folder, f), encoding="utf-8")
    days = []
    for l in rd("laporan-penjualan.txt"):
        m = re.match(r"\s*(\d\d)/(\d\d)/(\d{4})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$", l)
        if m:
            total, count, items, disc, profit = (int(x.replace(".", "")) for x in m.groups()[3:])
            assert disc == 0, "discounts are not supported"
            days.append((f"{m[3]}-{m[2]}-{m[1]}", total, count, items, profit))
    sec, cur = {}, None
    for l in rd("total-per-pelanggan-karyawan-produk.txt"):
        l = l.strip()
        if l.startswith("#"):
            cur = l.split()[0]; sec[cur] = []; continue
        if l:
            sec[cur].append(l.split("|"))
    def table(rows, keyf):
        out = {}
        for r in rows:
            a = out.setdefault(keyf(r[0]), [0, 0, 0, 0])
            for i in range(4):
                a[i] += int(r[i + 1])          # total, trx, items, profit
        return out
    cust = table(sec["#CUSTOMER_TOTALS"], lambda c: "" if c == "TOKO" else c.lower())
    emp = table(sec["#EMPLOYEE_TOTALS"], lambda e: "" if e == "Toko" else e)
    prod = table(sec["#PRODUCT_TOTALS"], lambda p: p)
    names = {}
    for l in rd("data-induk.txt"):
        if l.startswith("CUS"):
            code, name = l.split("|")[:2]
            names.setdefault(name, []).append(code.lower())
    bons, pays = {}, defaultdict(list)
    for l in rd("piutang.txt"):
        if l.startswith("#") or not l.strip():
            continue
        day, name, kind, amount, code, method = l.strip().split("|")
        if kind == "U":
            assert code not in bons, code
            if name == "Toko":
                c = ""
            else:
                assert len(names.get(name, [])) == 1, f"bon pelanggan {name!r} not found exactly once"
                c = names[name][0]
            bons[code] = (day, c, int(amount))
        else:
            pays[code].append((day, int(amount), "Transfer" if method == "B" else "Tunai"))
    for code, (_, _, amount) in bons.items():
        assert sum(p[1] for p in pays[code]) == amount, f"bon {code} not fully paid"
    assert set(pays) <= set(bons)
    return days, cust, emp, prod, bons, pays

def fix(vals, ent, target, groups, lo, hi=None, rng=None):
    """Move value between members of the same group until each entity's sum
    hits its target. ent[i] = entity of member i; a move inside a group leaves
    every other total alone. lo/hi = per-member bounds. Returns what is left."""
    cur = defaultdict(int)
    for i, v in enumerate(vals):
        cur[ent[i]] += v
    res = {e: target.get(e, 0) - cur[e] for e in set(cur) | set(target)}
    for _ in range(50):
        before = sum(abs(r) for r in res.values())
        if not before or not sweep(vals, ent, res, groups, lo, hi, rng):
            break
    if any(res.values()):
        augment(vals, ent, res, groups, lo, hi)
    return sum(abs(r) for r in res.values())

def augment(vals, ent, res, groups, lo, hi):
    """When no group holds both a surplus and a deficit entity, pass value
    along a chain: surplus a → x (in one group) → … → deficit b. Each hop stays
    inside one group, so the other totals don't move."""
    room = lambda i: vals[i] - lo[i]
    cap = lambda j: (hi[j] - vals[j]) if hi is not None else float("inf")
    gm, at = [], defaultdict(list)
    for gi, g in enumerate(groups):
        by = defaultdict(list)
        for i in g:
            by[ent[i]].append(i)
        gm.append(by)
        for e in by:
            at[e].append(gi)
    for _ in range(200000):
        src = [e for e, r in res.items() if r < 0]
        if not src or not any(r > 0 for r in res.values()):
            return
        prev = {e: None for e in src}
        queue, hit = list(src), None
        while queue and hit is None:
            nxt = []
            for u in queue:
                for gi in at[u]:
                    give = max(gm[gi][u], key=room)
                    if room(give) <= 0:
                        continue
                    for v, mem in gm[gi].items():
                        if v in prev:
                            continue
                        take = max(mem, key=cap)
                        if cap(take) <= 0:
                            continue
                        prev[v] = (u, give, take)
                        if res.get(v, 0) > 0:
                            hit = v; break
                        nxt.append(v)
                    if hit is not None:
                        break
                if hit is not None:
                    break
            queue = nxt
        if hit is None:
            return
        path, v = [], hit
        while prev[v] is not None:
            u, i, j = prev[v]; path.append((i, j)); v = u
        d = min([-res[v], res[hit]] + [min(room(i), cap(j)) for i, j in path])
        for i, j in path:
            vals[i] -= d; vals[j] += d
        res[v] += d; res[hit] -= d

def sweep(vals, ent, res, groups, lo, hi, rng):
    moved = False
    for g in groups:
        by = defaultdict(list)
        for i in g:
            if res[ent[i]]:
                by[ent[i]].append(i)
        give = [e for e in by if res[e] < 0]; take = [e for e in by if res[e] > 0]
        if not give or not take:
            continue
        if rng:
            rng.shuffle(give); rng.shuffle(take)
        for a in give:
            for b in take:
                for i in by[a]:
                    if res[a] >= 0 or res[b] <= 0:
                        break
                    for j in by[b]:
                        if res[a] >= 0 or res[b] <= 0:
                            break
                        room = vals[i] - lo[i]
                        if hi is not None:
                            room = min(room, hi[j] - vals[j])
                        d = min(-res[a], res[b], room)
                        if d > 0:
                            vals[i] -= d; vals[j] += d; res[a] += d; res[b] -= d; moved = True
    return moved

def ipf(vals, dims, targets, iters=400):
    """Scale vals until the sum per entity matches the target on every dimension."""
    for _ in range(iters):
        worst = 0.0
        for d, tg in zip(dims, targets):
            s = defaultdict(float)
            for i, v in enumerate(vals):
                s[d[i]] += v
            f = {k: (tg.get(k, 0) / s[k] if s[k] else 1.0) for k in s}
            worst = max(worst, max(abs(x - 1) for x in f.values()))
            for i in range(len(vals)):
                vals[i] *= f[d[i]]
        if worst < 1e-12:
            break
    return vals

def main():
    db_path, folder = sys.argv[1], sys.argv[2]
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261007
    rng = random.Random(seed)
    days, cust, emp, prod, bons, pays = parse(folder)
    db = sqlite3.connect(db_path)
    q1 = lambda sql, *a: db.execute(sql, a).fetchone()
    users = dict(db.execute("SELECT username, id FROM users WHERE role='pelanggan'"))
    emps = dict(db.execute("SELECT name, id FROM employees"))
    prods = {n: i for n, i in db.execute("SELECT name, id FROM products")}
    methods = dict(db.execute("SELECT name, id FROM payment_methods"))
    owner = (q1("SELECT id FROM users WHERE role='owner' AND disabled=0 ORDER BY created LIMIT 1") or ("",))[0]
    for k in cust:
        assert not k or k in users, f"pelanggan {k} not found"
    for k in emp:
        assert not k or k in emps, f"karyawan {k} not found"
    for k in prod:
        assert k in prods, f"produk {k} not found"
    D = {d[0]: d[1:] for d in days}                          # day → total, count, items, profit
    T = sum(d[2] for d in days)
    assert T == sum(v[1] for v in cust.values()) == sum(v[1] for v in emp.values())

    # 1. receipts 1..T in date order (TRX0001…); bons pinned to their number,
    # pelanggan and amount; counts exact per day, pelanggan and karyawan
    tday = [d for d, (_, c, _, _) in sorted(D.items()) for _ in range(c)]
    pin = {}                                                 # t → bon amount
    tcus = [None] * T
    left = {c: v[1] for c, v in cust.items()}
    for code, (day, c, amount) in bons.items():
        t = int(code[3:]) - 1
        assert tday[t] == day, f"{code} is on {tday[t]}, bon says {day}"
        tcus[t] = c; pin[t] = amount; left[c] -= 1
    pool = [c for c, n in left.items() for _ in range(n)]; rng.shuffle(pool)
    it = iter(pool)
    tcus = [c if c is not None else next(it) for c in tcus]
    temp = [e for e, v in emp.items() for _ in range(v[1])]; rng.shuffle(temp)
    free = [t for t in range(T) if t not in pin]

    # 2. items per receipt: a bon gets amount / the pelanggan's average item
    # price; the rest exact per pelanggan, then karyawan, then day
    x = [0] * T
    for t, amount in pin.items():
        c = cust[tcus[t]]
        x[t] = max(1, round(amount / (c[0] / c[2])))
    # a pelanggan whose every receipt is a bon: those bons carry all their items
    all_bon = {c for c in cust if cust[c][1] == sum(1 for t in pin if tcus[t] == c)}
    for c in all_bon:
        ts = [t for t in pin if tcus[t] == c]
        assert sum(pin[t] for t in ts) == cust[c][0], f"pelanggan {c}: bons don't add up to the total"
        diff = cust[c][2] - sum(x[t] for t in ts)
        for k in range(abs(diff)):
            x[ts[k % len(ts)]] += 1 if diff > 0 else -1
    by_c = defaultdict(list)
    for t in free:
        by_c[tcus[t]].append(t)
    for c, ts in by_c.items():
        n = cust[c][2] - sum(x[t] for t in pin if tcus[t] == c)
        assert n >= len(ts), f"pelanggan {c}: not enough items"
        w = [rng.random() + 0.5 for _ in ts]; sw = sum(w)
        alloc = [1 + int((n - len(ts)) * wi / sw) for wi in w]
        for k in range(n - sum(alloc)):
            alloc[k % len(ts)] += 1
        for t, a in zip(ts, alloc):
            x[t] = a
    one = [1] * T
    def grp(*dims):
        g = defaultdict(list)
        for t in free:
            g[tuple(d[t] for d in dims)].append(t)
        return list(g.values())
    te, td = {e: v[2] for e, v in emp.items()}, {d: v[2] for d, v in D.items()}
    for _ in range(30):
        re_ = fix(x, temp, te, grp(tcus, tday) + grp(tcus), one, rng=rng)
        rd_ = fix(x, tday, td, grp(tcus, temp) + grp(tcus), one, rng=rng)
        if not re_ and not rd_:
            break
    re_ = fix(x, temp, te, grp(tcus, tday), one, rng=rng)
    rest = fix(x, tday, td, grp(tcus, temp), one, rng=rng) + fix(x, temp, te, [], one)
    assert rest == 0, f"items per day/karyawan: {rest} left over"

    # 3. lines: each product's items cut into its old transaction count of
    # bundles, dealt over the receipts → exact items per product
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

    # 4. money per line (sales in 500s, laba in 50s). Bon lines first, split
    # by item value; the free lines then take what is left of every total:
    # IPF from the product's average price, round, repair the rounding with
    # moves that keep the other totals (product within a receipt; pelanggan,
    # karyawan, day within a product).
    s = [0] * n; f = [0] * n
    pinned = defaultdict(list)
    for i in range(n):
        if lt[i] in pin:
            pinned[lt[i]].append(i)
    for t, ix in pinned.items():
        units = pin[t] // S_UNIT; w = [qty[i] * avg[lp[i]] for i in ix]; sw = sum(w)
        for i, wi in zip(ix, w):
            s[i] = int(units * wi / sw)
        for k in range(units - sum(s[i] for i in ix)):
            s[ix[k % len(ix)]] += 1
        cm = cust[tcus[t]][3] / cust[tcus[t]][0]          # the pelanggan's own margin
        for i in ix:
            f[i] = min(max(0, round(s[i] * 10 * cm)), max(0, s[i] * 10 - qty[i]))
    for c in all_bon:                                      # exact laba for an all-bon pelanggan
        ix = [i for t in pinned if tcus[t] == c for i in pinned[t]]
        diff = cust[c][3] // F_UNIT - sum(f[i] for i in ix)
        while diff:
            moved = False
            for i in ix:
                if diff > 0 and f[i] < s[i] * 10 - qty[i]:
                    f[i] += 1; diff -= 1; moved = True
                elif diff < 0 and f[i] > 0:
                    f[i] -= 1; diff += 1; moved = True
                if not diff:
                    break
            assert moved, f"pelanggan {c}: laba does not fit"
    fi = [i for i in range(n) if lt[i] not in pin]
    def money(tg, start, lo, hi=None):
        dims = [[dm[i] for i in fi] for dm in (ld, lc, le, lp)]
        v = ipf(list(start), dims, tg)
        v = [max(lo[k], int(round(v[k]))) for k in range(len(v))]
        if hi:
            v = [min(hi[k], v[k]) for k in range(len(v))]
        # rounding moved the grand total: put each product back on its exact sum
        dp_ = dims[3]
        lines_of = defaultdict(list)
        for k in range(len(v)):
            lines_of[dp_[k]].append(k)
        for p, ks in lines_of.items():
            diff = tg[3][p] - sum(v[k] for k in ks)
            while diff:
                step = 1 if diff > 0 else -1
                moved = False
                for k in ks:
                    if not diff:
                        break
                    if (step > 0 and (hi is None or v[k] < hi[k])) or (step < 0 and v[k] > lo[k]):
                        v[k] += step; diff -= step; moved = True
                if not moved:
                    raise SystemExit(f"product {p} cannot reach its total")
        sub_t = [lt[i] for i in fi]
        def groups(*ds):
            gg = defaultdict(list)
            for k in range(len(v)):
                gg[tuple(d[k] for d in ds)].append(k)
            return list(gg.values())
        dd, dc, de, dp = dims
        for _ in range(8):
            fix(v, dp, tg[3], groups(sub_t), lo, hi, rng)
            fix(v, dc, tg[1], groups(dp, dd, de) + groups(dp, de) + groups(dp), lo, hi, rng)
            fix(v, de, tg[2], groups(dp, dc, dd) + groups(dp, dc), lo, hi, rng)
            fix(v, dd, tg[0], groups(dp, dc, de), lo, hi, rng)
            sums = [defaultdict(int) for _ in range(4)]
            for k in range(len(v)):
                for j, d in enumerate(dims):
                    sums[j][d[k]] += v[k]
            offs = [sum(abs(sums[j][e] - t[e]) for e in t) for j, t in enumerate(tg)]
            off = sum(offs)
            if not off:
                return v
            print("  money still off (day, pelanggan, karyawan, produk):", offs)
        raise SystemExit(f"money did not reconcile: {off} units off")
    tg_s = [{d: v[0] // S_UNIT for d, v in D.items()}, {c: v[0] // S_UNIT for c, v in cust.items()},
            {e: v[0] // S_UNIT for e, v in emp.items()}, {p: v[0] // S_UNIT for p, v in prod.items()}]
    for i in range(n):
        if lt[i] in pin:
            for k, dm in enumerate((ld, lc, le, lp)):
                tg_s[k][dm[i]] -= s[i]
    sv = money(tg_s, [qty[i] * avg[lp[i]] for i in fi], [max(1, int(qty[i] * avg[lp[i]] * 0.25)) for i in fi])
    for k, i in enumerate(fi):
        s[i] = sv[k]
    tg_f = [{d: v[3] // F_UNIT for d, v in D.items()}, {c: v[3] // F_UNIT for c, v in cust.items()},
            {e: v[3] // F_UNIT for e, v in emp.items()}, {p: v[3] // F_UNIT for p, v in prod.items()}]
    for i in range(n):
        if lt[i] in pin:
            for k, dm in enumerate((ld, lc, le, lp)):
                tg_f[k][dm[i]] -= f[i]
    fv = money(tg_f, [s[i] * 10 * margin[lp[i]] for i in fi], [0] * len(fi), [s[i] * 10 - qty[i] for i in fi])
    for k, i in enumerate(fi):
        f[i] = fv[k]

    # 5. rows: integer price and hpp per unit (a line splits in up to 3 rows)
    def rid():
        return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(15))
    items_by_t = defaultdict(list)
    for i in range(n):
        S, C, q = s[i] * S_UNIT, s[i] * S_UNIT - f[i] * F_UNIT, qty[i]
        p0, r1 = divmod(S, q); h0, r2 = divmod(C, q)
        cuts = sorted({0, r1, r2, q})
        for a, b in zip(cuts, cuts[1:]):
            items_by_t[lt[i]].append((lp[i], b - a, p0 + (1 if a < r1 else 0), h0 + (1 if a < r2 else 0)))
    tunai, transfer = methods["Tunai"], methods["Transfer"]
    cur = db.cursor()
    cur.execute("BEGIN")
    for tb in ("sale_payments", "sale_items", "receivable_payments", "receivables", "sales", "legacy_sales", "legacy_totals"):
        cur.execute(f"DELETE FROM {tb}")
    stamp = lambda day, sec: (datetime.strptime(day, "%Y-%m-%d") - timedelta(hours=7) + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + "Z"
    per_day = defaultdict(list)
    for t in range(T):
        per_day[tday[t]].append(t)
    when = {}
    for day, ts in per_day.items():
        secs = sorted(rng.randint(8 * 3600, 21 * 3600) * 1000 + rng.randint(0, 999) for _ in ts)
        for t, ms in zip(ts, secs):
            when[t] = ms / 1000
    code_of = {int(c[3:]) - 1: c for c in bons}
    for t in range(T):
        created = stamp(tday[t], when[t])
        total = sum(qn * pr for _, qn, pr, _ in items_by_t[t])
        bon = t in pin
        assert not bon or total == pin[t]
        sid = rid()
        cur.execute("""INSERT INTO sales (id, number, cashier, customer, subtotal, discount, voucher, points_used, total, paid, change,
            payment_method, status, points_earned, note, created, updated, kind, ref_sale, employee)
            VALUES (?,?,?,?,?,0,'',0,?,?,0,?,'lunas',0,?,?,?,'jual','',?)""",
            (sid, f"TRX{t + 1:04d}", owner, users.get(tcus[t], ""), total, total, 0 if bon else total,
             "" if bon else tunai, MARKER, created, created, emps.get(temp[t], "")))
        for p, qn, pr, hp in items_by_t[t]:
            cur.execute("""INSERT INTO sale_items (id, sale, product, name, qty, price, hpp, subtotal, created, updated, tier)
                VALUES (?,?,?,?,?,?,?,?,?,?,'normal')""", (rid(), sid, prods[p], p, qn, pr, hp, qn * pr, created, created))
        if not bon:
            cur.execute("INSERT INTO sale_payments (id, sale, payment_method, amount, by, created, updated) VALUES (?,?,?,?,?,?,?)",
                        (rid(), sid, tunai, total, owner, created, created))
            continue
        rcid = rid()
        cur.execute("""INSERT INTO receivables (id, sale, customer, amount, paid, status, due_date, created, updated)
            VALUES (?,?,?,?,?,'lunas','',?,?)""", (rcid, sid, users.get(tcus[t], ""), total, total, created, created))
        for k, (pday, amount, m) in enumerate(pays[code_of[t]]):
            at = stamp(pday, max(when[t] + 60 * (k + 1), 9 * 3600) if pday == tday[t] else 10 * 3600 + 60 * k)
            cur.execute("""INSERT INTO receivable_payments (id, receivable, amount, payment_method, by, note, created, updated)
                VALUES (?,?,?,?,?,?,?,?)""", (rid(), rcid, amount, transfer if m == "Transfer" else tunai, owner, MARKER, at, at))
    db.commit()
    print(f"generated {T} receipts ({len(pin)} bon), {sum(len(v) for v in items_by_t.values())} item rows, seed {seed}")

    # 6. reconciliation, read back from the database
    bad = 0
    def agg(key):
        return {r[0]: r[1:] for r in db.execute(f"""SELECT {key}, COUNT(DISTINCT s.id), SUM(i.qty), SUM(i.subtotal), SUM(i.subtotal - i.hpp * i.qty)
            FROM sale_items i JOIN sales s ON s.id = i.sale LEFT JOIN users u ON u.id = s.customer LEFT JOIN employees e ON e.id = s.employee
            LEFT JOIN products p ON p.id = i.product GROUP BY 1""")}
    def compare(label, got, want, fields):
        nonlocal bad
        diff = sum(1 for k in want if tuple(got.get(k, (0, 0, 0, 0))[j] for j in fields) != tuple(want[k][j] for j in fields))
        extra = len(set(got) - set(want)); bad += diff + extra
        print(f"{label:38} {len(want):4} rows  {'PASS' if not diff and not extra else f'FAIL ({diff} differ, {extra} extra)'}")
    compare("per day: trx / items / omzet / laba", agg("date(datetime(s.created, '+7 hours'))"), {d: (v[1], v[2], v[0], v[3]) for d, v in D.items()}, (0, 1, 2, 3))
    compare("per pelanggan: trx / items / omzet / laba", agg("COALESCE(u.username, '')"), {c: (v[1], v[2], v[0], v[3]) for c, v in cust.items()}, (0, 1, 2, 3))
    compare("per karyawan: trx / items / omzet / laba", agg("COALESCE(e.name, '')"), {e: (v[1], v[2], v[0], v[3]) for e, v in emp.items()}, (0, 1, 2, 3))
    gp = agg("p.name")
    compare("per produk: items / omzet / laba", gp, {p: (v[1], v[2], v[0], v[3]) for p, v in prod.items()}, (1, 2, 3))
    print(f"{'per produk: receipts containing it':38} {sum(v[0] for v in gp.values()):>6} (old system {sum(v[1] for v in prod.values())}; not matched exactly)")
    b = q1("SELECT COUNT(*), SUM(rc.amount), SUM(rc.status = 'lunas') FROM receivables rc")
    want_b = (len(bons), sum(v[2] for v in bons.values()))
    ok = b[:2] == want_b and b[2] == len(bons)
    bad += not ok
    print(f"{'bon: count / amount / all lunas':38} {'PASS' if ok else f'FAIL {b[:3]} vs {want_b}'}")
    pm = dict(db.execute("SELECT m.name, SUM(rp.amount) FROM receivable_payments rp JOIN payment_methods m ON m.id = rp.payment_method GROUP BY 1"))
    want_pm = defaultdict(int)
    for v in pays.values():
        for _, a, m in v:
            want_pm[m] += a
    ok = pm == dict(want_pm); bad += not ok
    print(f"{'bon payments per method':38} {'PASS' if ok else f'FAIL {pm} vs {dict(want_pm)}'}  {dict(want_pm)}")
    wrong = q1("""SELECT COUNT(*) FROM receivables rc JOIN sales s ON s.id = rc.sale
        WHERE s.number NOT IN (""" + ",".join("'" + c + "'" for c in bons) + ")")[0]
    bad += wrong != 0
    print(f"{'bon receipts keep their TRX number':38} {'PASS' if not wrong else f'FAIL ({wrong})'}")
    till = q1("SELECT SUM(amount) FROM sale_payments")[0] + q1("SELECT SUM(amount) FROM receivable_payments")[0]
    total = sum(v[0] for v in D.values())
    bad += till != total
    print(f"{'cash in (till + bon) = omzet':38} {'PASS' if till == total else f'FAIL {till} vs {total}'}  {till}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()

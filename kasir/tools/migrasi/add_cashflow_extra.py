#!/usr/bin/env python3
"""What the old system's cashflow page has and the kasir doesn't yet.

  add_cashflow_extra.py <data.db> <cashflow.html> [--dry-run]

Run after fix_methods.py, with the same saved cashflow page (Laporan Kas of the
old system, sections "Tunai" and "Transfer Bank"):

1. Old-system sales made after the import (TRX numbers above the highest
   "Sistem lama" receipt in the kasir) become "Sistem lama" receipts with
   their real number, day, amount, method and pelanggan ("a/n Toko" = no
   pelanggan). Which products sit on them is invented from the products the
   shop sells most (same note "Sistem lama (rincian disimulasikan)"). Stock
   does not move, as with every other old receipt: count it with Stok opname.
2. "Retur Penjualan #TRX…" rows become a manual Buku Kas entry (keluar, same
   day and method).
3. Old bon payments booked on another day than in the cashflow are moved to
   the cashflow's day (same amount, method and receipt, within 3 days).

Rerunnable: receipts, entries and moves that are already there are skipped.
One transaction; exits 1 (and rolls back) if a check fails.
"""
import html, re, secrets, sqlite3, sys
from collections import defaultdict
from datetime import datetime, timedelta

MARKER = "Sistem lama (rincian disimulasikan)"
rid = lambda: "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(15))  # PocketBase id


def parse_cashflow(path):
    s = open(path, encoding="utf-8").read()
    t = s[s.find("<table"):s.find("</table>")]
    cell = lambda c: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
    num = lambda x: int(x.replace(".", "") or 0)
    sec, rows = None, []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        d = [cell(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(d) == 1:
            sec = "Transfer" if d[0].startswith("Transfer") else "Tunai"
        if len(d) == 5:
            dd, mm, yy = d[0].split("/")
            rows.append({"day": f"{yy}-{mm}-{dd}", "text": d[1], "in": num(d[2]), "out": num(d[3]), "method": sec})
    return rows


# A WIB wall-clock time on a day, as PocketBase stores it (UTC).
def stamp(day, hh, mm):
    return (datetime.strptime(day, "%Y-%m-%d") + timedelta(hours=hh - 7, minutes=mm)).strftime("%Y-%m-%d %H:%M:%S.000Z")


def items_for(total, popular):
    """Lines (product row, qty) at the products' own price adding up to total."""
    for p in popular:                                   # one product
        if total % p["price"] == 0 and total // p["price"] <= 40:
            return [(p, total // p["price"])]
    for p in popular[:40]:                              # two products
        for q in range(1, 21):
            rest = total - q * p["price"]
            if rest <= 0:
                break
            for p2 in popular:
                if p2 is not p and rest % p2["price"] == 0 and rest // p2["price"] <= 40:
                    return [(p, q), (p2, rest // p2["price"])]
    return None


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    dry = "--dry-run" in sys.argv
    db = sqlite3.connect(args[0])
    cf = parse_cashflow(args[1])
    pm = dict(db.execute("SELECT name, id FROM payment_methods"))
    cur = db.cursor()
    cur.execute("BEGIN")
    ok, log = True, []

    # 1. old-system sales after the import
    last = cur.execute("SELECT MAX(CAST(substr(number, 4) AS INTEGER)) FROM sales WHERE note LIKE 'Sistem lama%' AND number GLOB 'TRX[0-9]*'").fetchone()[0]
    owner = cur.execute("SELECT cashier, COUNT(*) c FROM sales WHERE note LIKE 'Sistem lama%' GROUP BY 1 ORDER BY c DESC LIMIT 1").fetchone()[0]
    cols = [r[1] for r in cur.execute("PRAGMA table_info(settings)")]
    walk = (cur.execute("SELECT walkin_customer FROM settings LIMIT 1").fetchone() or ("",))[0] if "walkin_customer" in cols else ""
    people = defaultdict(list)
    for uid, name in cur.execute("SELECT id, name FROM users WHERE role = 'pelanggan'"):
        people[name].append(uid)
    popular = [dict(zip(("id", "name", "price", "hpp"), r)) for r in cur.execute("""
        SELECT p.id, p.name, p.price, p.hpp FROM products p JOIN sale_items i ON i.product = p.id
         WHERE p.active AND p.price > 0 GROUP BY p.id ORDER BY SUM(i.qty) DESC""")]
    new = [r for r in cf if (m := re.match(r"Penjualan #TRX(\d+) a/n (.*)$", r["text"])) and int(m.group(1)) > last]
    new.sort(key=lambda r: int(re.search(r"#TRX(\d+)", r["text"]).group(1)))  # in number order, as they were made
    for r in new:
        number, who = re.match(r"Penjualan #(TRX\d+) a/n (.*)$", r["text"]).groups()
        if cur.execute("SELECT 1 FROM sales WHERE number = ?", (number,)).fetchone():
            continue
        cust = walk if who == "Toko" else (people[who][0] if len(people[who]) == 1 else None)
        if cust is None:
            print(f"FAIL {number}: pelanggan not found exactly once"); ok = False; continue
        lines = items_for(r["in"], popular)
        if not lines:
            print(f"FAIL {number}: no product mix adds up to {r['in']}"); ok = False; continue
        # 15 minutes apart from 09:00, after the old receipts already on that day
        done = cur.execute("SELECT COUNT(*) FROM sales WHERE note LIKE 'Sistem lama%' AND date(datetime(created, '+7 hours')) = ?", (r["day"],)).fetchone()[0]
        created = stamp(r["day"], 9, 15 * done)
        sid = rid()
        cur.execute("""INSERT INTO sales (id, number, cashier, customer, subtotal, discount, voucher, points_used, total, paid, change,
            payment_method, status, points_earned, note, created, updated, kind, ref_sale, employee)
            VALUES (?,?,?,?,?,0,'',0,?,?,0,?,'lunas',0,?,?,?,'jual','','')""",
            (sid, number, owner, cust, r["in"], r["in"], r["in"], pm[r["method"]], MARKER, created, created))
        for p, q in lines:
            cur.execute("""INSERT INTO sale_items (id, sale, product, name, qty, price, hpp, subtotal, created, updated, tier)
                VALUES (?,?,?,?,?,?,?,?,?,?,'normal')""", (rid(), sid, p["id"], p["name"], q, p["price"], p["hpp"], q * p["price"], created, created))
        cur.execute("INSERT INTO sale_payments (id, sale, payment_method, amount, by, created, updated) VALUES (?,?,?,?,?,?,?)",
                    (rid(), sid, pm[r["method"]], r["in"], owner, created, created))
        log.append(f"added {number} {r['day']} {r['method']} {r['in']:,} ({len(lines)} product lines)")

    # 2. returns as manual Buku Kas entries
    for r in cf:
        m = re.match(r"Retur Penjualan #(TRX\d+)", r["text"])
        if not m:
            continue
        note = f"Retur penjualan {m.group(1)} (sistem lama)"
        if cur.execute("SELECT 1 FROM cash_entries WHERE note = ?", (note,)).fetchone():
            continue
        at = stamp(r["day"], 12, 0)
        cur.execute("""INSERT INTO cash_entries (id, amount, by, created, date, note, payment_method, type, updated)
            VALUES (?,?,?,?,?,?,?,'keluar',?)""", (rid(), r["out"], owner, at, r["day"] + " 00:00:00.000Z", note, pm[r["method"]], at))
        log.append(f"added Buku Kas keluar {r['day']} {r['method']} {r['out']:,}: {note}")

    # 3. bon payments on another day than in the cashflow
    want = defaultdict(int)
    for r in cf:
        if r["text"].startswith("Pembayaran Utang"):
            want[(r["day"], r["method"], r["in"])] += 1
    have = defaultdict(list)
    for pid, day, method, amount in cur.execute("""SELECT rp.id, date(datetime(rp.created, '+7 hours')), m.name, rp.amount
            FROM receivable_payments rp JOIN payment_methods m ON m.id = rp.payment_method WHERE rp.note LIKE 'Sistem lama%'"""):
        have[(day, method, amount)].append(pid)
    for key in sorted(have):
        day, method, amount = key
        extra = len(have[key]) - want.get(key, 0)
        for pid in have[key][:max(0, extra)]:
            d0 = datetime.strptime(day, "%Y-%m-%d")
            for delta in (-1, 1, -2, 2, -3, 3):
                d = (d0 + timedelta(days=delta)).strftime("%Y-%m-%d")
                k2 = (d, method, amount)
                if want.get(k2, 0) > len(have.get(k2, [])):
                    t = cur.execute("SELECT created FROM receivable_payments WHERE id = ?", (pid,)).fetchone()[0]
                    moved = d + t[10:]
                    cur.execute("UPDATE receivable_payments SET created = ?, updated = ? WHERE id = ?", (moved, moved, pid))
                    have[k2] = have.get(k2, []) + [pid]
                    log.append(f"moved bon payment {method} {amount:,} from {day} to {d}")
                    break

    for l in log:
        print(l)
    print(f"{len(log)} changes")
    if dry or not ok:
        db.rollback()
        print("ROLLED BACK" + ("" if ok else ": a check failed"))
    else:
        db.commit()
        print("COMMITTED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

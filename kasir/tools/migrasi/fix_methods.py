#!/usr/bin/env python3
"""Tunai / Transfer for the old system's receipts, from its cashflow page.

  fix_methods.py <data.db> <cashflow.html> [--dry-run]

gen_sales.py paid every simulated "Sistem lama" receipt in Tunai, because the
old export only had daily totals. The old system's cashflow page (Laporan Kas,
saved as HTML: sections "Tunai" and "Transfer Bank", one row per
"Penjualan #TRX…") gives the real Tunai and Transfer per day. This changes the
payment method of existing receipts IN PLACE so each day's Tunai and Transfer
in Buku Kas match the old system exactly. Nothing is inserted or deleted, and
no amount changes: only sale_payments.payment_method and sales.payment_method
of non-bon "Sistem lama" receipts.

Per day it picks receipts whose totals add up exactly to that day's Transfer
(subset sum in units of 500), preferring receipts whose TRX number really was
paid by Transfer in the old system. If no exact set exists, one receipt is
split over Tunai and Transfer (it then shows under "Split").

Rerunnable: every non-bon legacy receipt is reset to one Tunai payment first
(a receipt split by an earlier run is merged back). Safe on the
live kasir (one transaction, legacy rows only), but test on a copy first and
back up. Exits 1 when the result doesn't match.
"""
import html, re, secrets, sqlite3, sys
from collections import defaultdict

UNIT = 500
rid = lambda: "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(15))  # PocketBase id
MARKER = "Sistem lama%"


def parse_cashflow(path):
    s = open(path, encoding="utf-8").read()
    t = s[s.find("<table"):s.find("</table>")]
    cell = lambda c: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
    num = lambda x: int(x.replace(".", "") or 0)
    sec, per_day, method_of = None, defaultdict(lambda: {"Tunai": 0, "Transfer": 0}), {}
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        d = [cell(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(d) == 1:
            sec = "Transfer" if d[0].startswith("Transfer") else "Tunai"
        if len(d) != 5:
            continue
        m = re.match(r"Penjualan #(TRX\d+)", d[1])
        if not m:
            continue
        dd, mm, yy = d[0].split("/")
        per_day[f"{yy}-{mm}-{dd}"][sec] += num(d[2])
        method_of[m.group(1)] = sec
    return per_day, method_of


def pick(amounts, prefer, target):
    """Indexes whose amounts sum to target (all multiples of UNIT), or None."""
    if target == 0:
        return []
    a = [x // UNIT for x in amounts]
    t = target // UNIT
    mask = (1 << (t + 1)) - 1
    reach = [1]
    for x in a:
        reach.append((reach[-1] | (reach[-1] << x)) & mask)
    if not (reach[-1] >> t) & 1:
        return None
    out = []
    for i in range(len(a) - 1, -1, -1):
        can_skip = (reach[i] >> t) & 1
        can_take = t >= a[i] and (reach[i] >> (t - a[i])) & 1
        if can_take and (prefer[i] or not can_skip):
            out.append(i)
            t -= a[i]
    assert t == 0
    return out


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    dry = "--dry-run" in sys.argv
    db = sqlite3.connect(args[0])
    per_day, method_of = parse_cashflow(args[1])
    pm = dict(db.execute("SELECT name, id FROM payment_methods"))
    tunai, transfer = pm["Tunai"], pm["Transfer"]

    cur = db.cursor()
    cur.execute("BEGIN")
    # A receipt split by an earlier run goes back to one payment of the full amount.
    for sid, total in cur.execute("""SELECT s.id, s.total FROM sales s WHERE s.note LIKE ? AND s.status != 'batal' AND s.paid > 0
            AND (SELECT COUNT(*) FROM sale_payments z WHERE z.sale = s.id) > 1""", (MARKER,)).fetchall():
        keep = cur.execute("SELECT id FROM sale_payments WHERE sale = ? ORDER BY created, id LIMIT 1", (sid,)).fetchone()[0]
        cur.execute("DELETE FROM sale_payments WHERE sale = ? AND id != ?", (sid, keep))
        cur.execute("UPDATE sale_payments SET amount = ? WHERE id = ?", (total, keep))
    rows = cur.execute("""SELECT s.id, s.number, substr(datetime(s.created, '+7 hours'), 1, 10) AS day, s.total, s.paid,
        (SELECT COUNT(*) FROM sale_payments z WHERE z.sale = s.id) AS np
        FROM sales s WHERE s.note LIKE ? AND s.status != 'batal' AND s.paid > 0 ORDER BY s.created""", (MARKER,)).fetchall()
    assert all(np == 1 for *_, np in rows), "a legacy receipt with several payments: run on a fresh copy"
    assert all(total == paid for _, _, _, total, paid, _ in rows), "a legacy receipt with a DP"
    by_day = defaultdict(list)
    for sid, number, day, total, paid, _ in rows:
        by_day[day].append((sid, number, total))

    ids = [r[0] for r in rows]
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        q = ",".join("?" * len(part))
        cur.execute(f"UPDATE sale_payments SET payment_method = ? WHERE sale IN ({q})", [tunai] + part)
        cur.execute(f"UPDATE sales SET payment_method = ? WHERE id IN ({q})", [tunai] + part)

    stats = defaultdict(int)
    for day, recs in sorted(by_day.items()):
        want = per_day.get(day, {"Tunai": 0, "Transfer": 0})
        have = sum(r[2] for r in recs)
        if want["Tunai"] + want["Transfer"] != have:
            print(f"FAIL {day}: kasir {have} vs old system {want['Tunai'] + want['Transfer']}")
            stats["bad_days"] += 1
            continue
        amounts = [r[2] for r in recs]
        prefer = [method_of.get(r[1]) == "Transfer" for r in recs]
        chosen = pick(amounts, prefer, want["Transfer"])
        split = None
        if chosen is None:
            # Largest exact set below the target, then split one more receipt.
            order = sorted(range(len(recs)), key=lambda i: -amounts[i])
            chosen, left = [], want["Transfer"]
            for i in order:
                if amounts[i] <= left:
                    chosen.append(i); left -= amounts[i]
            rest = [i for i in order if i not in chosen]
            split = (rest[0], left)
            stats["split"] += 1
        for i in chosen:
            sid = recs[i][0]
            cur.execute("UPDATE sale_payments SET payment_method = ? WHERE sale = ?", (transfer, sid))
            cur.execute("UPDATE sales SET payment_method = ? WHERE id = ?", (transfer, sid))
            stats["transfer"] += 1
            stats["match"] += prefer[i]
        if split:
            i, amt = split
            sid = recs[i][0]
            pay = cur.execute("SELECT id, by, created FROM sale_payments WHERE sale = ?", (sid,)).fetchone()
            cur.execute("UPDATE sale_payments SET amount = ? WHERE id = ?", (amounts[i] - amt, pay[0]))
            cur.execute("""INSERT INTO sale_payments (id, sale, payment_method, amount, by, created, updated)
                VALUES (?, ?, ?, ?, ?, ?, ?)""", (rid(), sid, transfer, amt, pay[1], pay[2], pay[2]))
            cur.execute("UPDATE sales SET payment_method = ? WHERE id = ?", (transfer if amt * 2 > amounts[i] else tunai, sid))

    # Check, read back from the database.
    got = defaultdict(lambda: {"Tunai": 0, "Transfer": 0})
    for day, name, amount in cur.execute("""SELECT substr(datetime(s.created, '+7 hours'), 1, 10), m.name, SUM(sp.amount)
            FROM sale_payments sp JOIN sales s ON s.id = sp.sale JOIN payment_methods m ON m.id = sp.payment_method
            WHERE s.note LIKE ? AND s.status != 'batal' GROUP BY 1, 2""", (MARKER,)):
        got[day][name] += amount
    bad = [d for d in by_day if got[d]["Tunai"] != per_day.get(d, {}).get("Tunai", 0) or got[d]["Transfer"] != per_day.get(d, {}).get("Transfer", 0)]
    tot = lambda k, src: sum(v[k] for d, v in src.items() if d in by_day)
    print(f"days {len(by_day)}, receipts {len(rows)}, set to Transfer {stats['transfer']} "
          f"({stats['match']} of them really Transfer in the old system), split receipts {stats['split']}")
    print(f"Tunai    kasir {tot('Tunai', got):>15,}  old {tot('Tunai', per_day):>15,}")
    print(f"Transfer kasir {tot('Transfer', got):>15,}  old {tot('Transfer', per_day):>15,}")
    ok = not bad and not stats["bad_days"]
    if dry or not ok:
        db.rollback()
        print("ROLLED BACK" + ("" if ok else f": {len(bad)} days off, {stats['bad_days']} days with other totals"))
    else:
        db.commit()
        print("COMMITTED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

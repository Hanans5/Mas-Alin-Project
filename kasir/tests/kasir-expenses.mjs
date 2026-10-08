// The kasir login sees only this week's Pengeluaran: not through the records
// API (list), only through /api/expenses/week. Managers still list everything.
//   PB=… SU_EMAIL=… SU_PASS=… node tests/kasir-expenses.mjs
const PB = process.env.PB || "http://127.0.0.1:8090";
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`); if (!ok) failures++; };
async function api(token, method, path, body) {
  const r = await fetch(PB + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const run = Math.random().toString(36).slice(2, 7), pw = "Uji-" + Math.random().toString(36).slice(2, 12);
const su = (await api(null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.SU_EMAIL, password: process.env.SU_PASS })).body.token;
const mk = async (username, role) => (await api(su, "POST", "/api/collections/users/records", { username, role, name: username, password: pw, passwordConfirm: pw })).body;
const kasir = await mk("ekasir" + run, "kasir"), admin = await mk("eadmin" + run, "admin");
const login = async (u) => (await api(null, "POST", "/api/collections/users/auth-with-password", { identity: u, password: pw })).body.token;
const K = await login(kasir.username), A = await login(admin.username);
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const old = new Date(Date.now() + 7 * 3600e3 - 20 * 86400e3).toISOString().slice(0, 10);
const tunai = (await api(A, "GET", "/api/collections/payment_methods/records")).body.items.find((m) => m.name === "Tunai");
const oldExp = (await api(A, "POST", "/api/collections/expenses/records", { date: old + " 00:00:00.000Z", category: "Uji lama " + run, amount: 1000, payment_method: tunai.id })).body;
const mine = await api(K, "POST", "/api/collections/expenses/records", { date: today + " 00:00:00.000Z", category: "Uji kasir " + run, amount: 2000, payment_method: tunai.id, by: kasir.id });
check("kasir adds an expense", mine.status === 200 && mine.body.amount === 2000, mine.body);
const list = await api(K, "GET", "/api/collections/expenses/records?perPage=500");
check("kasir can't list expenses through the records API", list.status === 200 && list.body.items.length === 0, list.body.totalItems);
check("kasir can't open an old expense by id", (await api(K, "GET", `/api/collections/expenses/records/${oldExp.id}`)).status === 404);
const week = await api(K, "GET", "/api/expenses/week");
check("week route: from a Monday up to today", week.status === 200 && week.body.to === today && new Date(week.body.from + "T00:00:00Z").getUTCDay() === 1, week.body);
check("week route has today's expense, not the old one", week.body.items.some((x) => x.id === mine.body.id) && !week.body.items.some((x) => x.id === oldExp.id));
check("admin still lists the old expense", (await api(A, "GET", `/api/collections/expenses/records/${oldExp.id}`)).status === 200);
for (const id of [oldExp.id, mine.body.id]) await api(su, "DELETE", `/api/collections/expenses/records/${id}`);
for (const u of [kasir, admin]) await api(su, "PATCH", `/api/collections/users/records/${u.id}`, { disabled: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

// Two-year copy of ui-year.mjs: PB=… sets the sandbox, the range is 7 Oct 2024 – 6 Oct 2026.
// Headless Chrome over CDP against the SANDBOX kasir app holding a year of
// data: times the heavy screens, catches JS errors, takes screenshots and
// downloads the year's Penjualan Excel.
//   OWNER_PASS=… node tests/ui-year.mjs <outDir> [width] [dark]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readdirSync, statSync, mkdirSync } from "node:fs";

const [out, width = "1440", dark] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = +width, H = W < 600 ? 860 : 900;
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(out + "/prof-");
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value || a.description).join(" "));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (n) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }); writeFileSync(`${out}/${n}.jpg`, Buffer.from(s.result.data, "base64")); };

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
if (dark) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.enable"); await send("Runtime.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out });
await send("Page.navigate", { url: "" + (process.env.PB || "http://127.0.0.1:8099") + "/" }); await sleep(1500);
await ev(`localStorage.clear()`); await send("Page.reload"); await sleep(1500);
await ev(`(()=>{document.querySelector('#lu').value='alin';document.querySelector('#lp').value=${JSON.stringify(process.env.OWNER_PASS)};document.querySelector('#lu').form.requestSubmit()})()`);
await sleep(2500);

// Wait until the view stops saying "Memuat…" and has settled; returns ms.
const settle = async (start) => {
  for (let i = 0; i < 600; i++) {
    const busy = await ev(`!!document.querySelector('#view .empty') && /Memuat/.test(document.querySelector('#view').innerText)`);
    if (!busy) break;
    await sleep(50);
  }
  await ev(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  return Math.round(performance.now() - start);
};
const results = [];
const visit = async (name, js) => {
  const t0 = performance.now();
  await ev(js);
  const ms = await settle(t0);
  const rows = await ev(`document.querySelectorAll('#view tr').length`);
  const text = (await ev(`document.querySelector('#view')?.innerText || ''`)).replace(/\s+/g, " ");
  const err = /Tidak punya akses|error|gagal/i.test(text.slice(0, 400)) ? text.slice(0, 160) : "";
  results.push({ name, ms, rows, err });
  await shot(name);
};
const Y = `RS.from='2024-10-07'; RS.to='2026-10-06'; RS.preset='custom'; FS.from='2024-10-07'; FS.to='2026-10-06'; FS.preset='custom';`;
await visit("dasbor", `goNav('dash')`);
await visit("laporan-ringkasan-setahun", `${Y} RS.type='ringkasan'; goNav('rep')`);
await visit("laporan-penjualan-setahun", `${Y} RS.type='penjualan'; goNav('rep')`);
// Excel of 6 000+ rows, built in the browser.
const x0 = performance.now();
await ev(`document.querySelector('#rxl').click()`);
let xlsx = null;
for (let i = 0; i < 100 && !xlsx; i++) { await sleep(200); xlsx = readdirSync(out).find((f) => f.endsWith(".xlsx")); }
results.push({ name: "excel-penjualan-setahun", ms: Math.round(performance.now() - x0), rows: xlsx ? `${(statSync(`${out}/${xlsx}`).size / 1024).toFixed(0)} KB ${xlsx}` : "NOT DOWNLOADED" });
await visit("laporan-karyawan-setahun", `${Y} RS.type='karyawan'; goNav('rep')`);
await visit("laporan-piutang-setahun", `${Y} RS.type='piutang'; goNav('rep')`);
await visit("laporan-tukar-setahun", `${Y} RS.type='retur'; goNav('rep')`);
await visit("bukukas-setahun", `${Y} goNav('bukukas')`);
await visit("labarugi-setahun", `${Y} goNav('labarugi')`);
await visit("piutang", `goNav('piutang')`);
await visit("pelanggan", `goNav('pelanggan')`);
await visit("karyawan", `goNav('karyawan')`);
await visit("transaksi", `goNav('tx')`);
await visit("pesanan-online", `goNav('online')`);
await visit("pengiriman", `goNav('ship')`);
await visit("stok", `goNav('stock')`);
console.log(JSON.stringify({ width: W, dark: !!dark, results, errors }, null, 1));
ws.close(); chrome.kill();

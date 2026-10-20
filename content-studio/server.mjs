// Nelin Batik Content Studio: local web app (dashboard + REST API + scheduler).
// Start with `npm start`, then open http://127.0.0.1:8095
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./lib/store.mjs";
import { createClaude } from "./lib/claude.mjs";
import { createConnectors } from "./lib/connectors.mjs";
import { createOrchestrator } from "./lib/orchestrator.mjs";
import { AGENTS, LATER_AGENTS } from "./lib/agents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8095);
const HOST = process.env.HOST || "127.0.0.1";
const API_TOKEN = process.env.API_TOKEN || "";
const DATA_DIR = path.resolve(here, process.env.DATA_DIR || "data");
const TICK_MS = Number(process.env.TICK_MS || 60_000);

const store = openStore(DATA_DIR);
store.failStaleRuns();
const claude = createClaude({ apiKey: process.env.ANTHROPIC_API_KEY });
const connectors = createConnectors();
const studio = createOrchestrator({ store, claude, connectors });

const STATUSES = ["idea", "writing", "checking", "review", "scheduled", "ready", "posted", "failed"];
const EDITABLE = ["caption", "hashtags", "callToAction", "topic", "product", "platform", "format", "scheduledAt", "goal", "angle"];

function stats() {
  const month = new Date().toISOString().slice(0, 7);
  const runs = store.listRuns(3000).filter((r) => (r.startedAt || "").startsWith(month));
  const byAgent = {};
  for (const r of runs) {
    const a = (byAgent[r.agent] ||= { runs: 0, errors: 0, costUsd: 0, ms: 0 });
    a.runs++;
    if (r.status === "error") a.errors++;
    a.costUsd += r.costUsd || 0;
    a.ms += r.ms || 0;
  }
  const posts = store.listPosts();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, posts.filter((p) => p.status === s).length]));
  return {
    month,
    costUsd: store.costThisMonthUsd(),
    budgetUsd: store.settings.monthlyBudgetUsd,
    runs: runs.length,
    byAgent,
    byStatus,
  };
}

function agentsInfo() {
  const runs = store.listRuns(3000);
  const active = Object.entries(AGENTS).map(([name, a]) => {
    const mine = runs.filter((r) => r.agent === name);
    return {
      name,
      label: a.label,
      job: a.job,
      model: claude.demo ? "demo" : a.model,
      running: mine.some((r) => r.status === "running"),
      lastRun: mine[0] || null,
      phase: "Aktif",
    };
  });
  return [...active, ...LATER_AGENTS.map((a) => ({ ...a, running: false, lastRun: null }))];
}

// ---- HTTP plumbing ----------------------------------------------------------

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function guard(req) {
  if (API_TOKEN) {
    return req.headers.authorization === `Bearer ${API_TOKEN}` ? null : [401, "token salah atau tidak ada"];
  }
  // Without a token the API only answers on this computer: refuse other Host
  // names (DNS rebinding) and cross-site form posts (needs the custom header).
  if (!LOCAL_HOSTS.has(req.headers.host)) return [403, "hanya bisa diakses dari komputer ini"];
  if (req.method !== "GET" && req.headers["x-studio"] !== "1") return [403, "header X-Studio: 1 wajib"];
  return null;
}

const routes = [
  ["GET", /^\/api\/status$/, () => [200, { demo: claude.demo, busy: studio.busy, needsToken: !!API_TOKEN, ...stats() }]],
  ["GET", /^\/api\/stats$/, () => [200, stats()]],
  ["GET", /^\/api\/posts$/, (req, m, q) => {
    const status = q.get("status");
    const posts = store.listPosts().filter((p) => !status || p.status === status);
    return [200, posts];
  }],
  ["POST", /^\/api\/posts$/, (req, m, q, body) => {
    if (!body.topic || !body.scheduledAt) return [400, { error: "topic dan scheduledAt wajib" }];
    const post = studio.addIdea({
      topic: String(body.topic),
      product: String(body.product || ""),
      goal: String(body.goal || "Jualan"),
      angle: String(body.angle || ""),
      platform: body.platform || "instagram",
      format: body.format || "foto",
      scheduledAt: new Date(body.scheduledAt).toISOString(),
    });
    return [201, post];
  }],
  ["GET", /^\/api\/posts\/([\w-]+)$/, (req, m) => {
    const post = store.getPost(m[1]);
    return post ? [200, post] : [404, { error: "posting tidak ada" }];
  }],
  ["PATCH", /^\/api\/posts\/([\w-]+)$/, (req, m, q, body) => {
    const patch = {};
    for (const key of EDITABLE) if (key in body) patch[key] = body[key];
    if (patch.scheduledAt) patch.scheduledAt = new Date(patch.scheduledAt).toISOString();
    const post = store.updatePost(m[1], patch, "Diubah manual");
    return post ? [200, post] : [404, { error: "posting tidak ada" }];
  }],
  ["DELETE", /^\/api\/posts\/([\w-]+)$/, (req, m) => (store.deletePost(m[1]) ? [200, { ok: true }] : [404, { error: "posting tidak ada" }])],
  ["POST", /^\/api\/posts\/([\w-]+)\/approve$/, (req, m) => {
    const post = studio.approve(m[1]);
    if (post) studio.tick();
    return post ? [200, store.getPost(m[1])] : [409, { error: "posting belum siap disetujui" }];
  }],
  ["POST", /^\/api\/posts\/([\w-]+)\/reject$/, (req, m, q, body) => {
    const post = studio.rewrite(m[1], String(body.note || ""));
    return post ? [200, post] : [404, { error: "posting tidak ada" }];
  }],
  ["POST", /^\/api\/posts\/([\w-]+)\/posted$/, (req, m, q, body) => {
    const post = studio.markPosted(m[1], String(body.url || ""));
    return post ? [200, post] : [404, { error: "posting tidak ada" }];
  }],
  ["POST", /^\/api\/plan$/, (req, m, q, body) => {
    const weekStart = String(body.weekStart || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return [400, { error: "weekStart harus YYYY-MM-DD" }];
    studio.planWeek({ weekStart, count: body.count, notes: String(body.notes || "") });
    return [202, { ok: true, weekStart }];
  }],
  ["GET", /^\/api\/runs$/, (req, m, q) => [200, store.listRuns(Number(q.get("limit")) || 200)]],
  ["GET", /^\/api\/agents$/, () => [200, agentsInfo()]],
  ["GET", /^\/api\/connectors$/, () => [200, connectors.health()]],
  ["GET", /^\/api\/events$/, (req, m, q) => [200, store.listEvents(Number(q.get("limit")) || 100)]],
  ["GET", /^\/api\/settings$/, () => [200, store.settings]],
  ["PUT", /^\/api\/settings$/, (req, m, q, body) => [200, store.updateSettings(body)]],
];

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function serveStatic(req, res, pathname) {
  const publicDir = path.join(here, "public");
  const file = path.normalize(path.join(publicDir, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);

  const denied = guard(req);
  if (denied) return send(res, denied[0], { error: denied[1] });

  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) continue;
    try {
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
      const [code, payload] = await handler(req, match, url.searchParams, body);
      return send(res, code, payload);
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }
  send(res, 404, { error: "endpoint tidak ada" });
});

server.listen(PORT, HOST, () => {
  console.log(`Nelin Batik Content Studio jalan di http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
  console.log(claude.demo ? "Mode DEMO (belum ada ANTHROPIC_API_KEY): agen memakai contoh tulisan." : "Claude API tersambung.");
});

const timer = setInterval(() => studio.tick(), TICK_MS);
studio.tick();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
}

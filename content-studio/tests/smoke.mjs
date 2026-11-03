// End-to-end check in demo mode (no API key, no network):
// plan a week -> agents write -> approve -> scheduler makes it "ready" -> mark posted.
// Run: npm test
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
const PORT = 18095;
const base = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, ANTHROPIC_API_KEY: "", API_TOKEN: "", PORT: String(PORT), DATA_DIR: dataDir, TICK_MS: "500", WEBHOOK_URL: "" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("jalan di") && resolve()));

const api = async (method, url, body, headers = { "x-studio": "1" }) => {
  const res = await fetch(base + url, { method, headers: { ...headers, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const waitIdle = async () => {
  for (let i = 0; i < 100; i++) {
    const { data } = await api("GET", "/api/status");
    if (!data.busy) return data;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("agents never finished");
};

try {
  const page = await fetch(base + "/");
  check(page.status === 200 && (await page.text()).includes("Content Studio"), "dashboard page served");

  const status = await api("GET", "/api/status");
  check(status.data.demo === true, "demo mode without API key");

  check((await api("POST", "/api/plan", { weekStart: "2026-10-26" }, {})).status === 403, "POST without X-Studio header refused");
  check((await api("POST", "/api/plan", { weekStart: "bad" })).status === 400, "bad weekStart rejected");

  check((await api("POST", "/api/plan", { weekStart: "2026-10-26", count: 4 })).status === 202, "plan accepted");
  const afterPlan = await waitIdle();
  const posts = (await api("GET", "/api/posts")).data;
  check(posts.length === 4, `planner created 4 posts (got ${posts.length})`);
  check(posts.every((p) => p.status === "review" && p.caption && p.design && p.review), "all posts written, designed, reviewed, waiting approval");
  check(posts.every((p) => p.scheduledAt.startsWith("2026-10-2") || p.scheduledAt.startsWith("2026-11-0")), "scheduled inside the planned week");
  check(afterPlan.byStatus.review === 4, "status counts by state");

  const runs = (await api("GET", "/api/runs")).data;
  check(runs.length === 1 + 4 * 3 && runs.every((r) => r.status === "ok"), `13 agent runs logged ok (got ${runs.length})`);

  // Approve one post scheduled in the past: the scheduler should make it "ready".
  const first = posts[0];
  await api("PATCH", `/api/posts/${first.id}`, { scheduledAt: new Date(Date.now() - 60000).toISOString() });
  const approved = await api("POST", `/api/posts/${first.id}/approve`);
  check(approved.status === 200 && approved.data.status === "ready", "approved past-due post becomes 'Siap diposting'");

  const second = posts[1];
  const approved2 = await api("POST", `/api/posts/${second.id}/approve`);
  check(approved2.data.status === "scheduled", "approved future post is scheduled");
  check((await api("POST", `/api/posts/${second.id}/approve`)).status === 409, "approving twice refused");

  const posted = await api("POST", `/api/posts/${first.id}/posted`, { url: "https://instagram.com/p/test" });
  check(posted.data.status === "posted", "marked as posted");

  const third = posts[2];
  await api("POST", `/api/posts/${third.id}/reject`, { note: "lebih singkat" });
  await waitIdle();
  const rewritten = (await api("GET", `/api/posts/${third.id}`)).data;
  check(rewritten.status === "review" && rewritten.attempts === 2, "'Minta ubah' sends it back through the agents");

  const idea = await api("POST", "/api/posts", { topic: "Batik untuk kondangan", scheduledAt: "2026-10-30T19:00:00+07:00" });
  check(idea.status === 201, "manual idea accepted");
  await waitIdle();
  check((await api("GET", `/api/posts/${idea.data.id}`)).data.status === "review", "manual idea written by agents");

  check((await api("DELETE", `/api/posts/${posts[3].id}`)).data?.ok === true, "post deleted");

  const settings = await api("PUT", "/api/settings", { postsPerWeek: 5, bogus: 1 });
  check(settings.data.postsPerWeek === 5 && !("bogus" in settings.data), "settings saved, unknown keys ignored");

  const connectors = (await api("GET", "/api/connectors")).data;
  check(connectors.some((c) => c.name === "instagram") && connectors.some((c) => c.name === "claude" && !c.ok), "connectors health listed");

  const events = (await api("GET", "/api/events")).data;
  check(events.some((e) => e.type === "post.published") && events.some((e) => e.type === "post.ready_for_review"), "events recorded");

  const agents = (await api("GET", "/api/agents")).data;
  check(agents.length === 6, "6 agents listed (4 active + 2 later)");
} catch (error) {
  failures++;
  console.error(error);
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);

// Tiny JSON-file database. One file (data/db.json), written atomically
// (temp file + rename) so a crash or power cut never leaves it half-written.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_SETTINGS = {
  shopName: "Nelin Batik",
  city: "Pekalongan",
  language: "Indonesia",
  brandVoice:
    "Ramah, hangat, bangga dengan batik Pekalongan. Bahasa Indonesia santai tapi sopan, sesekali sapaan Jawa (monggo, matur nuwun). Tidak lebay, tidak janji palsu. Selalu ajak chat WhatsApp untuk order.",
  products:
    "Contoh (ganti dengan produk asli):\n- Kemeja batik pria lengan panjang, katun primisima\n- Daster batik cap, adem untuk sehari-hari\n- Kain batik tulis motif Jlamprang\n- Seragam batik kantor / sekolah (bisa kodian)",
  promos: "",
  whatsappLink: "",
  platforms: ["instagram", "facebook"],
  postsPerWeek: 7,
  postTimes: ["11:00", "19:00"],
  requireApproval: true,
  monthlyBudgetUsd: 12,
  hideOwnerName: true,
};

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "db.json");
  let db = { posts: [], runs: [], events: [], settings: { ...DEFAULT_SETTINGS } };
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    db = { ...db, ...saved, settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) } };
  }

  function save() {
    // Keep the log tables bounded so the file stays small.
    if (db.events.length > 2000) db.events = db.events.slice(-2000);
    if (db.runs.length > 3000) db.runs = db.runs.slice(-3000);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, file);
  }

  const now = () => new Date().toISOString();
  const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

  return {
    get settings() {
      return db.settings;
    },
    updateSettings(patch) {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in patch) db.settings[key] = patch[key];
      }
      save();
      return db.settings;
    },

    listPosts() {
      return [...db.posts].sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));
    },
    getPost(postId) {
      return db.posts.find((p) => p.id === postId) || null;
    },
    createPost(fields) {
      const post = {
        id: id("post"),
        status: "idea",
        attempts: 0,
        history: [],
        createdAt: now(),
        updatedAt: now(),
        ...fields,
      };
      db.posts.push(post);
      save();
      return post;
    },
    updatePost(postId, patch, note) {
      const post = this.getPost(postId);
      if (!post) return null;
      Object.assign(post, patch, { updatedAt: now() });
      if (note) post.history.push({ at: now(), note });
      save();
      return post;
    },
    deletePost(postId) {
      const before = db.posts.length;
      db.posts = db.posts.filter((p) => p.id !== postId);
      save();
      return db.posts.length !== before;
    },

    listRuns(limit = 200) {
      return db.runs.slice(-limit).reverse();
    },
    startRun(fields) {
      const run = { id: id("run"), status: "running", startedAt: now(), ...fields };
      db.runs.push(run);
      save();
      return run;
    },
    finishRun(runId, patch) {
      const run = db.runs.find((r) => r.id === runId);
      if (!run) return null;
      Object.assign(run, patch, { endedAt: now() });
      run.ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
      save();
      return run;
    },
    // Runs interrupted by a restart would otherwise show "running" forever.
    failStaleRuns() {
      for (const run of db.runs) {
        if (run.status === "running") Object.assign(run, { status: "error", error: "Terhenti karena aplikasi ditutup", endedAt: now() });
      }
      save();
    },
    costThisMonthUsd() {
      const month = now().slice(0, 7);
      return db.runs
        .filter((r) => (r.startedAt || "").startsWith(month))
        .reduce((sum, r) => sum + (r.costUsd || 0), 0);
    },

    listEvents(limit = 100) {
      return db.events.slice(-limit).reverse();
    },
    addEvent(type, data = {}) {
      const event = { id: id("evt"), type, at: now(), ...data };
      db.events.push(event);
      save();
      return event;
    },
  };
}

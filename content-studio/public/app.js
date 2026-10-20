// Dashboard for the Content Studio. Everything it shows comes from the REST API.
"use strict";

const STATUS_LABEL = {
  idea: "Ide", writing: "Sedang ditulis", checking: "Diperiksa", review: "Menunggu persetujuan",
  scheduled: "Terjadwal", ready: "Siap diposting", posted: "Terposting", failed: "Gagal",
};
const PLATFORM_LABEL = { instagram: "Instagram", facebook: "Facebook" };
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const state = { tab: "today", status: null, posts: [], filter: "", weekStart: nextMonday(), focus: null };
const view = document.getElementById("view");

// ---- helpers ----------------------------------------------------------------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function token() {
  try { return localStorage.getItem("studioToken") || ""; } catch { return ""; }
}

async function api(method, path, body) {
  const headers = { "x-studio": "1" };
  if (body) headers["content-type"] = "application/json";
  if (token()) headers.authorization = `Bearer ${token()}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    const t = prompt("Masukkan token API Content Studio:");
    if (t) { try { localStorage.setItem("studioToken", t); } catch {} return api(method, path, body); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

// Dates are shown and typed in WIB (UTC+7) whatever the PC's clock zone is.
function wib(iso) {
  return new Date(Date.parse(iso) + 7 * 3600e3);
}
function fmtWhen(iso) {
  if (!iso) return "-";
  const d = wib(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} WIB`;
}
function toInputWib(iso) {
  return wib(iso).toISOString().slice(0, 16);
}
function fromInputWib(value) {
  return new Date(`${value}:00+07:00`).toISOString();
}
function nextMonday() {
  const d = wib(new Date().toISOString());
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const usd = (n) => `US$${(n || 0).toFixed(n < 1 ? 3 : 2)}`;
const badge = (status) => `<span class="badge st-${status}">${esc(STATUS_LABEL[status] || status)}</span>`;

// ---- rendering --------------------------------------------------------------

async function render() {
  const status = await api("GET", "/api/status");
  const pill = document.getElementById("pill");
  pill.className = "pill" + (status.busy ? " busy" : "");
  pill.textContent = status.busy ? "Agen sedang bekerja" : status.demo ? "Mode demo" : "Siap";
  state.posts = await api("GET", "/api/posts");
  const html = await VIEWS[state.tab](status);
  view.innerHTML = (status.demo ? `<div class="banner">Mode demo: agen memakai tulisan contoh. Isi <b>ANTHROPIC_API_KEY</b> di file <code>.env</code> lalu jalankan ulang agar agen menulis sungguhan.</div>` : "") + html;
  if (state.focus) {
    document.getElementById(state.focus)?.scrollIntoView({ block: "center" });
    state.focus = null;
  }
}

function postCard(p) {
  const tags = (p.hashtags || []).join(" ");
  const actions = [];
  if (p.status === "review" || (p.status === "failed" && p.caption)) actions.push(`<button class="btn ok" data-act="approve" data-id="${p.id}">Setujui</button>`);
  if (["review", "scheduled", "failed", "ready"].includes(p.status)) actions.push(`<button class="btn" data-act="reject" data-id="${p.id}">Minta ubah</button>`);
  if (p.caption) actions.push(`<button class="btn" data-act="copy" data-id="${p.id}">Salin caption</button>`);
  if (p.status === "ready" || p.status === "scheduled") actions.push(`<button class="btn primary" data-act="posted" data-id="${p.id}">Sudah diposting</button>`);
  if (!["writing", "checking"].includes(p.status)) actions.push(`<button class="btn" data-act="edit" data-id="${p.id}">Ubah</button>`);
  actions.push(`<button class="btn danger" data-act="delete" data-id="${p.id}">Hapus</button>`);
  const review = p.review
    ? `<div class="muted">Reviewer: ${p.review.pass ? "lolos" : "perlu perbaikan"} · skor ${esc(p.review.score)}/10${p.review.fixes?.length ? `<br>• ${p.review.fixes.map(esc).join("<br>• ")}` : ""}</div>`
    : "";
  const design = p.design
    ? `<details><summary>Arahan foto dari Designer</summary><p><b>Foto:</b> ${esc(p.design.photoBrief)}</p><p><b>Teks di gambar:</b> ${esc(p.design.textOnImage)}</p><p><b>Tata letak:</b> ${esc(p.design.layout)}</p>${p.design.slides?.length ? `<p><b>Slide:</b><br>${p.design.slides.map(esc).join("<br>")}</p>` : ""}</details>`
    : "";
  return `<article class="card post" id="p-${p.id}">
    <div class="head"><div><b>${esc(p.topic)}</b><div class="muted">${esc(PLATFORM_LABEL[p.platform] || p.platform)} · ${esc(p.format)} · ${fmtWhen(p.scheduledAt)}</div></div>${badge(p.status)}</div>
    ${p.caption ? `<div class="caption">${esc(p.caption)}${p.callToAction ? `\n\n${esc(p.callToAction)}` : ""}</div><div class="tags">${esc(tags)}</div>` : `<div class="muted">${p.status === "failed" ? esc(p.error) : "Agen sedang menulis…"}</div>`}
    ${review}${design}
    ${p.postUrl ? `<div class="muted">Link: <a href="${esc(p.postUrl)}" target="_blank" rel="noopener">${esc(p.postUrl)}</a></div>` : ""}
    <details><summary>Riwayat</summary>${(p.history || []).map((h) => `<div class="muted">${fmtWhen(h.at)} · ${esc(h.note)}</div>`).join("")}</details>
    <div class="row actions">${actions.join("")}</div>
  </article>`;
}

const VIEWS = {
  async today(status) {
    const s = status.byStatus;
    const pct = Math.min(100, (status.costUsd / (status.budgetUsd || 1)) * 100);
    const ready = state.posts.filter((p) => p.status === "ready");
    const waiting = state.posts.filter((p) => p.status === "review");
    const events = await api("GET", "/api/events?limit=12");
    return `
      <div class="grid">
        <div class="card stat ${s.review ? "alert" : ""}"><b>${s.review}</b><span>Menunggu persetujuan</span></div>
        <div class="card stat ${s.ready ? "alert" : ""}"><b>${s.ready}</b><span>Siap diposting</span></div>
        <div class="card stat"><b>${s.scheduled}</b><span>Terjadwal</span></div>
        <div class="card stat"><b>${s.posted}</b><span>Terposting</span></div>
        <div class="card stat ${s.failed ? "alert" : ""}"><b>${s.failed}</b><span>Gagal</span></div>
        <div class="card stat"><b>${usd(status.costUsd)}</b><span>Biaya AI bulan ini (batas ${usd(status.budgetUsd)})</span><div class="bar"><i style="width:${pct}%"></i></div></div>
      </div>

      <h2>Buat rencana konten seminggu</h2>
      <form class="card" id="planForm">
        <div class="row">
          <div style="flex:1;min-width:150px"><label>Minggu mulai (Senin)</label><input type="date" name="weekStart" value="${state.weekStart}" required></div>
          <div style="width:120px"><label>Jumlah posting</label><input type="number" name="count" min="1" max="21" placeholder="7"></div>
        </div>
        <label>Catatan untuk agen (opsional)</label>
        <input name="notes" placeholder="misalnya: minggu ini fokus seragam batik kantor">
        <div class="row actions" style="margin-top:12px"><button class="btn primary" ${status.busy ? "disabled" : ""}>Jalankan agen</button><span class="muted">Planner → Writer → Designer → Reviewer, lalu menunggu persetujuan.</span></div>
      </form>

      <h2>Siap diposting sekarang</h2>
      ${ready.length ? `<div class="posts">${ready.map(postCard).join("")}</div>` : `<div class="card empty">Belum ada. Posting yang disetujui muncul di sini saat jamnya tiba.</div>`}

      <h2>Menunggu persetujuan</h2>
      ${waiting.length ? `<div class="posts">${waiting.map(postCard).join("")}</div>` : `<div class="card empty">Tidak ada yang menunggu.</div>`}

      <h2>Aktivitas terakhir</h2>
      <div class="tablewrap"><table><tbody>${events.map((e) => `<tr><td class="muted">${fmtWhen(e.at)}</td><td>${esc(e.type)}</td><td class="muted">${esc(e.error || e.topic || e.agent || e.weekStart || "")}</td></tr>`).join("") || `<tr><td class="empty">Belum ada aktivitas.</td></tr>`}</tbody></table></div>`;
  },

  async posts() {
    const counts = {};
    for (const p of state.posts) counts[p.status] = (counts[p.status] || 0) + 1;
    const list = state.posts.filter((p) => !state.status || p.status === state.status);
    const chip = (key, label) => `<button data-status="${key || ""}" class="${state.status === key ? "on" : ""}">${esc(label)}</button>`;
    return `
      <div class="chips">${chip(null, `Semua (${state.posts.length})`)}${Object.keys(STATUS_LABEL).filter((k) => counts[k]).map((k) => chip(k, `${STATUS_LABEL[k]} (${counts[k]})`)).join("")}</div>
      <details class="card" style="margin-bottom:12px"><summary><b>+ Tambah ide sendiri</b></summary>
        <form id="ideaForm">
          <label>Topik</label><input name="topic" required placeholder="misalnya: Koleksi batik untuk lebaran">
          <label>Produk</label><input name="product" placeholder="misalnya: Kemeja batik pria">
          <div class="row">
            <div style="flex:1"><label>Platform</label><select name="platform"><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select></div>
            <div style="flex:1"><label>Format</label><select name="format"><option>foto</option><option>carousel</option><option>reels</option></select></div>
            <div style="flex:1;min-width:190px"><label>Jadwal (WIB)</label><input type="datetime-local" name="when" required value="${toInputWib(new Date(Date.now() + 864e5).toISOString())}"></div>
          </div>
          <div class="row actions" style="margin-top:12px"><button class="btn primary">Minta agen menulis</button></div>
        </form>
      </details>
      ${list.length ? `<div class="posts">${list.map(postCard).join("")}</div>` : `<div class="card empty">Belum ada posting. Buat rencana di halaman Hari ini.</div>`}`;
  },

  async calendar() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    const cols = days.map((date) => {
      const items = state.posts.filter((p) => wib(p.scheduledAt).toISOString().slice(0, 10) === date);
      const d = new Date(`${date}T00:00:00Z`);
      return `<div class="day"><h4>${DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}</h4>${items
        .map((p) => `<button class="slot st-${p.status}" data-open="${p.id}"><b>${fmtWhen(p.scheduledAt).split(" ")[2]}</b> ${esc(PLATFORM_LABEL[p.platform] || p.platform)}<br>${esc(p.topic)}</button>`)
        .join("") || `<span class="muted">-</span>`}</div>`;
    });
    return `<div class="row" style="margin-bottom:12px"><button class="btn" data-week="-7">‹ Minggu lalu</button><b>${state.weekStart} s/d ${days[6]}</b><button class="btn" data-week="7">Minggu depan ›</button></div>
      <div class="week">${cols.join("")}</div>`;
  },

  async agents(status) {
    const [agents, runs] = await Promise.all([api("GET", "/api/agents"), api("GET", "/api/runs?limit=60")]);
    const topic = (id) => state.posts.find((p) => p.id === id)?.topic || "";
    return `<div class="grid">${agents.map((a) => {
      const m = status.byAgent[a.name] || { runs: 0, errors: 0, costUsd: 0 };
      const dot = a.running ? "run" : a.lastRun?.status === "error" ? "bad" : a.lastRun ? "ok" : "";
      return `<div class="card"><b><span class="dot ${dot}"></span>${esc(a.label)}</b><div class="muted">${esc(a.job)}</div>
        <div class="muted" style="margin-top:6px">${a.phase === "Aktif" ? `Model: ${esc(a.model)}<br>Bulan ini: ${m.runs} kali · ${m.errors} gagal · ${usd(m.costUsd)}` : esc(a.phase)}</div></div>`;
    }).join("")}</div>
      <h2>Riwayat kerja agen</h2>
      <div class="tablewrap"><table><thead><tr><th>Waktu</th><th>Agen</th><th>Posting</th><th>Status</th><th>Lama</th><th>Token (masuk/keluar)</th><th>Biaya</th></tr></thead><tbody>
      ${runs.map((r) => `<tr><td class="muted">${fmtWhen(r.startedAt)}</td><td>${esc(r.agent)}</td><td>${esc(topic(r.postId))}</td><td><span class="dot ${r.status === "ok" ? "ok" : r.status === "error" ? "bad" : "run"}"></span>${esc(r.status === "error" ? r.error : r.status)}</td><td>${r.ms != null ? (r.ms / 1000).toFixed(1) + " dtk" : "…"}</td><td>${r.inputTokens ?? 0} / ${r.outputTokens ?? 0}</td><td>${usd(r.costUsd)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Belum ada.</td></tr>`}
      </tbody></table></div>`;
  },

  async connectors() {
    const list = await api("GET", "/api/connectors");
    return `<div class="tablewrap"><table><thead><tr><th>Koneksi</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td><span class="dot ${c.ok ? "ok" : c.mode === "later" ? "" : "bad"}"></span>${esc(c.status)}</td><td class="muted">${esc(c.detail)}</td></tr>`).join("")}
      </tbody></table></div>
      <h2>API untuk alat lain (n8n, skrip)</h2>
      <div class="card muted">Semua yang ada di dashboard bisa diakses lewat API: <code>GET /api/status</code>, <code>/api/posts</code>, <code>/api/runs</code>, <code>/api/agents</code>, <code>/api/connectors</code>, <code>/api/events</code>; <code>POST /api/plan</code>, <code>/api/posts/:id/approve</code>, <code>/reject</code>, <code>/posted</code>. Lihat README.</div>`;
  },

  async settings() {
    const s = await api("GET", "/api/settings");
    return `<form class="card" id="settingsForm">
      <label>Nama toko</label><input name="shopName" value="${esc(s.shopName)}">
      <label>Gaya bahasa / suara merek</label><textarea name="brandVoice">${esc(s.brandVoice)}</textarea>
      <label>Daftar produk (agen hanya memakai yang tertulis di sini)</label><textarea name="products" style="min-height:140px">${esc(s.products)}</textarea>
      <label>Promo yang sedang berjalan (kosongkan jika tidak ada)</label><textarea name="promos">${esc(s.promos)}</textarea>
      <label>Link WhatsApp untuk order</label><input name="whatsappLink" value="${esc(s.whatsappLink)}" placeholder="https://wa.me/62…">
      <div class="row">
        <div style="flex:1"><label>Bahasa caption</label><select name="language">${["Indonesia", "Indonesia + sedikit Jawa", "Indonesia + English"].map((l) => `<option ${l === s.language ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div style="flex:1"><label>Posting per minggu</label><input type="number" name="postsPerWeek" min="1" max="21" value="${s.postsPerWeek}"></div>
        <div style="flex:1"><label>Jam posting (WIB, pisahkan koma)</label><input name="postTimes" value="${esc(s.postTimes.join(", "))}"></div>
        <div style="flex:1"><label>Batas biaya AI per bulan (US$)</label><input type="number" step="0.5" min="0" name="monthlyBudgetUsd" value="${s.monthlyBudgetUsd}"></div>
      </div>
      <label>Platform</label>
      <div class="row">${["instagram", "facebook"].map((p) => `<label style="margin:0"><input type="checkbox" name="platforms" value="${p}" style="width:auto" ${s.platforms.includes(p) ? "checked" : ""}> ${PLATFORM_LABEL[p]}</label>`).join("")}</div>
      <label><input type="checkbox" name="requireApproval" style="width:auto" ${s.requireApproval ? "checked" : ""}> Setiap posting harus disetujui dulu</label>
      <label><input type="checkbox" name="hideOwnerName" style="width:auto" ${s.hideOwnerName ? "checked" : ""}> Jangan sebut nama pemilik (atas nama toko)</label>
      <div class="row actions" style="margin-top:14px"><button class="btn primary">Simpan</button></div>
    </form>`;
  },
};

// ---- actions ----------------------------------------------------------------

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("button")?.dataset.tab;
  if (!tab) return;
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  render().catch((err) => toast(err.message));
});

view.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act],[data-status],[data-week],[data-open]");
  if (!el) return;
  try {
    if ("status" in el.dataset) { state.status = el.dataset.status || null; return render(); }
    if (el.dataset.week) { state.weekStart = addDays(state.weekStart, Number(el.dataset.week)); return render(); }
    if (el.dataset.open) {
      state.tab = "posts"; state.status = null; state.focus = `p-${el.dataset.open}`;
      document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "posts"));
      return render();
    }
    const id = el.dataset.id;
    const post = state.posts.find((p) => p.id === id);
    switch (el.dataset.act) {
      case "approve": await api("POST", `/api/posts/${id}/approve`); toast("Disetujui dan dijadwalkan"); break;
      case "reject": {
        const note = prompt("Apa yang perlu diubah? (agen akan menulis ulang)");
        if (note === null) return;
        await api("POST", `/api/posts/${id}/reject`, { note }); toast("Dikirim ke Writer untuk ditulis ulang"); break;
      }
      case "copy":
        await navigator.clipboard.writeText([post.caption, post.callToAction, (post.hashtags || []).join(" ")].filter(Boolean).join("\n\n"));
        toast("Caption disalin"); return;
      case "posted": {
        const url = prompt("Link posting (opsional):", "");
        if (url === null) return;
        await api("POST", `/api/posts/${id}/posted`, { url }); toast("Ditandai sudah diposting"); break;
      }
      case "delete":
        if (!confirm("Hapus posting ini?")) return;
        await api("DELETE", `/api/posts/${id}`); toast("Dihapus"); break;
      case "edit": return openEditor(post);
      case "save": {
        const card = document.getElementById(`p-${id}`);
        const val = (n) => card.querySelector(`[name=${n}]`).value;
        await api("PATCH", `/api/posts/${id}`, {
          topic: val("topic"), caption: val("caption"), callToAction: val("callToAction"),
          hashtags: val("hashtags").split(/\s+/).filter(Boolean), scheduledAt: fromInputWib(val("when")), platform: val("platform"),
        });
        state.editing = null; toast("Disimpan"); break;
      }
      case "cancel": state.editing = null; break;
    }
    await render();
  } catch (err) {
    toast(err.message);
  }
});

function openEditor(p) {
  state.editing = p.id;
  document.getElementById(`p-${p.id}`).innerHTML = `
    <label>Topik</label><input name="topic" value="${esc(p.topic)}">
    <label>Caption</label><textarea name="caption" style="min-height:180px">${esc(p.caption)}</textarea>
    <label>Ajakan</label><input name="callToAction" value="${esc(p.callToAction)}">
    <label>Hashtag (pisahkan spasi)</label><input name="hashtags" value="${esc((p.hashtags || []).join(" "))}">
    <div class="row">
      <div style="flex:1"><label>Platform</label><select name="platform">${Object.keys(PLATFORM_LABEL).map((k) => `<option value="${k}" ${k === p.platform ? "selected" : ""}>${PLATFORM_LABEL[k]}</option>`).join("")}</select></div>
      <div style="flex:1;min-width:190px"><label>Jadwal (WIB)</label><input type="datetime-local" name="when" value="${toInputWib(p.scheduledAt)}"></div>
    </div>
    <div class="row actions"><button class="btn primary" data-act="save" data-id="${p.id}">Simpan</button><button class="btn" data-act="cancel" data-id="${p.id}">Batal</button></div>`;
}

view.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  try {
    if (form.id === "planForm") {
      state.weekStart = data.get("weekStart");
      await api("POST", "/api/plan", { weekStart: state.weekStart, count: Number(data.get("count")) || undefined, notes: data.get("notes") });
      toast("Agen mulai bekerja…");
    } else if (form.id === "ideaForm") {
      await api("POST", "/api/posts", {
        topic: data.get("topic"), product: data.get("product"), platform: data.get("platform"),
        format: data.get("format"), scheduledAt: fromInputWib(data.get("when")),
      });
      toast("Writer mulai menulis…");
    } else if (form.id === "settingsForm") {
      await api("PUT", "/api/settings", {
        shopName: data.get("shopName"), brandVoice: data.get("brandVoice"), products: data.get("products"),
        promos: data.get("promos"), whatsappLink: data.get("whatsappLink"), language: data.get("language"),
        postsPerWeek: Number(data.get("postsPerWeek")) || 7,
        postTimes: String(data.get("postTimes")).split(",").map((t) => t.trim()).filter((t) => /^\d{2}:\d{2}$/.test(t)),
        monthlyBudgetUsd: Number(data.get("monthlyBudgetUsd")) || 0,
        platforms: data.getAll("platforms"),
        requireApproval: data.get("requireApproval") === "on",
        hideOwnerName: data.get("hideOwnerName") === "on",
      });
      toast("Pengaturan disimpan");
    }
    await render();
  } catch (err) {
    toast(err.message);
  }
});

// Refresh on a timer, but never while someone is typing or editing a post.
async function loop() {
  const typing = view.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const formOpen = view.querySelector("details[open] form");
  if (!typing && !state.editing && !formOpen && state.tab !== "settings" && document.visibilityState === "visible") {
    await render().catch((err) => toast(err.message));
  }
  setTimeout(loop, document.getElementById("pill").classList.contains("busy") ? 2500 : 10000);
}
render().catch((err) => toast(err.message)).finally(() => setTimeout(loop, 2500));

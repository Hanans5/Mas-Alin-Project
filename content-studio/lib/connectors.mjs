// Connectors: one small plug-in per platform, each with the same shape:
//   health() -> { ok, status, detail }
//   publish(post) -> { done, url?, note }
// Phase 1 posts by hand: at the scheduled time the post becomes "Siap diposting"
// and the dashboard shows the caption to copy. Instagram/Facebook auto-posting
// arrives in phase 2 (needs a Meta app + Business account).

function manual(platform) {
  return {
    name: platform,
    mode: "manual",
    health: () => ({
      ok: true,
      status: "Manual",
      detail: "Belum tersambung otomatis. Saat jadwal tiba, posting muncul di 'Siap diposting' untuk disalin.",
    }),
    publish: () => ({ done: false, note: "Siap diposting manual" }),
  };
}

export function createConnectors() {
  const list = {
    instagram: manual("instagram"),
    facebook: manual("facebook"),
  };
  return {
    get: (platform) => list[platform] || manual(platform),
    health: () =>
      [
        ...Object.entries(list).map(([name, c]) => ({ name, mode: c.mode, ...c.health() })),
        { name: "claude", mode: "api", ...claudeHealth() },
        { name: "tiktok", mode: "later", ok: false, status: "Tahap 2", detail: "Upload video sebagai draf." },
        { name: "whatsapp", mode: "later", ok: false, status: "Tahap 3", detail: "Kirim permintaan persetujuan ke HP pemilik." },
        { name: "kasir", mode: "later", ok: false, status: "Tahap 3", detail: "Baca produk & stok dari kasir (hanya baca)." },
        { name: "webhook", mode: "webhook", ...webhookHealth() },
      ],
  };
}

function claudeHealth() {
  return process.env.ANTHROPIC_API_KEY
    ? { ok: true, status: "Tersambung", detail: "API key terpasang." }
    : { ok: false, status: "Mode demo", detail: "Isi ANTHROPIC_API_KEY di file .env agar agen menulis sungguhan." };
}

function webhookHealth() {
  return process.env.WEBHOOK_URL
    ? { ok: true, status: "Aktif", detail: `Event dikirim ke ${process.env.WEBHOOK_URL}` }
    : { ok: false, status: "Tidak dipakai", detail: "Opsional: isi WEBHOOK_URL (misalnya n8n) untuk menerima event." };
}

// Sends an event to the optional webhook (n8n etc.). Never throws.
export async function sendWebhook(event) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.warn(`webhook gagal: ${error.message}`);
  }
}

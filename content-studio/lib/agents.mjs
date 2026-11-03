// The content agents. Each one has a single job, its own instructions and a
// JSON schema for its answer. The orchestrator decides who works next.
// demo() produces sample output so the studio can be tried without an API key.

const MODEL_MAIN = process.env.MODEL_MAIN || "claude-sonnet-5-5";
const MODEL_CHECK = process.env.MODEL_CHECK || "claude-haiku-5-5";

const PLATFORMS = ["instagram", "facebook"];
const FORMATS = ["foto", "carousel", "reels"];

function brandContext(s) {
  return [
    `Toko: ${s.shopName}, toko batik di ${s.city}.`,
    `Gaya bahasa: ${s.brandVoice}`,
    `Bahasa caption: ${s.language}.`,
    `Produk:\n${s.products}`,
    s.promos ? `Promo yang sedang berjalan:\n${s.promos}` : "Tidak ada promo khusus saat ini; jangan mengarang diskon.",
    s.whatsappLink ? `Link WhatsApp untuk order: ${s.whatsappLink}` : "Ajakan order: chat WhatsApp toko (link ditambahkan nanti).",
    s.hideOwnerName
      ? "Pemilik toko ingin tetap anonim: jangan pernah menyebut nama atau wajah pemilik; atas nama toko saja."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = { type: "string" };

export const AGENTS = {
  planner: {
    label: "Planner",
    job: "Menyusun kalender konten mingguan",
    model: MODEL_MAIN,
    effort: "medium",
    schema: obj({
      ideas: {
        type: "array",
        items: obj({
          day: { type: "integer", description: "0 = hari pertama minggu ini" },
          time: { type: "string", description: "HH:MM WIB" },
          platform: { type: "string", enum: PLATFORMS },
          format: { type: "string", enum: FORMATS },
          topic: str,
          product: str,
          goal: str,
          angle: str,
        }),
      },
    }),
    system: (s) =>
      `Kamu perencana konten media sosial untuk ${s.shopName}.\n${brandContext(s)}\n` +
      "Susun ide konten yang beragam: produk unggulan, cerita proses membatik, tips merawat batik, testimoni (tanpa nama pelanggan asli), momen/hari penting, dan ajakan order. Jangan semua jualan keras.",
    prompt: (s, { weekStart, count, notes }) =>
      `Buat ${count} ide posting untuk minggu yang dimulai ${weekStart} (7 hari).\n` +
      `Platform yang dipakai: ${s.platforms.join(", ")}. Jam posting yang disarankan: ${s.postTimes.join(", ")} WIB.\n` +
      "Sebar merata dalam seminggu. Perhatikan hari penting di Indonesia pada minggu itu jika ada (misalnya Hari Batik Nasional 2 Oktober, tanggal gajian, Harbolnas)." +
      (notes ? `\nCatatan dari pemilik: ${notes}` : ""),
    demo: (s, { count }) => ({
      ideas: Array.from({ length: count }, (_, i) => ({
        day: i % 7,
        time: s.postTimes[i % s.postTimes.length],
        platform: s.platforms[i % s.platforms.length],
        format: FORMATS[i % FORMATS.length],
        topic: ["Koleksi kemeja batik terbaru", "Proses batik cap di Pekalongan", "Tips mencuci batik agar awet", "Daster adem untuk di rumah", "Seragam batik kodian", "Motif Jlamprang dan maknanya", "Ajak mampir ke toko"][i % 7],
        product: ["Kemeja batik pria", "Batik cap", "Semua kain batik", "Daster batik", "Seragam batik", "Kain batik tulis", "Semua produk"][i % 7],
        goal: ["Jualan", "Cerita merek", "Edukasi", "Jualan", "Pesanan grosir", "Edukasi", "Kunjungan toko"][i % 7],
        angle: "Contoh ide dari mode demo.",
      })),
    }),
  },

  writer: {
    label: "Writer",
    job: "Menulis caption dan hashtag",
    model: MODEL_MAIN,
    effort: "medium",
    schema: obj({
      caption: str,
      hashtags: { type: "array", items: str },
      callToAction: str,
    }),
    system: (s) =>
      `Kamu penulis caption media sosial untuk ${s.shopName}.\n${brandContext(s)}\n` +
      "Tulis caption yang enak dibaca di HP: kalimat pendek, 1 baris pembuka yang menarik, boleh emoji secukupnya. " +
      "Jangan mengarang harga, stok, diskon atau testimoni. 5 sampai 12 hashtag relevan (lokal Pekalongan + batik).",
    prompt: (s, { post, fixes }) =>
      `Tulis caption untuk posting ${post.platform} (${post.format}).\n` +
      `Topik: ${post.topic}\nProduk: ${post.product}\nTujuan: ${post.goal}\nSudut pandang: ${post.angle}\n` +
      (post.caption ? `\nCaption sebelumnya:\n${post.caption}\n` : "") +
      (fixes?.length ? `\nPerbaiki hal berikut:\n- ${fixes.join("\n- ")}` : ""),
    demo: (s, { post, fixes }) => ({
      caption:
        `${post.topic} ✨\n\nBatik asli ${s.city}, dibuat dengan sepenuh hati oleh pengrajin lokal. ` +
        `${post.product} siap menemani harimu.\n\n(Caption contoh dari mode demo${fixes?.length ? ", sudah diperbaiki" : ""}.)`,
      hashtags: ["#batikpekalongan", "#nelinbatik", "#batikindonesia", "#kotabatik", "#cintabatik"],
      callToAction: "Chat WhatsApp kami untuk order 🙏",
    }),
  },

  designer: {
    label: "Designer",
    job: "Menyiapkan arahan gambar dari foto produk asli",
    model: MODEL_MAIN,
    effort: "low",
    schema: obj({
      photoBrief: str,
      textOnImage: str,
      layout: str,
      slides: { type: "array", items: str },
    }),
    system: (s) =>
      `Kamu desainer konten untuk ${s.shopName}. Gunakan FOTO PRODUK ASLI (bukan gambar AI), dengan template toko: logo NB di pojok, warna mahogany.\n${brandContext(s)}`,
    prompt: (s, { post }) =>
      `Buat arahan visual untuk posting ${post.platform} format ${post.format}.\nTopik: ${post.topic}\nProduk: ${post.product}\nCaption:\n${post.caption}\n` +
      "photoBrief = foto apa yang perlu diambil/dipilih (angle, latar, model atau tidak). textOnImage = teks singkat di gambar (maks 6 kata). " +
      "slides = isi tiap slide untuk carousel/reels (kosongkan untuk foto tunggal).",
    demo: (s, { post }) => ({
      photoBrief: `Foto ${post.product} di latar kayu terang, cahaya alami dari jendela, detail motif terlihat jelas.`,
      textOnImage: post.topic.split(" ").slice(0, 5).join(" "),
      layout: "Foto penuh, logo NB pojok kanan bawah, teks di sepertiga atas.",
      slides: post.format === "foto" ? [] : ["Slide 1: foto utama", "Slide 2: detail motif", "Slide 3: ajakan order"],
    }),
  },

  reviewer: {
    label: "Reviewer",
    job: "Memeriksa posting sebelum dilihat pemilik",
    model: MODEL_CHECK,
    effort: "low",
    schema: obj({
      pass: { type: "boolean" },
      fixes: { type: "array", items: str },
      score: { type: "integer", description: "1 sampai 10" },
    }),
    system: (s) =>
      `Kamu pemeriksa mutu konten untuk ${s.shopName}.\n${brandContext(s)}\n` +
      "Tolak (pass=false) jika: ada harga/diskon/stok yang dikarang, menyebut nama pemilik atau pelanggan asli, salah ketik parah, bahasa kasar, janji berlebihan, tidak sesuai topik, tidak ada ajakan order. Perbaikan kecil gaya bahasa tidak perlu ditolak.",
    prompt: (s, { post }) =>
      `Periksa posting ini.\nPlatform: ${post.platform}\nTopik: ${post.topic}\nCaption:\n${post.caption}\nHashtag: ${(post.hashtags || []).join(" ")}\nAjakan: ${post.callToAction}`,
    demo: () => ({ pass: true, fixes: [], score: 8 }),
  },
};

// Shown on the Agen page so Mas Alin sees the whole team, including later phases.
export const LATER_AGENTS = [
  { name: "publisher", label: "Publisher", job: "Memposting otomatis ke Instagram/Facebook", phase: "Tahap 2 (setelah akun Meta tersambung)" },
  { name: "analyst", label: "Analyst", job: "Membaca like, jangkauan, klik WA", phase: "Tahap 2" },
];

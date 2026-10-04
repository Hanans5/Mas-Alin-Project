/// <reference path="../pb_data/types.d.ts" />
// Online store API. Public routes identify an order by number + secret token
// (?t=…, in the link the customer gets); staff routes need owner/admin.
// Status flow:
//   menunggu_bayar → (proof uploaded) menunggu_verifikasi → (admin) diproses
//   → dikirim (resi) | siap_diambil → selesai
//   any unpaid state → batal / kedaluwarsa (24 h), stock returned

// ── public: catalogue ───────────────────────────────
routerAdd("GET", "/api/store/catalog", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const s = L.settings(e.app);
  const products = L.query(e.app, `
    SELECT p.id, p.name, p.sku, p.category, p.price, p.stock, p.weight, p.description, p.photo, p.created,
           COALESCE((SELECT SUM(i.qty) FROM sale_items i JOIN sales x ON x.id = i.sale WHERE i.product = p.id AND x.status != 'batal'), 0) AS sold
      FROM products p WHERE p.active = 1 AND p.hide_online = 0 ORDER BY sold DESC, p.name`,
    {}, { id: "", name: "", sku: "", category: "", price: 0, stock: 0, weight: 0, description: "", photo: "", created: "", sold: 0 });
  const pc = e.app.findCollectionByNameOrId("products").id;
  for (const p of products) p.photo = p.photo ? `/api/files/${pc}/${p.id}/${p.photo}` : "";
  const categories = L.query(e.app, "SELECT id, name FROM categories ORDER BY name", {}, { id: "", name: "" });
  e.response.header().set("Cache-Control", "public, max-age=30");
  return e.json(200, {
    store: {
      name: s.getString("store_name"), tagline: s.getString("store_tagline"), address: s.getString("address"),
      wa: s.getString("wa_number"), hours: s.getString("open_hours"),
      clarity: s.getString("clarity_id"),
      logo: s.getString("logo") ? `/api/files/${s.collection().id}/${s.id}/${s.getString("logo")}` : "",
    },
    categories, products,
  });
});

// ── public: shipping estimate ───────────────────────
routerAdd("GET", "/api/store/shipping", (e) => {
  const SL = require(`${__hooks}/store_lib.js`);
  const q = e.requestInfo().query;
  const grams = Math.max(1, parseInt(q.weight, 10) || SL.DEFAULT_WEIGHT);
  return e.json(200, { provinces: Object.keys(SL.PROVINCES).sort(), options: q.province ? SL.estimateShipping(q.province, grams) : [] });
});

// ── public: place an order ──────────────────────────
// Body: { items:[{product,qty}], name, phone, email?, delivery:"kirim"|"ambil",
//         address?:{province,city,district,postal,street}, courier?, service?,
//         payment:"qris"|"transfer", note? }
routerAdd("POST", "/api/store/orders", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const SL = require(`${__hooks}/store_lib.js`);
  const b = e.requestInfo().body || {};
  const name = String(b.name || "").trim().slice(0, 100);
  const phone = SL.normPhone(b.phone);
  const email = String(b.email || "").trim().slice(0, 120);
  if (name.length < 2) throw new BadRequestError("Isi nama penerima.");
  if (phone.length < 10 || phone.length > 15) throw new BadRequestError("Nomor WhatsApp tidak valid.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestError("Alamat email tidak valid.");
  if (["kirim", "ambil"].indexOf(b.delivery) === -1) throw new BadRequestError("Pilih kirim atau ambil di toko.");
  if (["qris", "transfer"].indexOf(b.payment) === -1) throw new BadRequestError("Pilih QRIS atau transfer bank.");

  // Abuse guard: a handful of orders per IP per 15 minutes, and a cap on
  // open unpaid orders per phone (each one holds stock).
  const ip = e.realIP();
  const since = new Date(Date.now() - 15 * 60e3).toISOString().replace("T", " ");
  const recent = L.query(e.app, "SELECT COUNT(*) AS n FROM web_orders WHERE ip = {:ip} AND created > {:t}", { ip, t: since }, { n: 0 })[0].n;
  if (recent >= 6) throw new ApiError(429, "Terlalu banyak pesanan dari perangkat ini. Coba lagi sebentar lagi.");
  const open = L.query(e.app, "SELECT COUNT(*) AS n FROM web_orders WHERE phone = {:p} AND status IN ('menunggu_bayar','menunggu_verifikasi')", { p: phone }, { n: 0 })[0].n;
  if (open >= 3) throw new BadRequestError("Nomor ini masih punya 3 pesanan yang belum dibayar. Selesaikan atau batalkan dulu.");

  let address = null;
  if (b.delivery === "kirim") {
    const a = b.address || {};
    address = {
      province: String(a.province || ""), city: String(a.city || "").trim().slice(0, 80),
      district: String(a.district || "").trim().slice(0, 80), postal: String(a.postal || "").replace(/\D/g, "").slice(0, 5),
      street: String(a.street || "").trim().slice(0, 300),
    };
    if (!SL.PROVINCES[address.province]) throw new BadRequestError("Pilih provinsi.");
    if (!address.city || !address.district || address.street.length < 8) throw new BadRequestError("Lengkapi alamat: kota, kecamatan, dan alamat jalan.");
    if (address.postal.length !== 5) throw new BadRequestError("Kode pos harus 5 angka.");
  }

  let number = "", token = "", track = "";
  e.app.runInTransaction((tx) => {
    const cart = SL.priceStoreCart(tx, b.items);
    let shipping = 0, courier = "", service = "", etd = "";
    if (b.delivery === "kirim") {
      const opt = SL.estimateShipping(address.province, cart.weight).find((o) => o.courier === b.courier && o.service === b.service);
      if (!opt) throw new BadRequestError("Pilih kurir pengiriman.");
      shipping = opt.cost; courier = opt.courier; service = opt.service; etd = opt.etd;
    }
    const unique = 101 + Math.floor(Math.random() * 399);
    number = SL.nextOrderNumber(tx, L.wibDate());
    token = $security.randomString(32);
    track = SL.newTrackCode(tx);

    const o = new Record(tx.findCollectionByNameOrId("web_orders"));
    o.load({
      number, token, track, status: "menunggu_bayar", name, phone, email, address, delivery: b.delivery,
      items: cart.lines.map((l) => ({ product: l.p.id, name: l.p.getString("name"), sku: l.p.getString("sku"), qty: l.qty, price: l.price, hpp: l.hpp, weight: l.weight })),
      courier, service, etd, weight: cart.weight, subtotal: cart.subtotal, shipping, unique_code: unique,
      total: cart.subtotal + shipping + unique, payment: b.payment, note: String(b.note || "").slice(0, 500),
      expires_at: new Date(Date.now() + 24 * 3600e3).toISOString().replace("T", " "), ip,
    });
    SL.addHistory(o, "menunggu_bayar", "Pesanan dibuat");
    tx.save(o);
    for (const l of cart.lines) L.moveStock(tx, { product: l.p, type: "pesanan", qty: -l.qty, ref: number, note: "Pesanan online (dipesan)" });
  });

  const o = e.app.findFirstRecordByFilter("web_orders", "number = {:n}", { n: number });
  const s = L.settings(e.app);
  SL.sendMail(e.app, email, `Pesanan ${number} — ${s.getString("store_name")}`,
    `<p>Halo ${name},</p><p>Pesanan <b>${number}</b> sudah kami terima. Total <b>Rp ${L.idr(o.getInt("total"))}</b>.</p>` +
    `<p>Selesaikan pembayaran dalam 24 jam lewat halaman pesananmu.</p>` +
    `<p>Lacak pesanan: <a href="${SL.orderLinks(e.app, o).track}">${SL.orderLinks(e.app, o).track}</a></p>`);
  return e.json(200, { number, token, track });
});

// ── public: view / pay / cancel own order ───────────
routerAdd("GET", "/api/store/orders/{number}", (e) => {
  const SL = require(`${__hooks}/store_lib.js`);
  const t = String(e.requestInfo().query.t || "");
  let o;
  try { o = e.app.findFirstRecordByFilter("web_orders", "number = {:n}", { n: e.request.pathValue("number") }); }
  catch (_) { throw new NotFoundError("Pesanan tidak ditemukan."); }
  if (!t || !$security.equal(t, o.getString("token"))) throw new NotFoundError("Pesanan tidak ditemukan.");
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, SL.publicOrder(e.app, o));
});

// Tracking page: progress only, looked up by the short code in toko…/t/{code}.
routerAdd("GET", "/api/store/track/{code}", (e) => {
  const SL = require(`${__hooks}/store_lib.js`);
  const code = String(e.request.pathValue("code") || "").toUpperCase();
  let o = null;
  if (/^[A-Z2-9]{8}$/.test(code)) { try { o = e.app.findFirstRecordByFilter("web_orders", "track = {:c}", { c: code }); } catch (_) {} }
  if (!o) throw new NotFoundError("Kode lacak tidak ditemukan.");
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, SL.trackView(e.app, o));
});

// multipart/form-data with a "proof" file
routerAdd("POST", "/api/store/orders/{number}/proof", (e) => {
  const SL = require(`${__hooks}/store_lib.js`);
  const t = String(e.requestInfo().query.t || "");
  let o;
  try { o = e.app.findFirstRecordByFilter("web_orders", "number = {:n}", { n: e.request.pathValue("number") }); }
  catch (_) { throw new NotFoundError("Pesanan tidak ditemukan."); }
  if (!t || !$security.equal(t, o.getString("token"))) throw new NotFoundError("Pesanan tidak ditemukan.");
  if (["menunggu_bayar", "menunggu_verifikasi"].indexOf(o.getString("status")) === -1) throw new BadRequestError("Pesanan ini tidak menunggu pembayaran.");
  const files = e.findUploadedFiles("proof");
  if (!files || !files.length) throw new BadRequestError("Pilih foto bukti pembayaran.");
  o.set("proof", files[0]);
  o.set("status", "menunggu_verifikasi");
  SL.addHistory(o, "menunggu_verifikasi", "Bukti pembayaran diunggah");
  e.app.save(o);
  return e.json(200, SL.publicOrder(e.app, o));
});

routerAdd("POST", "/api/store/orders/{number}/cancel", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const SL = require(`${__hooks}/store_lib.js`);
  const t = String(e.requestInfo().query.t || "");
  e.app.runInTransaction((tx) => {
    let o;
    try { o = tx.findFirstRecordByFilter("web_orders", "number = {:n}", { n: e.request.pathValue("number") }); }
    catch (_) { throw new NotFoundError("Pesanan tidak ditemukan."); }
    if (!t || !$security.equal(t, o.getString("token"))) throw new NotFoundError("Pesanan tidak ditemukan.");
    if (o.getString("status") !== "menunggu_bayar") throw new BadRequestError("Pesanan yang sudah dibayar dibatalkan lewat WhatsApp toko.");
    for (const it of SL.json(o, "items")) L.moveStock(tx, { product: it.product, type: "batal_pesanan", qty: it.qty, ref: o.getString("number"), note: "Dibatalkan pembeli" });
    o.set("status", "batal");
    SL.addHistory(o, "batal", "Dibatalkan pembeli");
    tx.save(o);
  });
  return e.json(200, { ok: true });
});

// ── staff actions ───────────────────────────────────
// POST /api/store/admin/{id}/{action}
//   shipping {fee}   change the shipping cost (only before payment is confirmed)
//   confirm          payment received → creates the sale
//   reject {reason}  proof not valid → back to menunggu_bayar
//   ship {resi}      handed to courier
//   resi {resi}      correct the resi of a shipped order
//   ready            pickup order ready at the shop
//   complete         done
//   cancel {reason}  cancel; returns stock, voids the sale if there was one
routerAdd("POST", "/api/store/admin/{id}/{action}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const SL = require(`${__hooks}/store_lib.js`);
  L.requireRole(e, ["owner", "admin"]);
  const action = e.request.pathValue("action");
  const b = e.requestInfo().body || {};
  const who = e.auth.getString("name") || e.auth.getString("username");

  e.app.runInTransaction((tx) => {
    let o;
    try { o = tx.findRecordById("web_orders", e.request.pathValue("id")); } catch (_) { throw new NotFoundError("Pesanan tidak ditemukan."); }
    const st = o.getString("status");
    const need = (ok, msg) => { if (ok.indexOf(st) === -1) throw new BadRequestError(msg || `Tidak bisa dari status ${st}.`); };
    const number = o.getString("number");

    if (action === "shipping") {
      need(["menunggu_bayar", "menunggu_verifikasi"], "Ongkir hanya bisa diubah sebelum pembayaran dikonfirmasi.");
      if (o.getString("delivery") !== "kirim") throw new BadRequestError("Pesanan ini diambil di toko.");
      const fee = L.int(b.fee, "Ongkir");
      if (fee < 0) throw new BadRequestError("Ongkir tidak boleh minus.");
      const before = o.getInt("shipping");
      o.set("shipping", fee);
      o.set("shipping_adjusted", true);
      o.set("total", o.getInt("subtotal") + fee + o.getInt("unique_code"));
      SL.addHistory(o, st, `Ongkir diubah Rp ${L.idr(before)} → Rp ${L.idr(fee)}`, who);
    } else if (action === "confirm") {
      need(["menunggu_bayar", "menunggu_verifikasi"]);
      // The paid order becomes a normal sale. Stock already left at order time.
      const items = SL.json(o, "items");
      let customer = null;
      try { customer = tx.findFirstRecordByFilter("users", "role = 'pelanggan' && phone != ''  && phone ~ {:p}", { p: o.getString("phone").slice(-9) }); } catch (_) {}
      const pmName = o.getString("payment") === "qris" ? "QRIS" : "Transfer";
      let pm = null;
      try { pm = tx.findFirstRecordByFilter("payment_methods", "name = {:n}", { n: pmName }); } catch (_) {}
      const per = L.settings(tx).getInt("points_per_rupiah");
      const subtotal = o.getInt("subtotal");
      const earned = customer && per > 0 ? Math.floor(subtotal / per) : 0;
      const sale = new Record(tx.findCollectionByNameOrId("sales"));
      sale.load({
        number: L.nextSaleNumber(tx), cashier: e.auth.id, customer: customer ? customer.id : "",
        subtotal, discount: 0, total: subtotal, paid: subtotal, change: 0, payment_method: pm ? pm.id : "",
        status: "lunas", points_earned: earned, note: `Pesanan online ${number}`,
      });
      tx.save(sale);
      const ic = tx.findCollectionByNameOrId("sale_items");
      for (const it of items) {
        const r = new Record(ic);
        r.load({ sale: sale.id, product: it.product, name: it.name, qty: it.qty, price: it.price, hpp: it.hpp, subtotal: it.price * it.qty });
        tx.save(r);
      }
      if (earned) { customer.set("points", customer.getInt("points") + earned); tx.save(customer); }
      o.set("sale", sale.id);
      if (customer) o.set("customer", customer.id);
      if (pm) o.set("payment_method", pm.id);
      o.set("status", "diproses");
      SL.addHistory(o, "diproses", "Pembayaran dikonfirmasi, pesanan dikemas", who);
    } else if (action === "reject") {
      need(["menunggu_verifikasi"]);
      const reason = String(b.reason || "").trim();
      if (!reason) throw new BadRequestError("Isi alasan bukti ditolak.");
      o.set("status", "menunggu_bayar");
      // Give them another day from now.
      o.set("expires_at", new Date(Date.now() + 24 * 3600e3).toISOString().replace("T", " "));
      SL.addHistory(o, "menunggu_bayar", "Bukti ditolak: " + reason, who);
    } else if (action === "ship") {
      need(["diproses"]);
      if (o.getString("delivery") !== "kirim") throw new BadRequestError("Pesanan ini diambil di toko — pakai 'Siap diambil'.");
      const resi = String(b.resi || "").trim();
      if (resi.length < 6) throw new BadRequestError("Isi nomor resi.");
      o.set("resi", resi);
      o.set("status", "dikirim");
      SL.addHistory(o, "dikirim", `Dikirim ${o.getString("courier")} ${o.getString("service")}, resi ${resi}`, who);
    } else if (action === "resi") {
      need(["dikirim"], "Resi hanya bisa diubah setelah pesanan dikirim.");
      const resi = String(b.resi || "").trim();
      if (resi.length < 6) throw new BadRequestError("Isi nomor resi.");
      if (resi === o.getString("resi")) throw new BadRequestError("Resi tidak berubah.");
      SL.addHistory(o, "dikirim", `Resi diperbarui: ${resi}`, who);
      o.set("resi", resi);
    } else if (action === "ready") {
      need(["diproses"]);
      if (o.getString("delivery") !== "ambil") throw new BadRequestError("Pesanan ini dikirim kurir.");
      o.set("status", "siap_diambil");
      SL.addHistory(o, "siap_diambil", "Siap diambil di toko", who);
    } else if (action === "complete") {
      need(["dikirim", "siap_diambil"]);
      o.set("status", "selesai");
      SL.addHistory(o, "selesai", "Pesanan selesai", who);
    } else if (action === "cancel") {
      need(["menunggu_bayar", "menunggu_verifikasi", "diproses"]);
      const reason = String(b.reason || "").trim();
      if (!reason) throw new BadRequestError("Isi alasan pembatalan.");
      for (const it of SL.json(o, "items")) L.moveStock(tx, { product: it.product, type: "batal_pesanan", qty: it.qty, ref: number, note: reason, by: e.auth.id });
      const sid = o.getString("sale");
      if (sid) {
        // Same reversal as a till void, minus the stock (returned just above).
        const sale = tx.findRecordById("sales", sid);
        const cid = sale.getString("customer");
        if (cid) {
          const c = tx.findRecordById("users", cid);
          c.set("points", Math.max(0, c.getInt("points") - sale.getInt("points_earned")));
          tx.save(c);
        }
        sale.set("status", "batal");
        sale.set("note", sale.getString("note") + " | BATAL: " + reason);
        tx.save(sale);
      }
      o.set("status", "batal");
      SL.addHistory(o, "batal", "Dibatalkan toko: " + reason + (sid ? " (dana dikembalikan ke pembeli)" : ""), who);
    } else {
      throw new NotFoundError("Aksi tidak dikenal.");
    }
    if (b.admin_note !== undefined) o.set("admin_note", String(b.admin_note).slice(0, 500));
    tx.save(o);
  });

  const o = e.app.findRecordById("web_orders", e.request.pathValue("id"));
  if (["diproses", "dikirim", "siap_diambil"].indexOf(o.getString("status")) !== -1) {
    const labels = { diproses: "sudah kami terima pembayarannya dan sedang dikemas", dikirim: `sudah dikirim. Resi ${o.getString("courier")}: ${o.getString("resi")}`, siap_diambil: "siap diambil di toko" };
    const link = SL.orderLinks(e.app, o).track;
    if (action !== "resi" || o.getString("status") === "dikirim") SL.sendMail(e.app, o.getString("email"), `Pesanan ${o.getString("number")}`,
      `<p>Halo ${o.getString("name")}, pesanan <b>${o.getString("number")}</b> ${labels[o.getString("status")]}.</p>` + (link ? `<p>Lacak: <a href="${link}">${link}</a></p>` : ""));
  }
  return e.json(200, o);
}, $apis.requireAuth("users"));

// Unpaid orders expire after 24 h and give their stock back.
cronAdd("store_expire_orders", "*/5 * * * *", () => {
  const L = require(`${__hooks}/lib.js`);
  const SL = require(`${__hooks}/store_lib.js`);
  const now = new Date().toISOString().replace("T", " ");
  const due = $app.findRecordsByFilter("web_orders", "status = 'menunggu_bayar' && expires_at != '' && expires_at < {:now}", "created", 100, 0, { now });
  for (const o of due) {
    try {
      $app.runInTransaction((tx) => {
        const fresh = tx.findRecordById("web_orders", o.id);
        if (fresh.getString("status") !== "menunggu_bayar") return;
        for (const it of SL.json(fresh, "items")) L.moveStock(tx, { product: it.product, type: "batal_pesanan", qty: it.qty, ref: fresh.getString("number"), note: "Kedaluwarsa (tidak dibayar 24 jam)" });
        fresh.set("status", "kedaluwarsa");
        SL.addHistory(fresh, "kedaluwarsa", "Tidak dibayar dalam 24 jam");
        tx.save(fresh);
      });
    } catch (err) {
      $app.logger().error("expire order failed", "order", o.getString("number"), "error", String(err));
    }
  }
});

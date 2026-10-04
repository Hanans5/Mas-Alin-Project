// Nelin Batik online store. Plain JS, hash routes:
//   #/                 shelf (all products)
//   #/p/{id}           product
//   #/checkout         checkout
//   #/pesanan          my orders (kept on this device)
//   #/pesanan/{no}/{t} one order: pay, upload proof, track
// Prices, stock, shipping and totals are decided by the server
// (/api/store/*); this page only shows them and sends choices.
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const S = {
  store: null, products: [], categories: [],
  cart: ls.get('nb_cart', []),            // [{id, qty}]
  orders: ls.get('nb_orders', []),        // [{number, token, created, total}]
  cat: '', motif: '', q: '', sort: 'laris',
  provinces: [],
};

async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.form ? {} : { 'Content-Type': 'application/json' },
    body: opts.form || (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || 'Koneksi bermasalah, coba lagi.');
  return j;
}

let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 4200 : 2200);
}
const sold = n => n >= 1000 ? (n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb terjual' : n + ' terjual';
const prod = id => S.products.find(p => p.id === id);
const img = (p, size) => p.photo || Motif.swatch(p.sku, size);
const fdt = s => new Date(String(s).replace(' ', 'T')).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const waLink = (num, text) => {
  let d = String(num || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

// Open/closed from "08.00–21.00 WIB", in Pekalongan time.
function openNow(hours) {
  const m = String(hours || '').match(/(\d{1,2})[.:](\d{2})\D+(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const now = new Date(Date.now() + 7 * 3600e3), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  return { open: mins >= a && mins < b, opens: `${m[1].padStart(2, '0')}.${m[2]}` };
}

// ── cart ────────────────────────────────────────────
function saveCart() {
  S.cart = S.cart.filter(l => l.qty > 0 && prod(l.id));
  ls.set('nb_cart', S.cart);
  const n = S.cart.reduce((a, l) => a + l.qty, 0);
  const c = $('#cartCount'); c.textContent = n; c.hidden = !n;
}
function addToCart(id, qty = 1) {
  const p = prod(id); if (!p) return false;
  const line = S.cart.find(l => l.id === id);
  const now = line ? line.qty : 0;
  if (now + qty > p.stock) { toast(p.stock ? `Stok ${p.name} tinggal ${p.stock}.` : `${p.name} sedang habis.`, true); return false; }
  if (line) line.qty += qty; else S.cart.push({ id, qty });
  saveCart();
  const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  return true;
}
const cartTotals = () => S.cart.reduce((a, l) => { const p = prod(l.id); return p ? { qty: a.qty + l.qty, sub: a.sub + p.price * l.qty, weight: a.weight + (p.weight || 250) * l.qty } : a; }, { qty: 0, sub: 0, weight: 0 });

function openCart() {
  const d = $('#drawer');
  const draw = () => {
    const t = cartTotals();
    d.innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="cartTitle">
      <div class="drawer-head"><h2 id="cartTitle">Keranjang</h2><button class="close" data-close aria-label="Tutup keranjang">×</button></div>
      <div class="lines">${S.cart.length ? S.cart.map(l => { const p = prod(l.id); return `
        <div class="line">
          <img src="${esc(img(p, 72))}" alt="">
          <div>
            <h3>${esc(p.name)}</h3>
            <div class="muted num" style="font-size:14px">${rp(p.price)}</div>
            <div class="bottom">
              <div class="qty"><button data-dec="${p.id}" aria-label="Kurangi">−</button><input value="${l.qty}" inputmode="numeric" data-q="${p.id}" aria-label="Jumlah ${esc(p.name)}"><button data-inc="${p.id}" aria-label="Tambah">+</button></div>
              <b class="num">${rp(p.price * l.qty)}</b>
            </div>
          </div>
        </div>`; }).join('') : `<div class="empty">Keranjang masih kosong.<br><button class="link" data-close style="margin-top:10px">Lihat produk</button></div>`}</div>
      ${S.cart.length ? `<div class="drawer-foot">
        <div class="sum"><span>${t.qty} barang</span><b class="num">${rp(t.sub)}</b></div>
        <div class="sum muted" style="font-size:13px"><span>Ongkir dihitung di halaman berikutnya</span></div>
        <a class="btn primary block" href="#/checkout" style="margin-top:12px" data-go>Lanjut ke pembayaran</a>
      </div>` : ''}
    </div>`;
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = closeCart);
    d.querySelector('[data-go]')?.addEventListener('click', closeCart);
    d.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { addToCart(b.dataset.inc); draw(); });
    d.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const l = S.cart.find(x => x.id === b.dataset.dec); l.qty--; saveCart(); draw(); });
    d.querySelectorAll('[data-q]').forEach(i => i.onchange = () => {
      const l = S.cart.find(x => x.id === i.dataset.q), p = prod(l.id);
      l.qty = Math.max(0, Math.min(parseInt(i.value, 10) || 0, p.stock)); saveCart(); draw();
    });
  };
  draw();
  d.hidden = false;
  d.onclick = e => { if (e.target === d) closeCart(); };
  $('.close', d)?.focus();
}
function closeCart() { $('#drawer').hidden = true; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) closeCart(); });

// ── shelf ───────────────────────────────────────────
// Home page copy. Placeholder text for the demo: Mas Alin replaces the
// story, the campaign line and the Instagram handle with his own.
const CONTENT = {
  announce: 'Kirim ke seluruh Indonesia dari Pekalongan · Bayar QRIS atau transfer bank',
  // photo: a wide campaign photo URL; until there is one the hero shows the motif.
  campaign: { season: 'Koleksi Pesisir 2026', motif: 'jlamprang', name: 'Jlamprang', photo: '',
    line: 'Bintang delapan khas Pekalongan, dicap di atas katun dan dijahit jadi tunik dan blouse yang enak dipakai harian.' },
  collections: [
    { motif: 'jlamprang', name: 'Jlamprang', note: 'Motif asli Pekalongan, geometris dan tegas' },
    { motif: 'megamendung', name: 'Mega Mendung', note: 'Awan berlapis, warna pesisir yang berani' },
    { motif: 'kawung', name: 'Kawung', note: 'Klasik, rapi, cocok untuk kerja' },
    { motif: 'truntum', name: 'Truntum', note: 'Bunga kecil yang ramai, ringan dilihat' },
    { motif: 'parang', name: 'Parang', note: 'Garis miring yang membuat siluet ramping' },
  ],
  story: [
    'Nelin Batik adalah toko keluarga di Jl. Gatot Subroto, Banyurip Alit, di tengah kampung batik Pekalongan.',
    'Kami menjual batik pesisir yang sudah dijahit jadi tunik dan blouse, dengan harga yang masuk akal untuk dipakai sehari-hari, bukan hanya untuk kondangan.',
    'Barang yang tampil di sini adalah stok yang sama dengan rak di toko. Kalau ragu soal ukuran atau warna, tanya dulu lewat WhatsApp, kami jawab di jam buka.',
  ],
  instagram: 'nelinbatik.official',
  payments: ['QRIS', 'BCA', 'Mandiri', 'BRI', 'BNI', 'GoPay', 'OVO', 'DANA', 'ShopeePay'],
  couriers: ['J&T Express', 'JNE', 'Ninja Xpress', 'SiCepat', 'AnterAja'],
};
const capital = n => n.charAt(0) + n.slice(1).toLowerCase();

function viewShelf() {
  const st = S.store, oh = openNow(st.hours), c = CONTENT.campaign;
  const cats = S.categories.filter(k => S.products.some(p => p.category === k.id))
    .map(k => ({ ...k, items: S.products.filter(p => p.category === k.id) })).sort((a, b) => b.items.length - a.items.length);
  const fromPrice = Math.min(...S.products.filter(p => Motif.motifOf(p.sku) === c.motif).map(p => p.price), Infinity);
  const top = S.products.filter(p => p.stock > 0).slice().sort((a, b) => b.sold - a.sold).slice(0, 8);
  const cols = CONTENT.collections.map(k => ({ ...k, items: S.products.filter(p => Motif.motifOf(p.sku) === k.motif) })).filter(k => k.items.length);
  const ig = 'https://instagram.com/' + CONTENT.instagram;
  // Mosaic: the biggest category gets the big tile, the next the wide one,
  // then the shop and Instagram as the two small ones.
  const tiles = [
    ...cats.slice(0, 2).map(k => ({ name: capital(k.name), sub: `${k.items.length} model`, src: img(k.items[0], 720), attrs: `href="#semua" data-cat-jump="${k.id}"` })),
    { name: 'Datang ke toko', sub: 'Banyurip Alit, Pekalongan', src: Motif.swatch('mos-toko', 420, 'truntum'), attrs: 'href="#/" data-sec-jump="toko"' },
    { name: 'Instagram', sub: '@' + CONTENT.instagram, src: Motif.swatch('mos-ig', 420, 'parang'), attrs: `href="${esc(ig)}" target="_blank" rel="noopener"` },
  ];
  const tileCls = ['m-big', 'm-wide', 'm-small', 'm-small'];
  $('#main').innerHTML = `
    <section class="hero${c.photo ? ' has-photo' : ''}" aria-labelledby="heroName">
      <img class="hero-img" src="${esc(c.photo || Motif.swatch('hero-' + c.motif, 900, c.motif))}" alt="" width="900" height="900">
      <div class="hero-in wrap">
        <p class="season">${esc(c.season)}</p>
        <h1 id="heroName">${esc(c.name)}</h1>
        <p class="hero-line">${esc(c.line)}</p>
        <div class="hero-cta">
          <button class="btn primary" data-col="${c.motif}">Lihat koleksi ${esc(c.name)}</button>
          <a class="btn on-dark" href="#semua">Semua produk</a>
        </div>
      </div>
      ${isFinite(fromPrice) ? `<span class="hangtag num">mulai ${rp(fromPrice)}</span>` : ''}
      ${c.photo ? '' : `<p class="hero-cap">Ilustrasi motif ${esc(c.name)}</p>`}
    </section>

    <section class="cols-band" id="koleksi" aria-labelledby="colsTitle">
      <div class="wrap"><h2 id="colsTitle">Pilih dari motifnya</h2></div>
      <div class="cols">${cols.map(k => `
        <button class="col-tile" data-col="${k.motif}">
          <img src="${Motif.swatch('col-' + k.motif, 420, k.motif)}" alt="" width="420" height="420" loading="lazy">
          <span class="col-text"><span class="col-count">${k.items.length} model</span><span class="col-name">${esc(k.name)}</span>
          <span class="col-note">${esc(k.note)}</span></span>
        </button>`).join('')}</div>
    </section>

    <section class="wrap rail-sec">
      <div class="sec-head"><h2>Paling laris</h2><a href="#semua" class="more" data-sort-jump="laris">Lihat semua</a></div>
      <div class="rail">${top.map(p => cardHtml(p, 300)).join('')}</div>
    </section>

    <section class="wrap shelf-sec" id="semua">
      <div class="sec-head"><h2 id="shelfTitle">Semua produk</h2><button class="more" id="clearCol" hidden>Tampilkan semua motif</button></div>
      <div class="shelf-head">
        <div class="tabs" role="group" aria-label="Kategori">
          <button aria-pressed="${!S.cat}" data-cat="">Semua</button>
          ${cats.map(k => `<button aria-pressed="${S.cat === k.id}" data-cat="${k.id}">${esc(capital(k.name))}</button>`).join('')}
        </div>
        <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2"/></svg>
          <input id="q" type="search" placeholder="Cari tunik, blouse…" value="${esc(S.q)}" aria-label="Cari produk"></label>
        <select class="sort" id="sort" aria-label="Urutkan">
          <option value="laris">Paling laris</option><option value="murah">Harga terendah</option><option value="mahal">Harga tertinggi</option><option value="baru">Terbaru</option>
        </select>
      </div>
      <div class="grid" id="grid"></div>
    </section>

    <section class="story" id="cerita">
      <div class="wrap story-in">
        <div>
          <h2>Cerita kami</h2>
          ${CONTENT.story.map(t => `<p>${esc(t)}</p>`).join('')}
          <a class="btn dark" target="_blank" rel="noopener" href="${esc(waLink(st.wa, 'Halo Nelin Batik, saya mau tanya.'))}">Tanya lewat WhatsApp</a>
        </div>
        <img class="story-img" src="${Motif.swatch('story-kawung', 560, 'kawung')}" alt="" width="560" height="560" loading="lazy">
      </div>
    </section>
    <section class="mosaic-sec" aria-label="Jelajahi">
      <div class="wrap mosaic">${tiles.map((t, i) => `
        <a class="m-tile ${tileCls[i]}" ${t.attrs}>
          <img src="${esc(t.src)}" alt="" loading="lazy">
          <span class="m-text"><span class="m-name">${esc(t.name)}</span><span class="m-sub">${esc(t.sub)}</span></span>
        </a>`).join('')}</div>
    </section>

    <section class="ask" style="background-image:url(${Motif.swatch('ask-megamendung', 300, 'megamendung')})">
      <div class="wrap">
        <p>Ragu soal ukuran, warna, atau bahan?</p>
        <h2>Tanya dulu lewat WhatsApp</h2>
        <a class="btn wa-light" target="_blank" rel="noopener" href="${esc(waLink(st.wa, 'Halo Nelin Batik, saya mau tanya ukuran dan warna.'))}">Chat ${esc(st.wa)}</a>
      </div>
    </section>

    <section class="wrap ig">
      <div class="sec-head"><h2>Ikuti kami di Instagram</h2><a class="more" target="_blank" rel="noopener" href="${esc(ig)}">@${esc(CONTENT.instagram)}</a></div>
      <div class="ig-grid">${S.products.slice(0, 6).map(p => `<a href="${esc(ig)}" target="_blank" rel="noopener" aria-label="Instagram ${esc(CONTENT.instagram)}"><img src="${Motif.swatch('ig-' + p.sku, 220)}" alt="" loading="lazy" width="220" height="220"></a>`).join('')}</div>
    </section>

    <section class="wrap visit" id="toko">
      <div>
        <h2>Datang ke toko</h2>
        <p>${esc(st.address)}</p>
        <p>Buka setiap hari, ${esc(st.hours)}</p>
        ${oh ? `<p class="status"><span class="dot ${oh.open ? '' : 'closed'}"></span>${oh.open ? 'Toko buka sekarang' : 'Toko tutup, buka lagi ' + oh.opens}</p>` : ''}
        <div class="hero-cta">
          <a class="btn dark" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Nelin Batik ' + st.address)}">Buka di Google Maps</a>
          <a class="btn" target="_blank" rel="noopener" href="${esc(waLink(st.wa, 'Halo Nelin Batik, saya mau datang ke toko.'))}">WhatsApp ${esc(st.wa)}</a>
        </div>
      </div>
      <div class="badges">
        <h3>Pembayaran</h3><div>${CONTENT.payments.map(b => `<span class="badge-chip">${esc(b)}</span>`).join('')}</div>
        <h3>Pengiriman</h3><div>${CONTENT.couriers.map(b => `<span class="badge-chip">${esc(b)}</span>`).join('')}<span class="badge-chip">Ambil di toko</span></div>
      </div>
    </section>`;

  $('#sort').value = S.sort;
  const toShelf = () => $('#semua').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const setCat = id => { S.cat = id; document.querySelectorAll('[data-cat]').forEach(x => x.setAttribute('aria-pressed', x.dataset.cat === id)); drawGrid(); };
  document.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => setCat(b.dataset.cat));
  document.querySelectorAll('[data-cat-jump]').forEach(a => a.onclick = e => { e.preventDefault(); setCat(a.dataset.catJump); toShelf(); });
  document.querySelectorAll('[data-sec-jump]').forEach(a => a.onclick = e => { e.preventDefault(); goSection(a.dataset.secJump); });
  document.querySelectorAll('[data-sort-jump]').forEach(a => a.onclick = e => { e.preventDefault(); S.sort = a.dataset.sortJump; $('#sort').value = S.sort; drawGrid(); toShelf(); });
  document.querySelectorAll('a[href="#semua"]:not([data-cat-jump]):not([data-sort-jump])').forEach(a => a.onclick = e => { e.preventDefault(); toShelf(); });
  document.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { S.motif = b.dataset.col; drawGrid(); toShelf(); });
  $('#clearCol').onclick = () => { S.motif = ''; drawGrid(); };
  $('#q').oninput = () => { S.q = $('#q').value; drawGrid(); };
  $('#sort').onchange = () => { S.sort = $('#sort').value; drawGrid(); };
  drawGrid();
  if (S.pendingSec) { const id = S.pendingSec; S.pendingSec = ''; requestAnimationFrame(() => goSection(id, true)); }
  spyOnSections();
}
function cardHtml(p, size) {
  const low = p.stock > 0 && p.stock <= 10;
  return `<a class="card ${p.stock ? '' : 'soldout'}" href="#/p/${p.id}">
      <div class="swatch">
        <img src="${esc(img(p, size))}" alt="${esc(p.name)}" loading="lazy" width="${size}" height="${Math.round(size * 1.25)}">
        ${p.stock ? '' : '<span class="flag">Habis</span>'}${low ? `<span class="flag low">Sisa ${p.stock}</span>` : ''}
        <span class="hangtag num">${rp(p.price)}</span>
      </div>
      <h3>${esc(p.name)}</h3>
      <div class="meta"><span>${sold(p.sold)}</span></div>
    </a>`;
}
function drawGrid() {
  const q = S.q.trim().toLowerCase();
  let list = S.products.filter(p => (!S.cat || p.category === S.cat) && (!S.motif || Motif.motifOf(p.sku) === S.motif) && (!q || p.name.toLowerCase().includes(q)));
  const col = CONTENT.collections.find(k => k.motif === S.motif);
  $('#shelfTitle').textContent = col ? `Motif ${col.name}` : 'Semua produk';
  $('#clearCol').hidden = !col;
  const by = { laris: (a, b) => b.sold - a.sold, murah: (a, b) => a.price - b.price, mahal: (a, b) => b.price - a.price, baru: (a, b) => b.created.localeCompare(a.created) }[S.sort];
  // Sold-out goes last whatever the sort, so the first screen is buyable.
  list = list.sort((a, b) => (a.stock > 0 ? 0 : 1) - (b.stock > 0 ? 0 : 1) || by(a, b));
  $('#grid').innerHTML = list.length ? list.map(p => cardHtml(p, 360)).join('') : `<div class="empty" style="grid-column:1/-1">${S.q ? `Tidak ada produk yang cocok dengan "${esc(S.q)}".` : 'Belum ada produk di pilihan ini.'}</div>`;
}

// ── product page ────────────────────────────────────
function viewProduct(id) {
  const p = prod(id);
  if (!p) { $('#main').innerHTML = `<div class="wrap empty">Produk ini sudah tidak dijual.<br><a class="btn" href="#/" style="margin-top:14px">Lihat produk lain</a></div>`; return; }
  const cat = S.categories.find(c => c.id === p.category);
  const low = p.stock > 0 && p.stock <= 10;
  document.title = `${p.name} — Nelin Batik`;
  $('#main').innerHTML = `
    <div class="wrap">
      <nav class="crumbs"><a href="#/">Semua produk</a>${cat ? ` / ${esc(cat.name.charAt(0) + cat.name.slice(1).toLowerCase())}` : ''}</nav>
      <article class="pdp">
        <div>
          <div class="swatch"><img src="${esc(img(p, 720))}" alt="${esc(p.name)}" width="720" height="720"></div>
          ${p.photo ? '' : `<p class="caption">Ilustrasi motif ${Motif.motifName(p.sku)}. Foto produk asli menyusul.</p>`}
        </div>
        <div class="info">
          <h1>${esc(p.name)}</h1>
          <div class="price num">${rp(p.price)}</div>
          <p class="stockline">${p.stock ? (low ? `<b class="low">Sisa ${p.stock}</b> · ` : `Stok ${p.stock} · `) : '<b class="low">Habis</b> · '}${sold(p.sold)}</p>
          <div class="buy">
            <div class="qty"><button id="dec" aria-label="Kurangi">−</button><input id="qty" value="1" inputmode="numeric" aria-label="Jumlah"><button id="inc" aria-label="Tambah">+</button></div>
            <button class="btn dark" id="add" ${p.stock ? '' : 'disabled'}>Masukkan keranjang</button>
            <button class="btn primary" id="now" ${p.stock ? '' : 'disabled'}>Beli sekarang</button>
          </div>
          <dl class="specs">
            <div><dt>Kode</dt><dd>${esc(p.sku)}</dd></div>
            <div><dt>Berat kirim</dt><dd>${(p.weight || 250)} gram</dd></div>
            <div><dt>Dikirim dari</dt><dd>Pekalongan, Jawa Tengah</dd></div>
          </dl>
          <p class="desc">${p.description ? esc(p.description) : 'Batik cap Pekalongan, dijahit siap pakai. Ukuran dan warna detail bisa ditanyakan lewat WhatsApp toko sebelum membeli.'}</p>
          <div class="buybar" aria-hidden="true"><div><b class="num">${rp(p.price)}</b><div class="muted" style="font-size:12px">${p.stock ? `Stok ${p.stock}` : 'Habis'}</div></div><button class="btn primary" id="now2" tabindex="-1" ${p.stock ? '' : 'disabled'}>Beli sekarang</button></div>
          <section class="ship-est">
            <h2>Cek ongkir</h2>
            <select class="input" id="prov" aria-label="Provinsi tujuan"><option value="">Pilih provinsi tujuan</option>${S.provinces.map(v => `<option>${esc(v)}</option>`).join('')}</select>
            <div class="opts" id="opts"></div>
          </section>
        </div>
      </article>
    </div>`;
  const qty = () => Math.max(1, Math.min(parseInt($('#qty').value, 10) || 1, p.stock || 1));
  $('#dec').onclick = () => { $('#qty').value = Math.max(1, qty() - 1); };
  $('#inc').onclick = () => { $('#qty').value = Math.min(p.stock, qty() + 1); };
  $('#now2').onclick = () => $('#now').click();
  // Show the pinned bar only once the real buy buttons have scrolled away.
  const io = new IntersectionObserver(([en]) => document.querySelector('.buybar')?.classList.toggle('show', !en.isIntersecting && en.boundingClientRect.top < 0));
  io.observe($('.buy'));
  $('#add').onclick = () => { if (addToCart(p.id, qty())) toast(`${p.name} masuk keranjang.`); };
  $('#now').onclick = () => { const l = S.cart.find(x => x.id === p.id); if ((l && l.qty >= qty()) || addToCart(p.id, qty() - (l ? l.qty : 0) || qty())) location.hash = '#/checkout'; };
  const prov = ls.get('nb_prov', '');
  if (prov) $('#prov').value = prov;
  const est = async () => {
    const v = $('#prov').value; ls.set('nb_prov', v);
    if (!v) { $('#opts').innerHTML = ''; return; }
    const r = await api(`/api/store/shipping?province=${encodeURIComponent(v)}&weight=${(p.weight || 250) * qty()}`);
    $('#opts').innerHTML = r.options.map(o => `<div class="opt"><span>${esc(o.courier)} ${esc(o.service)} <span class="muted">· ${esc(o.etd)} hari</span></span><b class="num">${rp(o.cost)}</b></div>`).join('') +
      `<div class="muted" style="font-size:13px;margin-top:6px">Perkiraan untuk ${qty()} pcs. Toko mengecek ulang lewat WhatsApp.</div>`;
  };
  $('#prov').onchange = est;
  if (prov) est();
}

// ── checkout ────────────────────────────────────────
const PROV_DEFAULT = 'Jawa Tengah';
function viewCheckout() {
  if (!S.cart.length) { $('#main').innerHTML = `<div class="wrap empty">Keranjang kosong.<br><a class="btn" href="#/" style="margin-top:14px">Pilih produk</a></div>`; return; }
  const f = ls.get('nb_form', { delivery: 'kirim', payment: 'transfer', province: ls.get('nb_prov', '') || PROV_DEFAULT });
  let ship = null, options = [];
  $('#main').innerHTML = `
    <div class="wrap">
      <nav class="crumbs"><a href="#/">Lanjut belanja</a></nav>
      <div class="co">
        <form id="cf" novalidate>
          <h1>Pembayaran</h1>
          <p class="muted" style="margin:0 0 16px">Setelah pesanan dibuat, kamu dapat nomor rekening atau QRIS dan nominal yang harus dibayar. Stok kami simpan untukmu selama 24 jam.</p>
          <section class="step">
            <h2><span class="n">1</span>Penerima</h2>
            <label class="f" for="name">Nama lengkap</label><input class="input" id="name" autocomplete="name" value="${esc(f.name)}" required>
            <div class="row2">
              <div><label class="f" for="phone">Nomor WhatsApp</label><input class="input" id="phone" inputmode="tel" autocomplete="tel" placeholder="08…" value="${esc(f.phone)}" required></div>
              <div><label class="f" for="email">Email <small>(opsional, untuk kabar pesanan)</small></label><input class="input" id="email" type="email" autocomplete="email" value="${esc(f.email)}"></div>
            </div>
          </section>
          <section class="step">
            <h2><span class="n">2</span>Pengiriman</h2>
            <div class="choice two">
              <label><input type="radio" name="dlv" value="kirim" ${f.delivery !== 'ambil' ? 'checked' : ''}><span><b>Kirim ke alamat</b><small>J&T, JNE, Ninja Xpress, SiCepat, AnterAja</small></span></label>
              <label><input type="radio" name="dlv" value="ambil" ${f.delivery === 'ambil' ? 'checked' : ''}><span><b>Ambil di toko</b><small>Gratis · ${esc(S.store.address)}</small></span></label>
            </div>
            <div id="addr">
              <div class="row2">
                <div><label class="f" for="prov">Provinsi</label><select class="input" id="prov">${S.provinces.map(v => `<option ${v === f.province ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
                <div><label class="f" for="city">Kota / kabupaten</label><input class="input" id="city" autocomplete="address-level2" value="${esc(f.city)}"></div>
              </div>
              <div class="row2">
                <div><label class="f" for="district">Kecamatan</label><input class="input" id="district" value="${esc(f.district)}"></div>
                <div><label class="f" for="postal">Kode pos</label><input class="input num" id="postal" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(f.postal)}"></div>
              </div>
              <label class="f" for="street">Alamat lengkap <small>(jalan, nomor rumah, RT/RW, patokan)</small></label>
              <textarea class="input" id="street" autocomplete="street-address">${esc(f.street)}</textarea>
              <label class="f">Kurir</label>
              <div class="choice" id="couriers"></div>
              <p class="muted" style="font-size:13px;margin:8px 0 0">Ongkir ini perkiraan. Toko mengecek ulang lewat WhatsApp; kalau ada selisih, kami kabari sebelum barang dikemas.</p>
            </div>
          </section>
          <section class="step">
            <h2><span class="n">3</span>Cara bayar</h2>
            <div class="choice two">
              <label><input type="radio" name="pay" value="transfer" ${f.payment !== 'qris' ? 'checked' : ''}><span><b>Transfer bank</b><small>Dari bank atau m-banking mana pun</small></span></label>
              <label><input type="radio" name="pay" value="qris" ${f.payment === 'qris' ? 'checked' : ''}><span><b>QRIS</b><small>GoPay, OVO, DANA, ShopeePay, m-banking</small></span></label>
            </div>
            <label class="f" for="note">Catatan untuk toko <small>(opsional)</small></label>
            <input class="input" id="note" maxlength="300" placeholder="mis. ukuran, warna, atau jam kirim" value="${esc(f.note)}">
          </section>
          <div id="cerr"></div>
        </form>
        <aside>
          <div class="summary" id="summary"></div>
        </aside>
      </div>
    </div>
    <div class="mobile-pay"><div><div class="muted" style="font-size:13px">Total</div><b class="num" id="mtotal" style="font-size:20px"></b></div><button class="btn primary" id="mplace">Buat pesanan</button></div>`;

  const val = id => $('#' + id).value.trim();
  const delivery = () => document.querySelector('input[name=dlv]:checked').value;
  const payment = () => document.querySelector('input[name=pay]:checked').value;
  const remember = () => ls.set('nb_form', { name: val('name'), phone: val('phone'), email: val('email'), delivery: delivery(), payment: payment(),
    province: val('prov'), city: val('city'), district: val('district'), postal: val('postal'), street: val('street'), note: val('note'), courier: ship && ship.courier + '|' + ship.service });

  const drawSummary = () => {
    const t = cartTotals(), fee = delivery() === 'kirim' ? (ship ? ship.cost : null) : 0;
    $('#summary').innerHTML = `<h2>Ringkasan</h2>
      ${S.cart.map(l => { const p = prod(l.id); return `<div class="item"><span>${l.qty} × ${esc(p.name)}</span><span class="num">${rp(p.price * l.qty)}</span></div>`; }).join('')}
      <hr>
      <div class="sum"><span>Subtotal</span><span class="num">${rp(t.sub)}</span></div>
      <div class="sum"><span>Ongkir ${delivery() === 'kirim' && ship ? `<span class="muted">(${esc(ship.courier)}, ${(t.weight / 1000).toLocaleString('id-ID')} kg)</span>` : ''}</span><span class="num">${fee === null ? '—' : fee ? rp(fee) : 'Gratis'}</span></div>
      <div class="sum muted" style="font-size:13px"><span>Kode unik pembayaran</span><span>+ Rp101–499</span></div>
      <div class="sum total"><span>Total</span><span class="num">${fee === null ? '—' : rp(t.sub + fee)}</span></div>
      <button class="btn primary block place" id="place" style="margin-top:14px">Buat pesanan</button>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Kode unik (3 angka terakhir) memudahkan toko mencocokkan transferanmu.</p>`;
    $('#mtotal').textContent = fee === null ? '—' : rp(t.sub + fee);
    $('#place').onclick = place;
  };

  const loadCouriers = async () => {
    const t = cartTotals();
    const r = await api(`/api/store/shipping?province=${encodeURIComponent(val('prov'))}&weight=${t.weight}`);
    options = r.options;
    const saved = ls.get('nb_form', {}).courier;
    ship = options.find(o => o.courier + '|' + o.service === (ship ? ship.courier + '|' + ship.service : saved)) || options[0] || null;
    $('#couriers').innerHTML = options.map((o, i) => `<label><input type="radio" name="cr" value="${i}" ${o === ship ? 'checked' : ''}><span><b>${esc(o.courier)} ${esc(o.service)}</b><small>${esc(o.etd)} hari</small></span><span class="cost num">${rp(o.cost)}</span></label>`).join('');
    document.querySelectorAll('input[name=cr]').forEach(r => r.onchange = () => { ship = options[+r.value]; drawSummary(); remember(); });
    drawSummary();
  };
  const toggleAddr = () => { $('#addr').hidden = delivery() !== 'kirim'; drawSummary(); };
  document.querySelectorAll('input[name=dlv]').forEach(r => r.onchange = () => { toggleAddr(); remember(); });
  document.querySelectorAll('input[name=pay]').forEach(r => r.onchange = remember);
  $('#prov').onchange = () => { ship = null; loadCouriers(); remember(); };
  $('#cf').addEventListener('input', ev => {
    remember();
    // Clear a field's red mark as soon as it's being fixed.
    if (ev.target.classList.contains('bad')) {
      ev.target.classList.remove('bad');
      if (!document.querySelector('.input.bad')) $('#cerr').innerHTML = '';
    }
  });
  $('#mplace').onclick = () => place();

  async function place(ev) {
    ev && ev.preventDefault();
    $('#cerr').innerHTML = '';
    document.querySelectorAll('.input.bad').forEach(i => i.classList.remove('bad'));
    const missing = [];
    const need = (id, ok) => { if (!ok) { $('#' + id).classList.add('bad'); missing.push(id); } };
    need('name', val('name').length >= 2);
    need('phone', val('phone').replace(/\D/g, '').length >= 10);
    if (val('email')) need('email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email')));
    if (delivery() === 'kirim') {
      need('city', val('city')); need('district', val('district'));
      need('postal', /^\d{5}$/.test(val('postal'))); need('street', val('street').length >= 8);
    }
    if (missing.length) {
      $('#cerr').innerHTML = `<div class="err">Lengkapi data yang ditandai merah.</div>`;
      $('#' + missing[0]).focus(); return;
    }
    if (delivery() === 'kirim' && !ship) { $('#cerr').innerHTML = `<div class="err">Pilih kurir.</div>`; return; }
    const btns = [$('#place'), $('#mplace')]; btns.forEach(b => { b.disabled = true; b.textContent = 'Membuat pesanan…'; });
    try {
      const r = await api('/api/store/orders', { method: 'POST', body: {
        items: S.cart.map(l => ({ product: l.id, qty: l.qty })),
        name: val('name'), phone: val('phone'), email: val('email'), delivery: delivery(), payment: payment(), note: val('note'),
        address: { province: val('prov'), city: val('city'), district: val('district'), postal: val('postal'), street: val('street') },
        courier: ship ? ship.courier : '', service: ship ? ship.service : '' } });
      S.orders.unshift({ number: r.number, token: r.token, created: new Date().toISOString() });
      ls.set('nb_orders', S.orders.slice(0, 30));
      S.cart = []; saveCart();
      await loadCatalog(); // stock changed
      location.hash = `#/pesanan/${r.number}/${r.token}`;
    } catch (e) {
      $('#cerr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
      btns.forEach(b => { b.disabled = false; b.textContent = 'Buat pesanan'; });
      await loadCatalog(); saveCart(); drawSummary();
    }
  }
  toggleAddr();
  loadCouriers();
}

// ── order page ──────────────────────────────────────
const STATUS = {
  menunggu_bayar: 'Menunggu pembayaran', menunggu_verifikasi: 'Pembayaran sedang dicek', diproses: 'Dikemas',
  dikirim: 'Dikirim', siap_diambil: 'Siap diambil', selesai: 'Selesai', batal: 'Dibatalkan', kedaluwarsa: 'Kedaluwarsa',
};
let orderTimer;
async function viewOrder(number, token) {
  clearTimeout(orderTimer);
  $('#main').innerHTML = `<div class="wrap empty">Memuat pesanan…</div>`;
  let o;
  try { o = await api(`/api/store/orders/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}`); }
  catch (e) { $('#main').innerHTML = `<div class="wrap empty">${esc(e.message)}<br><a class="btn" href="#/pesanan" style="margin-top:14px">Pesanan saya</a></div>`; return; }
  document.title = `${o.number} — Nelin Batik`;
  const pickup = o.delivery === 'ambil';
  const steps = ['Dibuat', 'Dibayar', 'Dikemas', pickup ? 'Siap diambil' : 'Dikirim', 'Selesai'];
  const at = { menunggu_bayar: 0, menunggu_verifikasi: 1, diproses: 2, dikirim: 3, siap_diambil: 3, selesai: 4 }[o.status];
  const dead = o.status === 'batal' || o.status === 'kedaluwarsa';
  // The last three digits are what tell this transfer apart from others.
  const amountHtml = (() => { const s = rp(o.total); return `${s.slice(0, -3)}<span class="uniq">${s.slice(-3)}</span>`; })();
  const demoPay = /contoh/i.test(o.pay.bank_holder + o.pay.bank_name);
  const waText = `Halo ${o.shop.name}, saya ${o.name} sudah pesan ${o.number}.\nTotal ${rp(o.total)} via ${o.payment === 'qris' ? 'QRIS' : 'transfer'}${pickup ? ', ambil di toko' : `, kirim ${o.courier} ${o.service} ke ${o.address.city}`}.\nMohon dicek ya.${o.track_url ? `\n\nLacak: ${o.track_url}` : ''}${o.pos_url ? `\nUntuk admin: ${o.pos_url}` : ''}`;

  let payPanel = '';
  if (o.status === 'menunggu_bayar') {
    const left = Date.parse(String(o.expires_at).replace(' ', 'T')) - Date.now();
    payPanel = `<section class="panel">
      <h2>Bayar sebelum ${fdt(o.expires_at)}</h2>
      <p class="muted" style="margin:0 0 12px">${left > 0 ? `Sisa ${Math.floor(left / 3600e3)} jam ${Math.floor(left % 3600e3 / 60e3)} menit. ` : ''}Lewat dari itu pesanan batal otomatis dan stok kembali ke toko.</p>
      ${demoPay ? `<p class="note"><b>Ini data pembayaran contoh.</b> Rekening dan QRIS asli Nelin Batik belum dipasang, jangan transfer ke sini.</p>` : ''}
      <div class="copyrow"><div><span>Jumlah yang dibayar, persis</span><div class="amount num">${amountHtml}</div></div><button class="btn sm" data-copy="${o.total}">Salin</button></div>
      ${o.payment === 'transfer' ? `
        <div class="copyrow"><div><span>${esc(o.pay.bank_name)}</span><b class="num">${esc(o.pay.bank_account)}</b><span>a.n. ${esc(o.pay.bank_holder)}</span></div><button class="btn sm" data-copy="${esc(o.pay.bank_account)}">Salin</button></div>`
      : `<div class="qris" style="padding-top:14px">${o.pay.qris ? `<img src="${esc(o.pay.qris)}" alt="QRIS ${esc(o.shop.name)}">` : `<div class="qris-placeholder">QRIS toko belum dipasang.<br>Pilih transfer, atau minta QRIS lewat WhatsApp.</div>`}
         <span class="muted" style="font-size:14px">Scan dengan aplikasi bank atau e-wallet, masukkan nominal di atas.</span></div>`}
    </section>
    <section class="panel">
      <h2>Kirim bukti pembayaran</h2>
      <label class="drop" id="drop" for="proof"><span id="dropText"><b>Pilih foto atau screenshot bukti</b><br><span class="muted">JPG, PNG atau PDF, maks. 5 MB</span></span></label>
      <input type="file" id="proof" accept="image/*,application/pdf" hidden>
      <div id="perr"></div>
      <div class="actions">
        <button class="btn primary" id="send" disabled>Kirim bukti</button>
        <a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(o.shop.wa, waText))}">Konfirmasi lewat WhatsApp</a>
      </div>
    </section>`;
  } else if (o.status === 'menunggu_verifikasi') {
    payPanel = `<section class="panel"><div class="status-ok">Bukti pembayaran sudah kami terima. Toko sedang mengecek, biasanya kurang dari 1 jam saat jam buka.</div>
      <div class="actions"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(o.shop.wa, waText))}">Tanya lewat WhatsApp</a></div></section>`;
  } else if (o.status === 'diproses') {
    payPanel = `<section class="panel"><div class="status-ok">Pembayaran diterima. Pesananmu sedang dikemas${pickup ? '; kami kabari saat siap diambil.' : ' dan nomor resi muncul di sini setelah diserahkan ke kurir.'}</div></section>`;
  } else if (o.status === 'dikirim') {
    payPanel = `<section class="panel"><h2>Sudah dikirim</h2>
      <div class="copyrow"><div><span>${esc(o.courier)} ${esc(o.service)} · nomor resi</span><b class="num">${esc(o.resi)}</b></div><button class="btn sm" data-copy="${esc(o.resi)}">Salin</button></div>
      <p class="muted" style="font-size:14px;margin:10px 0 0">Lacak di aplikasi atau situs ${esc(o.courier)} dengan nomor resi ini.</p></section>`;
  } else if (o.status === 'siap_diambil') {
    payPanel = `<section class="panel"><div class="status-ok">Pesanan siap diambil di ${esc(o.shop.address)}. Tunjukkan nomor ${esc(o.number)} ke kasir.</div></section>`;
  } else if (dead) {
    payPanel = `<section class="panel"><p style="margin:0">${o.status === 'kedaluwarsa' ? 'Pesanan ini batal karena belum dibayar dalam 24 jam.' : 'Pesanan ini dibatalkan.'} Stoknya sudah kembali ke toko.</p><div class="actions"><a class="btn dark" href="#/">Belanja lagi</a></div></section>`;
  }

  $('#main').innerHTML = `
    <div class="wrap">
      <nav class="crumbs"><a href="#/pesanan">Lacak pesanan</a></nav>
      <div class="order">
        <div>
          <div class="muted" style="font-weight:700">${STATUS[o.status]}</div>
          <h1 class="num">${esc(o.number)}</h1>
          ${dead ? '' : `<ol class="track" aria-label="Status pesanan">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}" ${i === at ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`}
        </div>
        ${payPanel}
        ${o.track_url && !dead ? `<section class="panel">
          <h2>Link lacak pesanan</h2>
          <p class="muted" style="margin:0 0 6px;font-size:14px">Buka dari HP mana saja tanpa login, atau bagikan ke keluarga. Link ini hanya menampilkan status dan resi.</p>
          <div class="copyrow"><div><span>Kode ${esc(o.track)}</span><a class="num" href="/t/${esc(o.track)}" style="font-weight:700;overflow-wrap:anywhere">${esc(o.track_url.replace(/^https?:\/\//, ''))}</a></div><button class="btn sm" data-copy="${esc(o.track_url)}">Salin</button></div>
        </section>` : ''}
        <section class="panel">
          <h2>Rincian</h2>
          ${o.items.map(i => `<div class="sum"><span>${i.qty} × ${esc(i.name)}</span><span class="num">${rp(i.price * i.qty)}</span></div>`).join('')}
          <div class="sum"><span>Ongkir ${pickup ? '' : `<span class="muted">(${esc(o.courier)} ${esc(o.service)}${o.shipping_adjusted ? ', sudah dicek toko' : ', perkiraan'})</span>`}</span><span class="num">${o.shipping ? rp(o.shipping) : 'Gratis'}</span></div>
          <div class="sum"><span>Kode unik</span><span class="num">${rp(o.unique_code)}</span></div>
          <div class="sum total"><span>Total</span><span class="num">${rp(o.total)}</span></div>
          <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
          <div style="font-size:15px"><b>${esc(o.name)}</b> · ${esc(o.phone)}${o.email ? ' · ' + esc(o.email) : ''}<br>
          ${pickup ? `Ambil di toko: ${esc(o.shop.address)}` : `${esc(o.address.street)}, ${esc(o.address.district)}, ${esc(o.address.city)}, ${esc(o.address.province)} ${esc(o.address.postal)}`}</div>
          ${o.note ? `<p class="muted" style="margin:8px 0 0">Catatan: ${esc(o.note)}</p>` : ''}
        </section>
        <section class="panel">
          <h2>Riwayat</h2>
          <ol class="history">${(o.history || []).slice().reverse().map(h => `<li><time>${fdt(h.at)}</time><span>${esc(h.note)}</span></li>`).join('')}</ol>
          ${o.status === 'menunggu_bayar' ? `<div style="margin-top:12px"><button class="link" id="cancel">Batalkan pesanan</button></div>` : ''}
        </section>
      </div>
    </div>`;

  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Disalin.'); } catch (_) { toast('Tidak bisa menyalin, tekan lama untuk memilih.', true); }
  });
  const proof = $('#proof');
  if (proof) {
    const drop = $('#drop');
    const pickFile = file => {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { $('#perr').innerHTML = `<div class="err">File terlalu besar, maks. 5 MB.</div>`; return; }
      $('#perr').innerHTML = '';
      $('#dropText').innerHTML = file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" alt="Pratinjau bukti">` : `<b>${esc(file.name)}</b>`;
      $('#send').disabled = false; $('#send').file = file;
    };
    proof.onchange = () => pickFile(proof.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); pickFile(e.dataTransfer.files[0]); };
    $('#send').onclick = async () => {
      const fd = new FormData(); fd.append('proof', $('#send').file);
      $('#send').disabled = true; $('#send').textContent = 'Mengirim…';
      try { await api(`/api/store/orders/${encodeURIComponent(number)}/proof?t=${encodeURIComponent(token)}`, { method: 'POST', form: fd }); toast('Bukti terkirim.'); viewOrder(number, token); }
      catch (e) { $('#perr').innerHTML = `<div class="err">${esc(e.message)}</div>`; $('#send').disabled = false; $('#send').textContent = 'Kirim bukti'; }
    };
  }
  const cancel = $('#cancel');
  if (cancel) cancel.onclick = async () => {
    if (cancel.dataset.armed !== '1') { cancel.dataset.armed = '1'; cancel.textContent = 'Yakin? Tekan lagi untuk membatalkan'; return; }
    try { await api(`/api/store/orders/${encodeURIComponent(number)}/cancel?t=${encodeURIComponent(token)}`, { method: 'POST' }); await loadCatalog(); viewOrder(number, token); }
    catch (e) { toast(e.message, true); }
  };
  // Keep the status fresh while the shop is acting on it.
  if (['menunggu_verifikasi', 'diproses', 'menunggu_bayar'].includes(o.status)) {
    orderTimer = setTimeout(() => { if (location.hash.startsWith(`#/pesanan/${number}/`) && !$('#send')?.file) viewOrder(number, token); }, 30000);
  }
}

async function viewMyOrders() {
  document.title = 'Lacak pesanan — Nelin Batik';
  $('#main').innerHTML = `<div class="wrap order"><h1>Lacak pesanan</h1>
    <section class="panel">${trackForm()}<p class="muted" style="margin:10px 0 0;font-size:14px">Kodenya ada di halaman pesanan dan di pesan WhatsApp dari toko.</p></section>
    <h2 style="margin:10px 0 0;font-size:20px">Pesanan dari perangkat ini</h2>
    ${S.orders.length ? `<div class="panel" id="olist">Memuat…</div>` : `<p class="muted" style="margin:0">Belum ada. <a href="#/">Mulai belanja</a></p>`}</div>`;
  wireTrackForm();
  if (!S.orders.length) return;
  const rows = await Promise.all(S.orders.map(async x => {
    try { const o = await api(`/api/store/orders/${encodeURIComponent(x.number)}?t=${encodeURIComponent(x.token)}`); return { x, o }; } catch (_) { return null; }
  }));
  $('#olist').innerHTML = rows.filter(Boolean).map(({ x, o }) => `
    <a class="copyrow" style="text-decoration:none" href="#/pesanan/${x.number}/${x.token}">
      <div><b class="num">${esc(o.number)}</b><span>${fdt(o.created)} · ${o.items.reduce((a, i) => a + i.qty, 0)} barang · ${rp(o.total)}</span></div>
      <span style="font-weight:700;color:${['batal', 'kedaluwarsa'].includes(o.status) ? 'var(--muted)' : o.status === 'menunggu_bayar' ? 'var(--rose)' : 'var(--tosca)'}">${STATUS[o.status]}</span>
    </a>`).join('') || 'Pesanan tidak ditemukan.';
}

// ── tracking page: /t/{code} ────────────────────────
// The link the buyer gets on WhatsApp. One order's progress and nothing else:
// no shop menus, no prices, no payment or cancel buttons. Anyone holding the
// link sees this much, so the server only sends what is safe to share.
const TRACK_RE = /^\/t\/([A-Za-z0-9]{8})\/?$/;
const TK_HEAD = {
  menunggu_bayar: 'Menunggu pembayaran', menunggu_verifikasi: 'Pembayaran sedang dicek', diproses: 'Sedang dikemas',
  dikirim: 'Dalam perjalanan', siap_diambil: 'Siap diambil di toko', selesai: 'Pesanan selesai', batal: 'Pesanan dibatalkan', kedaluwarsa: 'Pesanan kedaluwarsa',
};
const cekResi = r => `https://cekresi.com/?noresi=${encodeURIComponent(r)}`;
let trackTimer;
async function viewTracker(code) {
  clearTimeout(trackTimer);
  document.body.classList.add('track-only');
  code = code.toUpperCase();
  let o;
  try { o = await api(`/api/store/track/${encodeURIComponent(code)}`); }
  catch (e) {
    document.title = 'Lacak pesanan — Nelin Batik';
    $('#main').innerHTML = `<div class="tk"><a class="tk-logo" href="/">Nelin Batik</a>
      <section class="tk-card"><h1 class="tk-h">Kode ${esc(code)} tidak ditemukan</h1>
        <p class="muted">Cek lagi kodenya di pesan WhatsApp dari toko: 8 huruf dan angka setelah /t/.</p>${trackForm()}</section></div>`;
    wireTrackForm();
    return;
  }
  document.title = `${o.number} — Lacak pesanan Nelin Batik`;
  const pickup = o.delivery === 'ambil', dead = o.status === 'batal' || o.status === 'kedaluwarsa';
  const first = st => (o.history || []).find(h => st.includes(h.status));
  // four steps; `done` is how many are behind the buyer, the next one is "now"
  const steps = [
    ['Dipesan', o.created],
    ['Dibayar', first(['diproses'])?.at],
    [pickup ? 'Siap diambil' : 'Dikirim', first(['dikirim', 'siap_diambil'])?.at],
    [pickup ? 'Diambil' : 'Diterima', first(['selesai'])?.at],
  ];
  const done = { menunggu_bayar: 1, menunggu_verifikasi: 1, diproses: 2, dikirim: 3, siap_diambil: 3, selesai: 4 }[o.status] || 1;
  const nowNote = { menunggu_bayar: 'menunggu', menunggu_verifikasi: 'sedang dicek', diproses: 'sedang dikemas', dikirim: 'di jalan', siap_diambil: 'di toko' }[o.status] || '';
  const where = pickup ? 'Ambil di toko' : `${esc(o.courier)} ${esc(o.service)} ke ${esc(o.city)}${o.province ? ', ' + esc(o.province) : ''}${o.etd && o.status === 'dikirim' ? ` · perkiraan ${esc(o.etd)} hari` : ''}`;
  const wa = waLink(o.shop.wa, `Halo ${o.shop.name}, saya mau tanya pesanan ${o.number}.`);
  $('#main').innerHTML = `<div class="tk">
    <a class="tk-logo" href="/">${esc(o.shop.name)}</a>
    <section class="tk-card tk-main ${dead ? 'dead' : ''}">
      <p class="tk-no"><span class="num">${esc(o.number)}</span> · atas nama ${esc(o.name)}</p>
      <h1 class="tk-h">${o.status === 'selesai' && !pickup ? 'Paket sudah diterima' : TK_HEAD[o.status]}</h1>
      <p class="tk-where">${where}</p>
      ${dead ? `<p class="muted">${o.status === 'kedaluwarsa' ? 'Pesanan tidak dibayar dalam 24 jam.' : 'Pesanan ini dibatalkan.'} Hubungi toko kalau ada pertanyaan.</p>` : `
      <ol class="tk-steps">${steps.map(([label, at], i) => `<li class="${i < done ? 'done' : i === done ? 'now' : ''}" ${i === done ? 'aria-current="step"' : ''}>
        <span class="tk-dot" aria-hidden="true"></span><b>${label}</b><small>${i < done && at ? fdt(at) : i === done ? nowNote : ''}</small></li>`).join('')}</ol>`}
      ${o.resi ? `<div class="tk-resi"><div><span>Nomor resi ${esc(o.courier)}</span><b class="num">${esc(o.resi)}</b></div>
        <div class="tk-resi-acts"><button class="btn sm" data-copy="${esc(o.resi)}">Salin resi</button><a class="btn sm dark" href="${cekResi(o.resi)}" target="_blank" rel="noopener">Cek posisi paket</a></div></div>` : ''}
      ${o.status === 'siap_diambil' ? `<p class="tk-note">Ambil di ${esc(o.shop.address)}. Sebutkan nomor ${esc(o.number)} ke kasir.</p>` : ''}
      ${o.status === 'menunggu_bayar' ? `<p class="tk-note">Bayar lewat halaman pesanan di HP yang dipakai memesan. Pesanan batal otomatis kalau tidak dibayar dalam 24 jam.</p>` : ''}
    </section>
    <section class="tk-card">
      <h2>Isi paket</h2>
      <ul class="tk-items">${o.items.map(i => `<li><span>${esc(i.name)}</span><b class="num">${i.qty}×</b></li>`).join('')}</ul>
    </section>
    <section class="tk-card">
      <h2>Riwayat</h2>
      <ol class="tk-hist">${(o.history || []).slice().reverse().map(h => `<li><time>${fdt(h.at)}</time><span>${esc(h.note)}</span></li>`).join('')}</ol>
    </section>
    <div class="tk-acts">
      <a class="btn wa" target="_blank" rel="noopener" href="${esc(wa)}">Tanya toko soal pesanan ini</a>
      <a class="btn" href="/">Belanja di ${esc(o.shop.name)}</a>
    </div>
    <p class="tk-foot muted">Halaman ini diperbarui otomatis. Terakhir dicek ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB.</p>
  </div>`;
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Resi disalin.'); } catch (_) { toast('Tidak bisa menyalin, tekan lama untuk memilih.', true); }
  });
  if (!dead && o.status !== 'selesai') trackTimer = setTimeout(() => { if (!document.hidden) viewTracker(code); else document.addEventListener('visibilitychange', () => viewTracker(code), { once: true }); }, 60000);
}
// "Lacak pesanan" box: a code (or a pasted link) takes you to /t/{code}.
const trackForm = () => `<form class="tk-form" id="tkf"><label for="tkc">Kode lacak</label>
  <div class="tk-form-row"><input class="input num" id="tkc" placeholder="mis. K7QF3M9X" maxlength="80" autocapitalize="characters" autocomplete="off" required>
  <button class="btn primary">Lacak</button></div><div id="tkerr"></div></form>`;
function wireTrackForm() {
  $('#tkf').onsubmit = e => {
    e.preventDefault();
    const m = $('#tkc').value.trim().match(/(?:\/t\/)?([A-Za-z0-9]{8})\/?$/);
    if (!m) { $('#tkerr').innerHTML = `<div class="err">Kode lacak 8 huruf dan angka, ada di pesan WhatsApp dari toko.</div>`; return; }
    location.href = '/t/' + m[1].toUpperCase();
  };
}

// Microsoft Clarity heatmaps, only when the owner has set a project id in
// Pengaturan → Toko Online. Clarity masks typed text by default.
function loadClarity(id) {
  if (!id || !/^[a-z0-9]+$/.test(id)) return;
  (function (c, l, a, r, i) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    const t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    const y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', id);
}

// ── header: utility strip, section menu, search ─────
function drawTopbar() {
  const st = S.store;
  $('#tbAddr').textContent = 'Banyurip Alit, Pekalongan';
  $('#tbHours').textContent = 'Buka setiap hari, ' + st.hours;
  $('#tbIg').href = 'https://instagram.com/' + CONTENT.instagram;
  $('#tbWa').href = waLink(st.wa, 'Halo Nelin Batik, saya mau tanya.');
}
// Menu links point at sections of the home page. From another page, go home
// first and jump once the shelf has rendered.
function goSection(id, instant) {
  const onHome = !location.hash || location.hash === '#/' || location.hash === '#';
  if (!onHome) { S.pendingSec = id; location.hash = '#/'; return; }
  const el = id === 'top' ? document.body : document.getElementById(id);
  if (!el) return;
  // Arriving from another page: jump straight there (a smooth scroll over a
  // freshly rendered page gets overtaken by the browser's own adjustments).
  const smooth = instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (id === 'top') window.scrollTo({ top: 0, behavior: smooth });
  else window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - $('#bar').offsetHeight + 1, behavior: smooth });
}
function setActive(key) {
  document.querySelectorAll('#mainnav a').forEach(a => a.classList.toggle('on', (a.dataset.sec || a.dataset.page) === key));
}
// Highlight the menu item for the section in view (home page only).
let spy;
function spyOnSections() {
  spy?.disconnect();
  const ids = ['koleksi', 'semua', 'cerita', 'toko'];
  const seen = new Map();
  spy = new IntersectionObserver(entries => {
    entries.forEach(e => seen.set(e.target.id, e.isIntersecting));
    const cur = ids.find(i => seen.get(i));
    setActive(scrollY < 200 ? 'top' : cur || 'top');
  }, { rootMargin: '-45% 0px -50% 0px' });
  ids.forEach(i => { const el = document.getElementById(i); if (el) spy.observe(el); });
  setActive('top');
}
function closeMenu() { $('#mainnav').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }
$('#menuBtn').onclick = () => { const open = $('#mainnav').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', open); };
document.querySelectorAll('#mainnav a[data-sec]').forEach(a => a.onclick = e => { e.preventDefault(); closeMenu(); goSection(a.dataset.sec); });
$('#mainnav a[data-page]').onclick = () => closeMenu();
$('#searchBtn').onclick = () => {
  closeMenu();
  const focus = () => { const q = $('#q'); if (q) { goSection('semua'); setTimeout(() => q.focus({ preventScroll: true }), 350); } };
  if ($('#q')) focus(); else { S.pendingSec = 'semua'; location.hash = '#/'; setTimeout(focus, 400); }
};

// ── footer, routing, boot ───────────────────────────
function drawFooter() {
  const st = S.store, ig = 'https://instagram.com/' + CONTENT.instagram;
  $('#foot').innerHTML = `<div class="foot-in">
    <div><h2>${esc(st.name)}</h2><p>${esc(CONTENT.story[0])}</p>
      <div class="foot-icons">
        <a href="${esc(ig)}" target="_blank" rel="noopener" aria-label="Instagram ${esc(st.name)}"><svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg></a>
        <a href="${esc(waLink(st.wa, 'Halo Nelin Batik, saya mau tanya produk.'))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(st.name)}"><svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z"/></svg></a>
      </div></div>
    <div><h3>Toko</h3><p>${esc(st.address)}</p><p>Buka setiap hari, ${esc(st.hours)}</p>
      <p>WhatsApp <a href="${esc(waLink(st.wa, 'Halo Nelin Batik, saya mau tanya produk.'))}" target="_blank" rel="noopener">${esc(st.wa)}</a></p></div>
    <div><h3>Pembayaran & kirim</h3><p>QRIS, transfer bank</p><p>J&T, JNE, Ninja Xpress, SiCepat, AnterAja, atau ambil di toko</p>
      <p><a href="#/pesanan">Lacak pesanan</a></p></div>
    <div class="complaint"><h3>Layanan pengaduan konsumen</h3>
      <p>${esc(st.name)}: WhatsApp ${esc(st.wa)}, ${esc(st.address)}.</p>
      <p>Direktorat Jenderal Perlindungan Konsumen dan Tertib Niaga, Kementerian Perdagangan RI: WhatsApp 0853 1111 1010.</p></div>
  </div>
  <div class="foot-base">© ${new Date().getFullYear()} ${esc(st.name)}, Pekalongan</div>`;
}
function route() {
  closeCart();
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (!S.pendingSec) window.scrollTo(0, 0);
  closeMenu();
  spy?.disconnect();
  setActive(h[0] === 'pesanan' ? 'pesanan' : '');
  document.title = 'Nelin Batik — Toko Online';
  const fab = $('#waFab');
  fab.hidden = !(h[0] === '' || h[0] === 'p');
  const p = h[0] === 'p' && prod(h[1]);
  fab.href = waLink(S.store.wa, p ? `Halo Nelin Batik, saya mau tanya ${p.name} (${p.sku}).` : 'Halo Nelin Batik, saya mau tanya produk.');
  document.body.classList.toggle('has-buybar', h[0] === 'p');
  if (h[0] === 'p' && h[1]) viewProduct(h[1]);
  else if (h[0] === 'checkout') viewCheckout();
  else if (h[0] === 'pesanan' && h[1] && h[2]) viewOrder(decodeURIComponent(h[1]), decodeURIComponent(h[2]));
  else if (h[0] === 'pesanan') viewMyOrders();
  else viewShelf();
  $('#main').focus({ preventScroll: true });
}
async function loadCatalog() {
  const c = await api('/api/store/catalog');
  S.store = c.store; S.products = c.products; S.categories = c.categories;
}
async function boot() {
  const tm = location.pathname.match(TRACK_RE);
  if (tm) return viewTracker(tm[1]);
  $('#main').innerHTML = `<section class="wrap"><div class="grid loading">${'<div class="card"><div class="swatch"></div></div>'.repeat(8)}</div></section>`;
  try {
    const [, sh] = await Promise.all([loadCatalog(), api('/api/store/shipping')]);
    S.provinces = sh.provinces;
  } catch (e) {
    $('#main').innerHTML = `<div class="wrap empty">Toko sedang tidak bisa dimuat. Coba muat ulang halaman.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  saveCart(); drawFooter(); drawTopbar(); loadClarity(S.store.clarity); route();
}
// Pages are rebuilt on every route, so the browser's remembered scroll
// positions point at content that no longer exists. We place the scroll ourselves.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => $('#bar').classList.toggle('scrolled', scrollY > 4), { passive: true });
$('#cartBtn').onclick = openCart;
boot();

// Batik swatches drawn on canvas, used as product images until real photos
// are uploaded. Each product gets a motif and a pesisiran (coastal) colourway
// picked from its SKU, so the same product always looks the same.
//
// Motifs: jlamprang (Pekalongan's own eight-point star), parang (diagonal
// blade bands), kawung (palm-fruit quatrefoil), mega mendung (layered
// clouds), truntum (scattered small flowers).
(function () {
  'use strict';

  // [ground, main ink, second ink, highlight] — Pekalongan dyes run bright.
  const PALETTES = [
    ['#1d2a5c', '#f3efe2', '#6fb7c9', '#e9b949'], // indigo night
    ['#0e6e66', '#f6f1e4', '#f0a9b8', '#1d2a5c'], // tosca + jambon pink
    ['#7a1f2b', '#f2d58a', '#f6efe0', '#2e5a8c'], // mengkudu red
    ['#f4ecd9', '#1d2a5c', '#b8352f', '#2f7d6b'], // white-ground pesisir
    ['#2b2a29', '#e8c35a', '#e9e2d0', '#b6463c'], // black + saffron
    ['#e7d3b0', '#5a3a21', '#1d2a5c', '#a14a2c'], // light sogan
    ['#3d6e8f', '#fbf4e4', '#f2c14e', '#173153'], // sea blue
    ['#c94b5b', '#fff3e6', '#1d2a5c', '#f2c14e'], // lipstick pink
  ];
  const MOTIFS = ['jlamprang', 'parang', 'kawung', 'megamendung', 'truntum'];

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    return function () { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Hand-drawn feel: canting lines wobble a little and dots vary in size.
  function wobble(r, amt) { return (r() - 0.5) * amt; }

  function jlamprang(ctx, w, h, p, r) {
    const cell = w / 4;
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, w, h);
    for (let y = -1; y < h / cell + 1; y++) {
      for (let x = -1; x < w / cell + 1; x++) {
        const cx = x * cell + (y % 2 ? cell / 2 : 0), cy = y * cell * 0.88;
        // eight-point star from two rotated squares
        ctx.save(); ctx.translate(cx, cy);
        for (const rot of [0, Math.PI / 4]) {
          ctx.save(); ctx.rotate(rot);
          ctx.fillStyle = rot ? p[2] : p[1];
          const s = cell * 0.3;
          ctx.fillRect(-s, -s, s * 2, s * 2);
          ctx.restore();
        }
        ctx.fillStyle = p[0];
        ctx.beginPath(); ctx.arc(0, 0, cell * 0.17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p[3];
        ctx.beginPath(); ctx.arc(0, 0, cell * 0.08, 0, Math.PI * 2); ctx.fill();
        // isen-isen: the dotted fill batik makers put between motifs
        ctx.fillStyle = p[1];
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + Math.PI / 8, d = cell * 0.47;
          ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, cell * (0.018 + r() * 0.012), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  function parang(ctx, w, h, p, r) {
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, w, h);
    const band = w / 4.6;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 4); ctx.translate(-w, -h);
    for (let b = 0; b < (w * 2) / band + 2; b++) {
      const y0 = b * band;
      // the band's edge rule
      ctx.strokeStyle = p[3]; ctx.lineWidth = band * 0.05;
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w * 2, y0 + wobble(r, 2)); ctx.stroke();
      // the "blade": a row of S-curls
      for (let x = 0; x < w * 2; x += band * 0.7) {
        ctx.fillStyle = p[1];
        ctx.beginPath();
        ctx.moveTo(x, y0 + band * 0.5);
        ctx.bezierCurveTo(x + band * 0.2, y0 + band * 0.05, x + band * 0.55, y0 + band * 0.1, x + band * 0.6, y0 + band * 0.42);
        ctx.bezierCurveTo(x + band * 0.45, y0 + band * 0.3, x + band * 0.25, y0 + band * 0.35, x + band * 0.18, y0 + band * 0.62);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = p[2];
        ctx.beginPath(); ctx.ellipse(x + band * 0.35, y0 + band * 0.72, band * 0.1, band * 0.05, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p[1];
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + band * (0.48 + i * 0.07), y0 + band * 0.86, band * 0.022, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  function kawung(ctx, w, h, p, r) {
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, w, h);
    const cell = w / 4.5;
    for (let y = 0; y < h / cell + 1; y++) {
      for (let x = 0; x < w / cell + 1; x++) {
        const cx = x * cell, cy = y * cell;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          ctx.save(); ctx.translate(cx + Math.cos(a) * cell * 0.27, cy + Math.sin(a) * cell * 0.27); ctx.rotate(a);
          ctx.fillStyle = p[1];
          ctx.beginPath(); ctx.ellipse(0, 0, cell * 0.25, cell * 0.15, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = p[2];
          ctx.beginPath(); ctx.ellipse(cell * 0.03, 0, cell * 0.13, cell * 0.06, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = p[3];
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.06 + wobble(r, 1), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function megamendung(ctx, w, h, p, r) {
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, w, h);
    const unit = w / 2.6;
    const cloud = (cx, cy, s) => {
      // seven rings, dark to light, the classic gradation
      const rings = [p[3], p[2], p[1], p[2], p[1], p[2], p[1]];
      rings.forEach((col, i) => {
        const k = 1 - i * 0.12;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx - s * k, cy);
        ctx.bezierCurveTo(cx - s * k, cy - s * 0.55 * k, cx - s * 0.35 * k, cy - s * 0.75 * k, cx - s * 0.1 * k, cy - s * 0.42 * k);
        ctx.bezierCurveTo(cx + s * 0.05 * k, cy - s * 0.9 * k, cx + s * 0.7 * k, cy - s * 0.8 * k, cx + s * 0.6 * k, cy - s * 0.3 * k);
        ctx.bezierCurveTo(cx + s * 1.05 * k, cy - s * 0.35 * k, cx + s * 1.1 * k, cy + s * 0.1 * k, cx + s * 0.8 * k, cy + s * 0.2 * k);
        ctx.lineTo(cx - s * k, cy + s * 0.2 * k);
        ctx.closePath(); ctx.fill();
      });
    };
    for (let y = 0; y < h / unit + 1; y++) {
      for (let x = -1; x < w / unit + 1; x++) cloud(x * unit + (y % 2) * unit / 2 + wobble(r, 6), y * unit * 0.72 + unit * 0.5, unit * 0.48);
    }
  }

  function truntum(ctx, w, h, p, r) {
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, w, h);
    const n = 46;
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, s = w * (0.035 + r() * 0.03);
      ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI);
      ctx.fillStyle = i % 5 === 0 ? p[3] : p[1];
      for (let k = 0; k < 6; k++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.ellipse(s, 0, s * 0.7, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = p[2];
      ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = p[2];
    for (let i = 0; i < 220; i++) { ctx.beginPath(); ctx.arc(r() * w, r() * h, w * 0.005, 0, Math.PI * 2); ctx.fill(); }
  }

  const DRAW = { jlamprang, parang, kawung, megamendung, truntum };
  const cache = new Map();

  // Returns a data URL; size is the square edge in CSS px.
  function swatch(key, size, forceMotif) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    const id = `${key}|${px}|${forceMotif || ''}`;
    if (cache.has(id)) return cache.get(id);
    const hsh = hash(key);
    const pick = choose(key);
    const motif = forceMotif || MOTIFS[pick.motif];
    const pal = PALETTES[pick.palette];
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    DRAW[motif](ctx, px, px, pal, rng(hsh));
    // A faint crackle wash, like wax resist that split in the dye bath.
    const r = rng(hsh ^ 0x9e3779b9);
    ctx.globalAlpha = 0.07; ctx.strokeStyle = pal[0]; ctx.lineWidth = Math.max(1, px / 400);
    for (let i = 0; i < 14; i++) {
      ctx.beginPath(); let x = r() * px, y = r() * px; ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * px * 0.2; y += (r() - 0.3) * px * 0.15; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const url = c.toDataURL('image/jpeg', 0.86);
    cache.set(id, url);
    return url;
  }

  // SKUs end in a running number (TUN-TUN-0048), so neighbouring products
  // get different motifs (n mod 5) and colourways (n mod 8 shifted by 3);
  // anything without a number falls back to the hash.
  function choose(key) {
    const m = String(key).match(/(\d+)\s*$/);
    if (!m) { const h = hash(key); return { motif: h % MOTIFS.length, palette: (h >>> 8) % PALETTES.length }; }
    const n = parseInt(m[1], 10);
    return { motif: n % MOTIFS.length, palette: (n * 3 + hash(key.replace(/\d+\s*$/, ''))) % PALETTES.length };
  }

  function motifName(key) {
    const names = { jlamprang: 'Jlamprang', parang: 'Parang', kawung: 'Kawung', megamendung: 'Mega Mendung', truntum: 'Truntum' };
    return names[MOTIFS[choose(key).motif]];
  }

  // Which motif a product's illustration uses (for the motif collections).
  function motifOf(key) { return MOTIFS[choose(key).motif]; }

  window.Motif = { swatch, motifName, motifOf, MOTIFS };
})();

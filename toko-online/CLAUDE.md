# Nelin Batik — online store (static; API from ~/nelin-batik)

Read `REPORT.md` first: the full handoff for the store and the kasir app.

- Publish only with `deploy/publish.sh`: it syntax-checks the JS, copies to `/var/www/nelin-store` and stamps `/styles.css?v=<sha1>` etc. Cloudflare caches `.js`/`.css` for 4 h, so an unstamped file mixes old and new code.
- Assets are root-relative (`/app.js`) because `/t/{code}` (order tracker) falls back to `index.html`.
- After publishing, screenshot the live URL in light and dark mode at ~2000px and 390px.
- Online payment is bank transfer only (the server refuses `qris`).
- Local preview: a small node server for `public/` that proxies `/api/` to PocketBase (live :8090 or a sandbox) and falls back to `index.html`.

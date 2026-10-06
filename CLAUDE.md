# Mas-Alin-Project — PUBLIC GitHub repo (Hanans5/Mas-Alin-Project)

`kasir/` and `toko-online/` are copies of `~/nelin-batik` and `~/nelin-store`, not the live code. Edit there, then sync.

- Update with `./sync.sh` (leaves out the DB, `ACCOUNTS.md`, backups and the binary), then stage named paths: `git add kasir toko-online CLAUDE.md`. Other sessions drop files here, so never blind `git add -A`.
- `/docs/` is gitignored on purpose: client notes with business figures must never be published.
- Before pushing, check the diff for customer/employee names, phone numbers and figures.
- Auto mode blocks force-push: give Hanan the command to run himself (in his own terminal without the leading `!`; in the Claude prompt with it).

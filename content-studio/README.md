# Nelin Batik Content Studio

A small local app where AI agents plan, write and check Nelin Batik's social
media posts. Mas Alin (or a trusted staff member) approves each post, and the app keeps the
schedule. A web dashboard shows every post, every agent run and the AI cost,
and everything in the dashboard is also available through a REST API (for n8n
or scripts).

It runs on your own PC, separate from the kasir. It never reads or changes the
kasir database.

## How a post moves

```
Planner -> Writer -> Designer -> Reviewer -> waiting for approval
                ^                    |  (fixes needed: back to Writer, max 2 rounds)
                +--------------------+
Approve -> Scheduled -> "Siap diposting" at its time -> posted
"Minta ubah" -> back to the Writer with the note
```

| Agent | Job | Model (default) |
|---|---|---|
| Planner | Weekly content calendar from the product list, promos and dates | `claude-sonnet-5-5` |
| Writer | Caption, hashtags, call to action (Indonesian) | `claude-sonnet-5-5` |
| Designer | Photo brief from REAL product photos (no AI images), text on image, layout | `claude-sonnet-5-5` |
| Reviewer | Checks for invented prices or discounts, names, typos, missing call to action | `claude-haiku-5-5` |
| Publisher | Phase 2: auto-post to Instagram/Facebook. Phase 1: the post appears in "Siap diposting" to copy and post by hand | - |
| Analyst | Phase 2: reads likes, reach and WhatsApp clicks back | - |

## Run it

Needs Node.js 22.9 or newer.

```bash
cd content-studio
npm install
cp .env.example .env      # then put your Claude API key in .env
npm start
```

Open http://127.0.0.1:8095. Without an API key it runs in **demo mode**: the
agents return sample text, so every button can be tried for free.

Data lives in `data/db.json` (back it up by copying the file). `npm test` runs
an end-to-end check in demo mode.

### Approve from a phone on the shop wifi

In `.env` set `HOST=0.0.0.0` and a long random `API_TOKEN`, restart, then open
`http://<PC's IP>:8095` on the phone. The page asks for the token once.

### Costs

Only the Claude API costs money (about US$0.15 per post with all agents on the
default models). The dashboard shows the cost per run and per month, and the
agents stop when the monthly cap in Pengaturan is reached (default US$12).

## API

All JSON. Without `API_TOKEN` the API answers only on this PC and every
non-GET request needs the header `X-Studio: 1`. With `API_TOKEN`, send
`Authorization: Bearer <token>` instead.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/status` | Demo mode, busy, cost this month, posts per state |
| GET | `/api/posts?status=review` | Posts (optionally by state) |
| POST | `/api/posts` | Add an idea `{topic, product, platform, format, scheduledAt}`; agents write it |
| GET / PATCH / DELETE | `/api/posts/:id` | Read, edit (caption, hashtags, scheduledAt, ...), delete |
| POST | `/api/posts/:id/approve` | Approve and schedule |
| POST | `/api/posts/:id/reject` | `{note}`: back to the Writer with the note |
| POST | `/api/posts/:id/posted` | `{url}`: mark as posted |
| POST | `/api/plan` | `{weekStart: "YYYY-MM-DD", count?, notes?}`: run the agents for a week |
| GET | `/api/runs` | Agent runs: status, time, tokens, cost, errors |
| GET | `/api/agents` | Agents and their last run |
| GET | `/api/connectors` | Health of Instagram, Facebook, Claude, webhook, ... |
| GET | `/api/events` | Activity log |
| GET / PUT | `/api/settings` | Brand voice, products, promos, posting times, budget, approval |

Webhooks: set `WEBHOOK_URL` and every event (`post.ready_for_review`,
`post.approved`, `post.ready_to_post`, `post.published`, `post.failed`,
`agent.failed`, ...) is POSTed there as JSON, for example to an n8n workflow.

## Phases

1. **Now:** agents, approval, schedule, dashboard, API, manual posting.
2. Instagram + Facebook auto-posting (needs a Meta app and a Business account),
   Analyst.
3. Optional: WhatsApp approval, TikTok drafts, product list read from the kasir.

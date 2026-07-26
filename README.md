# TranslationChat

Real-time multilingual chat with on-demand AI translation powered by **Google Gemini**.

Users pick their language, write in their own tongue, and read everyone else’s messages translated into that language—useful for mixed-language groups without forcing a single lingua franca.

**Live demo:** [https://translationchat.onrender.com](https://translationchat.onrender.com)  
*(Render free tier may sleep after idle time; the first request can take ~1 minute.)*

---

## Features

- **Shared live feed** — new messages appear for all clients via Server-Sent Events (SSE)
- **Per-user translation language** — profile locale drives Gemini target language
- **Auto-translate** — translate visible messages in batch, or translate one bubble at a time
- **Server-side translation cache** — once a message is translated into a locale, later viewers reuse it (no extra Gemini call); cache is dropped when the message leaves the feed
- **Ephemeral chat room** — messages live in process memory (cleared on restart); profiles and file metadata use SQLite
- **File attachments** — upload and share files in the feed
- **Single deployable service** — Fastify serves the API and static UI together (easy to host on Render)

---

## Tech stack

| Layer | Choices |
|--------|---------|
| Runtime | Node.js 22.5+ (`node:sqlite`) |
| Server | Fastify 5, cookies, multipart, static |
| AI | Google Gemini via `@google/genai` |
| Data | In-memory message store + SQLite (users / files) |
| Frontend | Vanilla HTML / CSS / JS (no SPA framework) |
| Deploy | Render Blueprint (`render.yaml`), optional Docker |

---

## How translation works

```
Client                    Server                         Gemini
  |  POST /api/translate     |                              |
  |------------------------->|  cache hit? ---------------->| (skip)
  |                          |  miss → generateContent ---->|
  |                          |<----- translated text -------|
  |                          |  store in memory cache       |
  |<---- translatedText -----|                              |
```

- Cache key: **message id + target locale**
- When the in-memory feed drops old messages (max 100), their translations are removed too
- Feed responses can include already-known translations so clients skip unnecessary requests

---

## Quick start (local)

**Requirements:** Node.js **≥ 22.5**, a [Google AI Studio](https://aistudio.google.com/apikey) API key.

```bash
git clone https://github.com/buc89l2nb41/TranslationChat.git
cd TranslationChat
cp .env.example .env
# Set GEMINI_API_KEY (and optionally GEMINI_MODEL=gemini-2.5-flash)
npm install
npm start
```

Open `http://localhost` (default `PORT=80`) or the port you set in `.env`.

Development with auto-reload:

```bash
npm run dev
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_MODEL` | No | Default `gemini-2.5-flash` |
| `PORT` / `HOST` | No | Local bind (on Render, do **not** set `PORT`) |
| `FEED_DISPLAY_LIMIT` | No | Max messages shown (default 50) |
| `TRANSLATE_CONCURRENCY` | No | Parallel Gemini calls per batch (default 4) |
| `TRANSLATE_BATCH_MAX` | No | Max IDs per batch request (default 50) |
| `TRANS_TONE` / `TRANS_DOMAIN` | No | Optional prompt tone / domain hints |
| `COOKIE_SECRET` | Prod | Session cookie signing secret |

See `.env.example` for a full template.

---

## Deploy on Render

1. Connect this repo in the [Render](https://render.com) dashboard (Blueprint uses `render.yaml`, or create a Node Web Service manually).
2. Set **`GEMINI_API_KEY`** in Environment (Blueprint leaves this for you to fill in).
3. Prefer **`NODE_VERSION=22.13.0`** (or newer). Start command is `npm start` (includes `--experimental-sqlite` for older 22.x).
4. Open `https://<service>.onrender.com`.

---

## Project structure

```
TranslationChat/
├── public/              # UI (index, app.js, styles)
├── server/
│   ├── index.js         # Fastify bootstrap
│   ├── messageStore.js  # In-memory feed + translation cache
│   ├── db.js            # SQLite (users, files)
│   ├── adapter/         # Gemini (+ optional HTTP/stub adapters)
│   └── routes/          # REST + SSE + file download
├── render.yaml          # Render Blueprint
└── Dockerfile           # Optional container deploy
```

---

## Design notes

- **One process, one URL** — avoids CORS / cookie issues from splitting frontend and API.
- **Ephemeral chat** — intentional for a demo room: no long-term message history, lower storage and privacy surface.
- **Cache translations, not forever** — cuts Gemini usage while the room is active; restart clears everything.
- **Cookie-based anonymous users** — display name and language persist in SQLite without a full auth stack.

---

## License

Private / portfolio project (`"private": true` in `package.json`). Adjust if you open-source it later.

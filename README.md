# 🚗 Parkomat

> The person who scans the QR on your windshield reaches you on Telegram **without seeing your phone number**.

Bad parking, lights or a window left open, a car alarm going off… When someone needs to reach you about your car, they shouldn't have to ask for your number. Put the QR sticker on your windshield and messages arrive in your Telegram. **100% free** (Cloudflare Free + Telegram Bot API).

## ✨ Features

- 🔒 **Number privacy** — the QR contains only a random token; neither your number nor the sender's is exposed
- 📲 **Telegram notifications** — messages arrive instantly as direct messages
- 🖨️ **Printable windshield sticker** — black-and-yellow 6×10 cm template (`/v/:token/etiket`)
- 🗑️ **Automatic deletion** — messages are removed from the database after 30 minutes (cron + opportunistic cleanup)
- 🛡️ **Spam protection** — rate limits (3 per 10 minutes / 10 per day) + optional Turnstile
- 🔄 **QR rotation** — revoke an abused QR with one click
- 🆓 **Zero cost** — stays within the Workers (100K requests/day) + D1 (5 GB) free limits

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/sticker.png" width="360" alt="Printable 6×10 cm QR sticker"><br>
  <sub>The printable windshield sticker</sub>
</p>

| Anonymous message form | Owner panel |
| :---: | :---: |
| <img src="docs/screenshots/scan-form.png" width="260" alt="Anonymous message form"><br><sub>No phone number required</sub> | <img src="docs/screenshots/owner-panel.png" width="260" alt="Owner panel"><br><sub>Telegram status, QR and recent messages</sub> |

The app UI is currently in Turkish; an English form is on the roadmap.

## 🏗️ How it works

```
[ QR on windshield ]  →  https://your-worker.workers.dev/v/A8f3K9xQ2m
                           │  masked plate + choose a reason + write a message
                           ▼  POST /api/v/:token/message
[ Cloudflare Worker ] → rate limit → [ save to D1 ] → [ Telegram Bot API ] → 📩 DM to you
```

The phone number is **never** stored anywhere in the system. The link is made through the Telegram `chat_id`.

## 🚀 Setup (5 minutes)

### 1. Prerequisites

- A Cloudflare account (free) + Node.js 18+
- Create a bot with `@BotFather` on Telegram → get `BOT_TOKEN` and the username (`/newbot`)

### 2. Deploy the project

```bash
npm i -g wrangler
wrangler login

# Database
wrangler d1 create parkomat-db
# → paste the resulting database_id into wrangler.toml
wrangler d1 execute parkomat-db --remote --file=migrations/0001_init.sql
wrangler d1 execute parkomat-db --remote --file=migrations/0002_channels.sql

# Secrets (values are prompted in the terminal; never paste them into chat!)
wrangler secret put BOT_TOKEN
wrangler secret put PEPPER
wrangler secret put TELEGRAM_WEBHOOK_SECRET

wrangler deploy
# → https://parkomat.<account>.workers.dev
```

### 3. Connect the Telegram webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker-address>/api/telegram/webhook?secret=<WEBHOOK_SECRET>"
# should return {"ok":true}
```

Don't forget to set the bot username on the `BOT_USERNAME` line in `wrangler.toml`.

### 4. Create your first QR

1. Open `https://<worker-address>/sahip` → enter the plate **masked** (`34 AB ****`)
2. Copy the 6-digit code from the owner panel (`/a/...` — don't lose this link!)
3. Open `t.me/<bot>?start=<CODE>` → send `/start <CODE>` → `✅ Bağlandı!` (Connected!)
4. Use the print button to print the 6×10 cm sticker and attach it to the inside of the windshield

## 📁 Project structure

```text
parkomat/
├── src/worker.js              # Everything in one place: API + pages + Telegram webhook
├── migrations/
│   ├── 0001_init.sql          # vehicles + messages tables
│   └── 0002_channels.sql      # notification channel columns
└── wrangler.toml              # Worker + D1 + cron config
```

No dependencies, no build step — a single-file Worker.

## 🔌 API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/sahip` | Vehicle creation page |
| `POST` | `/api/admin/create` | Creates a vehicle + token |
| `GET` | `/a/:adminToken` | Owner panel (keep private!) |
| `GET` | `/v/:publicToken` | Scanner-facing form |
| `POST` | `/api/v/:publicToken/message` | Sends an anonymous message |
| `GET` | `/v/:publicToken/etiket` | Printable sticker |
| `POST` | `/api/admin/rotate` | Rotates the QR |
| `POST` | `/api/admin/purge` | Purges messages immediately |
| `POST` | `/api/telegram/webhook` | Bot updates |

## 🔐 Privacy & security notes

- Do not write the full plate — replace the last digits with `****`.
- Never share the `/a/...` admin link; the `/v/...` QR link can be public.
- Never paste the bot token into chats, commits, or screenshots — if it leaks, use `@BotFather` → `/revoke`.
- Messages are deleted after 30 minutes (`RETENTION_MINUTES`, cron every 10 minutes). Notifications already delivered remain in Telegram.

## 🗺️ Roadmap

- [ ] Turnstile bot protection (code ready, waiting for a site key)
- [ ] Photo notifications (R2)
- [ ] Two-way anonymous replies ("Thanks, on my way" button)
- [ ] Custom domain + Turkish/English form

## 📄 License

MIT — use it, fork it, improve it however you like. Contributions (PRs) are welcome.

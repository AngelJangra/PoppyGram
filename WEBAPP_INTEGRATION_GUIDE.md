# PoppyGram Webapp ↔ Bot Integration Guide

This guide explains how the user-facing webapp (`https://poppygram.vercel.app/app`) connects
to a Telegram bot, and how to replicate or extend this integration.

---

## Architecture Overview

```
User (Browser) ──HTTPS──► Next.js API Routes (/api/web/*) ──Bot API──► Telegram Bot
                          │                          │
                          │   └──► Sends file / message to user
                          │
                          └──► Supabase DB (user data, products, tickets)
```

### Key Design Decisions

| Concern | Solution |
|---|---|
| **Bot token security** | `TG_BOT_TOKEN` is **never** sent to the browser. All bot API calls happen server-side. |
| **Photo proxy** | `/api/web/photo?id=FILE_ID` proxies Telegram photos — no token leak. |
| **User authentication** | Bot-issued one-time secret code (`/weblogin` → Telegram ID + code) with 15-minute TTL; legacy Login Widget hash still accepted. |
| **Real-time chat** | Client polls `/api/web/messages` every 5s (cleanup on unmount). |

---

## 1. Prerequisites

### Bot Setup

Two Telegram bots: **Store Bot** (`@poppygram`) and **Support Bot** (`@poppygramsupportbot`).
Create via [@BotFather](https://t.me/BotFather) — `/newbot`, pick name + username, copy token.

### Environment Variables

| Variable | Required | Used In | Description |
|---|---|---|---|
| `TG_BOT_TOKEN` | Yes | lib/bot.ts, /api/web/*, lib/webappAuth.ts | Store bot token — API calls, webapp cookie signing. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | lib/db.ts | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | lib/db.ts, middleware.ts | Service role key (bypasses RLS). |
| `ENCRYPTION_KEY_BASE64_32_BYTES` | Yes | middleware.ts | Key for admin session cookies. Generate: `openssl rand -base64 32` |
| `CRON_SECRET` | Optional | middleware.ts | Shared secret for cron endpoints. |
| `SUPPORT_BOT` | Optional | lib/credits.ts | Support bot username (default: `poppygramsupportbot`). |

### Database Setup

```bash
psql "$DATABASE_URL" -f supabase/schema.sql
```

**Tables used by the webapp** (all in `supabase/schema.sql`): `bot_users`,
`store_products`, `store_purchases`, `support_tickets`, `support_messages`,
`file_requests`, `settings` (includes `support_faq`).

---

## 2. BotFather Configuration

### A. Create the Bot

Use [@BotFather](https://t.me/BotFather):
1. `/newbot` → name "PoppyGram" → username "poppygram_bot"
2. Copy token → set as `TG_BOT_TOKEN`
3. Repeat for the support bot

### B. Set the Web App (Menu Button)

**Option 1** — BotFather:
1. `/mybots` → select store bot → `/setmenubutton` → "Web App" → enter:
   `https://poppygram.vercel.app/app`

**Option 2** — Bot API:
```bash
curl "https://api.telegram.org/bot$TG_BOT_TOKEN/setChatMenuButton" \
  -d "menu_button={\"type\":\"web_app\",\"text\":\"🛒 PoppyGram\",\"web_app\":{\"url\":\"https://yourdomain.com/app\"}}"
```


### Login with Telegram (bot-issued one-time code)

```
Browser → GET /api/web/session → bot.getMe() → bot_username
Browser → shows "send /weblogin in @<bot>" instructions + two inputs
User    → runs /weblogin in the bot → bot replies with Telegram ID + secret code
          (8 hex chars, stored encrypted in settings under weblogin:<uid>, 15-min TTL)
Browser → POST /api/web/login {tg_user_id, password}
   → verifyWebLoginPass(): decrypts the ticket, checks TTL, deletes it (single use)
   → sets signed wa_session cookie → returns {ok:true, user:{...}}
```

Notes:
- The secret code is **single-use** and expires after 15 minutes; `/weblogin` issues a
  fresh code each time (the previous one is overwritten).
- `/weblogin` works in private chats only.
- A legacy fallback still accepts the Telegram Login Widget payload
  (`{id, first_name, auth_date, hash}`, HMAC-SHA256 with `WebAppData` + bot token),
  so existing widget integrations keep working.

**Files**: `lib/botFlow.ts` (`generateWebLoginPass`/`verifyWebLoginPass`),
`lib/webappAuth.ts`, `pages/api/web/login.ts`, `pages/api/web/session.ts`,
`pages/api/web/logout.ts`, `pages/app.tsx`

### Browse Store (products)

```
GET /api/web/products → Supabase store_products (active=true)
Thumbnails: GET /api/web/photo?id=FILE_ID → bot API getFile (proxied)
```

**Files**: `pages/api/web/products.ts`, `pages/api/web/product.ts`, `pages/api/web/photo.ts`

### Buy a Product (file delivered via bot)

```
POST /api/web/purchase {tg_user_id, product_id, expected_price}
  → check balance → deduct credits → bot.sendDocument({chat_id, document, caption})
  → record purchase → return {ok, balance}
```

User must have an active chat with the bot (sent /start first).

**Files**: `pages/api/web/purchase.ts`, `lib/storeFlow.ts`, `lib/credits.ts`

### Support Tickets (real-time chat)

```
POST /api/web/ticket {tg_user_id, subject, message}
  → create support_tickets row → create support_messages row
  → bot.sendMessage(ADMIN_ID, "New ticket #N") → return {ticket: {id}}

GET /api/web/messages?ticket_id=N&tg_user_id=ID
  → return full message thread (polled every 5s)

Admin replies in Telegram → webhook → stores reply → picked up by next poll
```

**Files**: `pages/api/web/ticket.ts`, `pages/api/web/messages.ts`, `pages/app.tsx`

### File Requests & Free Credits

```
POST /api/web/filerequest → creates row, bot notifies admin
POST /api/web/freecredits → adds 100 credits, bot notifies user
```

**Files**: `pages/api/web/filerequest.ts`, `pages/api/web/freecredits.ts`

---

## 4. Deployment Checklist

### Vercel

```bash
vercel link
vercel env add TG_BOT_TOKEN
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY

---

## 5. File Reference

### New Files (created for webapp↔bot integration)

| File | Type | Purpose |
|---|---|---|
| `lib/webappAuth.ts` | Library | HMAC-SHA256 cookie signing/verification |
| `pages/api/web/login.ts` | API route | POST — verify `/weblogin` code (or legacy widget hash), set session cookie |
| `pages/api/web/logout.ts` | API route | POST — clear session cookie |
| `pages/api/web/session.ts` | API route | GET — return user + bot username |
| `pages/api/web/messages.ts` | API route | GET — fetch ticket message thread (polling) |

### Modified Files

| File | Change |
|---|---|
| `lib/bot.ts` | `BotButton` interface + `keyboard()` support `web_app` buttons |
| `pages/api/bot.ts` | `/start` includes "🌐 Web App" button |
| `pages/app.tsx` | `/weblogin` login form (Telegram ID + secret code), real-time chat, tabbed UI |
| `styles/support.css` | `wa-` prefixed styles: login, messages, user bar |
| `middleware.ts` | `/api/web/*` on public allowlist (unchanged) |

### Existing API Routes (unchanged, used by webapp)

| File | Method | Purpose |
|---|---|---|
| `pages/api/web/products.ts` | GET | List/search active products |
| `pages/api/web/product.ts` | GET | Single product detail |
| `pages/api/web/user.ts` | GET | User balance, auth status |
| `pages/api/web/history.ts` | GET | Purchase history |
| `pages/api/web/faq.ts` | GET | Public FAQ from settings |
| `pages/api/web/ticket.ts` | GET/POST | List/create tickets |
| `pages/api/web/filerequest.ts` | POST | Submit file request |
| `pages/api/web/purchase.ts` | POST | Buy product, deliver via bot |
| `pages/api/web/freecredits.ts` | POST | Claim 100 free credits |
| `pages/api/web/photo.ts` | GET | Telegram photo proxy |

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid Telegram login data" | `TG_BOT_TOKEN` wrong or unset | Verify env var matches BotFather |
| "Active chat required" | User hasn't started the bot | User sends `/start` to bot first |
| Buy fails silently | Insufficient credits / bot can't DM | Check balance; user must chat with bot |
| Messages won't refresh | Webhook not receiving admin replies | Verify `/api/support` webhook URL |
| Photo thumbnails broken | Invalid `photo_id` | Verify in database |
| 401 on `/api/web/*` | Middleware blocking | Check `/api/web/` in allowlist (middleware.ts:51) |

---

## 7. Quick Smoke Test

```bash
# 1. App page loads
curl -sI https://poppygram.vercel.app/app | head -1   # HTTP/2 200

# 2. Session returns bot username
curl -s https://poppygram.vercel.app/api/web/session   # {"user":null,"bot_username":"..."}

# 3. Products returned
curl -s https://poppygram.vercel.app/api/web/products | jq '.products|length'

# 4. Login rejects bad data
curl -s -X POST https://poppygram.vercel.app/api/web/login \
  -d '{"id":"1","hash":"bad"}'  # 401 {"error":"Invalid Telegram login data"}
```

---

## 8. Bot API Methods Used (server-side only)

| Method | Purpose |
|---|---|
| `getMe()` | Bot username for the `/weblogin` login screen |
| `sendDocument({chat_id})` | File delivery after purchase |
| `sendMessage({chat_id})` | Notifications (tickets, credits) |
| `sendPhoto({chat_id})` | Product photos (proxied) |
| `setMyCommands(...)` | Command menu (`/syncmenu`) |
| `setChatMenuButton(...)` | Set menu button to open webapp |
| `setWebhook(...)` | Configure bot webhooks |

All in `lib/bot.ts` — token never exposed to browser.

vercel env add ENCRYPTION_KEY_BASE64_32_BYTES
vercel env add CRON_SECRET
vercel --prod
# After deploy: send /syncmenu to your bot as admin
```

### Webhooks

```bash
# Store bot webhook
curl "https://api.telegram.org/bot$TG_BOT_TOKEN/setWebhook" \
  -d "url=https://poppygram.vercel.app/api/bot" \
  -d "secret_token=$WEBHOOK_SECRET"

# Support bot webhook (rejects updates without this secret header)
curl "https://api.telegram.org/bot$SUPPORT_BOT_TOKEN/setWebhook" \
  -d "url=https://poppygram.vercel.app/api/support" \
  -d "secret_token=$SUPPORT_BOT_WEBHOOK_SECRET"
```

### Verify After Deploy

| Check | URL | Expected |
|---|---|---|
| App page | `https://poppygram.vercel.app/app` | HTTP 200 + `/weblogin` login form |
| Session | `GET /api/web/session` | `{"user":null,"bot_username":"..."}` |
| Products | `GET /api/web/products` | Array of product objects |
| FAQ | `GET /api/web/faq` | `{"faq": { "q": "a" }}` |

### C. Web App Button in /start (already in code)

The `/start` command keyboard includes a web app button (in `pages/api/bot.ts`):

```ts
// pages/api/bot.ts — /start command keyboard
[[
  {text:'🛍️ Store',callback_data:'store'},
  {text:'💳 Balance',callback_data:'balance'}
],
[
  {text:'🌐 Web App',web_app:{url:'https://poppygram.vercel.app/app'}}
]]
```

The `keyboard()` helper in `lib/bot.ts` supports `web_app` buttons:

```ts
export interface BotButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string }  // enables Telegram's "Open" button
}
```

---

## 3. How Each Feature Connects to the Bot
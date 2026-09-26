
## v14 AUTH persistence fix
- Authentication is sticky per Telegram bot user until `/deleteaccount`.
- `/profile` and `/freecredits` recover verification from `bot_users.auth_verified` first, then account ownership/session markers.
- Added a JavaScript legacy fallback for old JSONB ownership metadata.
- Existing authenticated server accounts and encrypted sessions are not deleted.
# PoppyGram v3

Next.js administration console with account management, system health, browser-side Telegram/MTProto login, client-side Telegram operations, scheduler, backup/restore, settings, and Supabase persistence.

## Install
```bash
npm install
copy .env.example .env.local
# fill the values
npm run typecheck
npm run build
npm run dev
```

Run `supabase/schema.sql` in Supabase SQL Editor first.

## Telegram architecture

**All Telegram MTProto operations run in the user's browser. Vercel serverless functions never create a `TelegramClient`.** This is intentional because persistent/server-side MTProto connections are not a suitable Vercel serverless workload.

The browser uses:
- `NEXT_PUBLIC_TG_API_ID`
- `NEXT_PUBLIC_TG_API_HASH`

These values are necessarily visible to browser users. They are Telegram application credentials, not the user's Telegram login session.

The login flow is:
1. Browser creates a GramJS client.
2. Browser sends the phone number to Telegram directly.
3. Browser receives and verifies the login code.
4. If enabled, the browser performs Telegram 2FA/SRP; the raw cloud password is never sent to PoppyGram.
5. Browser creates the Telegram StringSession.
6. Browser sends that session to the authenticated PoppyGram server endpoint only for encrypted database storage.

The `/api/tg/*` MTProto endpoints are intentionally disabled and return `410`. This prevents accidental reintroduction of server-side GramJS.

## Telegram account operations

Ping, service-chat reading, and message sending also use the browser-side Telegram client. The server only supplies the encrypted session to an authenticated admin browser and records ping results.

Because MTProto is browser-side, the scheduler is a **browser scheduler**. It runs while an authenticated admin console is open. Vercel cannot perform Telegram pings in a background serverless cron job. The dashboard now prevents overlapping runs, uses server-side due-account selection, and records scheduler health; closing the admin browser still stops MTProto jobs.

## Authentication

The site uses a bcrypt-hashed admin password from `ADMIN_PASSWORD_HASH`. The hash is stored in the environment, not hardcoded in source.

Generate a hash with:
```bash
node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD',12))"
```

## Environment variables

See `.env.example`. Important values include:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ENCRYPTION_KEY_BASE64_32_BYTES` (server-only)
- `NEXT_PUBLIC_TG_API_ID`
- `NEXT_PUBLIC_TG_API_HASH`
- `ADMIN_PASSWORD_HASH` (server-only)
- `TG_BOT_TOKEN` (server-only)
- `TG_BOT_WEBHOOK_SECRET` (server-only)
- `SUPPORT_BOT_TOKEN` (server-only; support bot `@poppygramsupportbot`)
- `SUPPORT_BOT_WEBHOOK_SECRET` (server-only; secret checked on `POST /api/support`)
- `TG_OWNER_CHAT_ID` (server-only; Telegram numeric chat/user ID that should receive new-auth announcements)
- `SITE_URL` (recommended production URL; used for the Telegram webhook)

Do not commit `.env.local` or expose the Supabase service-role key/encryption key.

## Backups

Exports contain encrypted Telegram session fields and must be treated as highly sensitive. Import validates basic record structure and skips malformed/duplicate records.

## Security

Use Telegram API credentials only for accounts you own or are authorized to administer. If a secret from an old `.env.local` was ever committed, uploaded, or shared, rotate it before deploying this version.

## PWA / mobile home-screen support

PoppyGram is configured as an installable PWA for Android, iPhone/iPad, and desktop/laptop browsers. It includes a web app manifest, 192px/512px install icons, iOS home-screen metadata, a conservative service worker, safe-area support, responsive mobile navigation, an Android/desktop install prompt, and offline/reconnect messaging.

The service worker deliberately does **not** cache `/api/*`, authentication/session responses, Supabase data, or Telegram data. Static Next.js assets may be cached for faster repeat loads.

On Android/Chrome/Edge, use the **Install app** prompt when it appears. On iPhone/iPad Safari, use **Share → Add to Home Screen**.

Important: installing PoppyGram as a PWA does not turn the browser-side Telegram/MTProto scheduler into a true background worker. Telegram account pings still require the PWA/site browser context to be running. A persistent server/worker is required for scheduling while the app is completely closed.


## Hard Ping / Session Reset
Each account has a three-state hard-ping label based on the last completed hard reset: **Excellent** for the first 30 days, **Suggested** from 30 to 60 days, and **Danger** after 60 days (or if never completed). Hard reset creates a fresh Telegram login session, verifies it, waits a 10-second safety cooldown, then atomically replaces the active encrypted session while retaining the previous encrypted session as backup. Login codes must be read and entered manually from Telegram; PoppyGram does not automatically intercept or mirror authentication codes.


## Session backup history
Hard Reset now appends the previous encrypted Telegram session to `account_session_backups` before replacing the active session. The legacy `previous_session_encrypted` field is retained for compatibility, but new resets use the separate history table.


### Authentication updates (v3.7.0)
- Root page renders the login screen directly when unauthenticated; no self-rewrite loop.
- Login/logout cookies work on both local HTTP development and HTTPS production.
- Settings includes **Sign out all users**, which stores a global revocation timestamp and invalidates older admin sessions.
- Admin clients re-check authentication every 30 seconds.


## Telegram Store Bot

The Telegram bot keeps the existing PoppyGram account-verification flow and adds a real Telegram-backed file store.

### Credits
The old `global_credit` value is now used as the **initial wallet balance** for each new Telegram bot user. The balance is stored per Telegram user in `bot_users.credit` and is used to purchase store files. Existing account verification still works and now displays the user's actual store-credit balance.

### Telegram file storage
Admins send a document to the bot after `/addfile` with:
```text
Product Name | 25 | Full product description shown to buyers
```
The bot stores Telegram's `file_id` plus filename, description and price in Supabase. The file binary does not need to be copied to Vercel. On purchase, the bot sends the saved Telegram file back to the buyer and deducts credits atomically. If Telegram delivery fails, the credits are refunded.

### User commands
- `/start` — store dashboard
- `/store` — browse products
- `/search keyword` — search products
- `/product ID` — view one product
- `/balance` — wallet balance
- `/history` — purchases
- `/auth` — existing account verification
- `/cancel` — cancel the current flow
- `/help` — command menu

### Administration
The fixed owner username is `drangeljangra`. The owner can add or remove additional administrators:
- `/addadmin @username`
- `/removeadmin @username`
- `/admins`

Admins can use:
- `/admin`
- `/addfile`
- `/products`
- `/delproduct ID`
- `/setprice ID PRICE`
- `/addcredit @username AMOUNT`
- `/users`
- `/status`

The admin list is stored in Supabase, so it survives redeployments. An admin must have started the bot at least once before `/addcredit @username ...` can target that account.

### Why a Telegram bot can appear to freeze
This deployment uses a Telegram webhook on Vercel, not a permanent Telegram process. The webhook must answer successfully and the handler must finish quickly. The bot now uses request timeouts, webhook idempotency, callback handling, and `/status` diagnostics. Use `/status` as an owner/admin to see the webhook URL, pending updates and Telegram's last webhook error.

A separate issue can affect the **Telegram user accounts stored by PoppyGram**. Those are MTProto user sessions, not the Bot API identity. Telegram documents `USER_DEACTIVATED` for deleted/deactivated user accounts and `SESSION_REVOKED`/`SESSION_EXPIRED` for invalid sessions. A frozen Telegram account can also be placed in read-only mode. Such a user-account failure cannot be fixed by restarting the bot webhook; the affected account/session needs to be re-authenticated or handled according to Telegram's account status. See Telegram's official Bot API and authorization documentation for the distinction.

## Telegram authentication persistence

- Successful `/auth` now commits `bot_users.auth_verified=true` directly after the encrypted account is saved.
- `/profile` and `/freecredits` use the persistent verification flag and can repair legacy users from their linked `accounts` row.
- Admins can manually verify a user with `/verify TELEGRAM_ID` and remove it with `/unverify TELEGRAM_ID`.
- New successful authorizations send a notification to `TG_OWNER_CHAT_ID` and to active admins whose Telegram chat ID has been recorded.
- Run the updated `supabase/schema.sql` once so `bot_admins.tg_chat_id` exists.

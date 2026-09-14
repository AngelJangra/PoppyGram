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
- `SITE_URL` (recommended production URL; used for the Telegram webhook)

Do not commit `.env.local` or expose the Supabase service-role key/encryption key.

## Backups

Exports contain encrypted Telegram session fields and must be treated as highly sensitive. Import validates basic record structure and skips malformed/duplicate records.

## Security

Use Telegram API credentials only for accounts you own or are authorized to administer. If a secret from an old `.env.local` was ever committed, uploaded, or shared, rotate it before deploying this version.

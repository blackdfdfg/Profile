# fixasif-premium (Cloudflare Worker + D1)

Backend for https://fixasif.com/agent — sells Fix X Agent Access Keys paid with Binance Pay (USDT).

- `src/index.js` — the Worker (auth, orders, Binance verify, extension key check, dashboard)
- `schema.sql` — D1 tables (`users`, `orders`, `access_keys`, `rate_limits`)
- `gen_keys.mjs` — make new keys: `node gen_keys.mjs 20 > keys.sql`, then run the SQL in D1 Console
- Secrets live only in Cloudflare (Workers → fixasif-premium → Settings → Variables). Never commit them.

Deploy: `npx wrangler deploy` (the cron runs daily to expire old orders).

## v1.7 server update

Install dependencies with `npm ci`, then `npm test` and `npm run build`.
`wrangler.toml` uses the bundled `dist/index.js`; never upload raw modules without their imports.
Apply migrations in numeric order **once** to an existing schema. Do not reapply ALTER TABLE migrations.
The deployed database has already received migrations 0002 through 0005.
Read-only `admin_*` views expose registrations, licence purchases, credit balances, topups and referrals without password hashes or raw licence keys.

Secrets: OPENAI_API_KEY, AI_MODEL, AI_ENDPOINT, TELEGRAM_BOT_TOKEN,
TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, BEP20_PRIVATE_KEY.
Payout configuration additionally requires BEP20_RPC_URL, BEP20_TOKEN_ADDRESS and explicit PAYOUT_ENABLED=true.
Payouts require explicit enablement after mainnet and token verification. An owner confirmation only approves a reward; insufficient USDT or BNB leaves it queued. No callback marks a payment paid before three on-chain confirmations. `/admin/payout-status` is read-only and requires the private OWNER_ADMIN_SECRET header; it never signs or sends a transaction.
Secrets and generated licence values must never be committed.

Telegram purchases and rewards use a durable outbox. Owner must Start the bot before it can message their private chat.
Credit jobs debit a reservation atomically, refund failed generation, cache retries, commit posted replies,
and return unused reservations after 30 minutes. Refund abuse limits apply.

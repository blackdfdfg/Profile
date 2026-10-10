# fixasif-premium (Cloudflare Worker + D1)

Backend for https://fixasif.com/agent — sells Fix X Agent Access Keys paid with Binance Pay (USDT).

- `src/index.js` — the Worker (auth, orders, Binance verify, extension key check, dashboard)
- `schema.sql` — D1 tables (`users`, `orders`, `access_keys`, `rate_limits`)
- `gen_keys.mjs` — make new keys: `node gen_keys.mjs 20 > keys.sql`, then run the SQL in D1 Console
- Secrets live only in Cloudflare (Workers → fixasif-premium → Settings → Variables). Never commit them.

Deploy: `npx wrangler deploy` (the cron runs daily to expire old orders).

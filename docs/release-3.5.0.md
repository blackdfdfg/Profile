# Fix 3.5.0 — deployment checklist

**Not production-ready until the open decisions below are resolved and staging is verified.** This branch changes checkout and must not be merged/deployed automatically or independently.

## Scope
- One new paid offer: $2 USDT, one key, six months. Legacy package definitions remain available for existing orders; new orders accept only the new plan.
- Free access is a manual support/ownership-review process. Never ask for passwords, OTPs, session cookies or other secrets. Duration and provisioning process require owner confirmation.
- Newly initialized eligible wallets receive 500 welcome credits once. Existing balances are not modified. Existing trials retain their prior terms; new trial claims are disabled.
- New referral creation and new signup attribution are disabled. Existing referral payouts and old-order settlement remain supported; review all outstanding obligations before retiring legacy endpoints. No new rewards on the new package.
- Telegram paid-license outbox messages distinguish paid/pending stock from delivered key, without sending the key. Top-up and historical payout notifications remain intact. Configure secrets in Cloudflare only; never put tokens in source.
- No database migration or existing expiry/credit changes are included. Backup D1 and test against a safe representative copy before any such work.

## Owner decisions before migration
1. Existing buyers: add six months to their existing expiry, or ensure a minimum of six months from migration date? Define treatment of expired, revoked, trial and duplicate-user keys.
2. Existing wallets: add 500 to current balance, raise to at least 500, or another rule? Define one-time eligibility and ledger event IDs.
3. Free access: duration, approvals and issuance rules.
4. Resolve existing referral commitments and communicate the cutoff.

## Release safely
1. Confirm the exact deployed Worker source/version and preserve its complete bindings, secrets, settings, schedules and routes. Create D1 backup; do not print or export secrets into logs.
2. Run `npm test` and `npm run build` in `worker`; run website tests using a staging Worker. Validate payment verification, old pending orders, duplicate callbacks, out-of-stock delivery, credit ledger and Telegram alerts with test data.
3. Coordinate Worker and website cutover in a maintenance window: the old checkout and new Worker do not expose the same purchase options. Check the $2 price server-side, 500-credit provisioning, and live notification delivery afterward. Keep rollback and payment reconciliation plans.
4. Existing-customer expiry/credits migration is a **separate**, reviewed, idempotent operation after the owner decisions above. Do not run automatic SQL against customer data from this branch.
5. Extension v3.5.0 is a separate installable package; website/Worker deployment does not update installed extensions or publish a Store release.

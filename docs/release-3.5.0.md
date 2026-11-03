# Fix 3.5.0 — deployment checklist

**Release checklist.** The website and Worker must be coordinated; extension distribution is separate.

## Scope
- One new paid offer: $2 USDT, one key, six months. Legacy package definitions remain available for existing orders; new orders accept only the new plan.
- Free access is a manual support/ownership-review process. Never ask for passwords, OTPs, session cookies or other secrets. Duration and provisioning process require owner confirmation.
- Newly initialized eligible wallets receive 500 welcome credits once. Existing balances are not modified. Existing trials retain their prior terms; new trial claims are disabled.
- New referral creation and new signup attribution are disabled. Existing referral payouts and old-order settlement remain supported; review all outstanding obligations before retiring legacy endpoints. No new rewards on the new package.
- Telegram paid-license outbox messages distinguish paid/pending stock from delivered key, without sending the key. Top-up and historical payout notifications remain intact. Configure secrets in Cloudflare only; never put tokens in source.
- An idempotent audited migration set the expiry of 8 verified paid sold keys to 2027-05-03T20:42:58.278Z; no wallet balances or ledger entries were modified. A D1 time-travel bookmark was recorded first. Two manually issued keys with longer existing expiry were left unchanged pending owner confirmation; trial keys were excluded.

## Remaining owner decisions
1. Whether to shorten the two manually issued longer-term keys; leave them unchanged until confirmed.
2. Free access duration, approvals and issuance rules.
3. Resolve outstanding referral commitments without deleting payout records.

## Release safely
1. Confirm the exact deployed Worker source/version and preserve its complete bindings, secrets, settings, schedules and routes. Create D1 backup; do not print or export secrets into logs.
2. Run `npm test` and `npm run build` in `worker`; run website tests using a staging Worker. Validate payment verification, old pending orders, duplicate callbacks, out-of-stock delivery, credit ledger and Telegram alerts with test data.
3. Coordinate Worker and website cutover in a maintenance window: the old checkout and new Worker do not expose the same purchase options. Check the $2 price server-side, 500-credit provisioning, and live notification delivery afterward. Keep rollback and payment reconciliation plans.
4. Do not alter existing balances. The paid-key expiry operation has already been applied and audited; do not rerun it with a different migration identifier.
5. Extension v3.5.0 is a separate installable package; website/Worker deployment does not update installed extensions or publish a Store release.

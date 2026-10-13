-- Apply once to the existing database. No access keys or user records are removed.
ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'license';
ALTER TABLE orders ADD COLUMN credit_quantity INTEGER;
ALTER TABLE orders ADD COLUMN credit_key_id INTEGER;
CREATE TABLE IF NOT EXISTS credit_wallets (
 key_id INTEGER PRIMARY KEY REFERENCES access_keys(id), balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
 free_granted INTEGER NOT NULL DEFAULT 0, purchased INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credit_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, key_id INTEGER NOT NULL,
 delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_jobs (
 id TEXT PRIMARY KEY, key_id INTEGER NOT NULL, status TEXT NOT NULL, response_text TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_jobs_time ON credit_jobs(status, updated_at);
CREATE TABLE IF NOT EXISTS referral_profiles (
 user_id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, wallet_address TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referred_id INTEGER NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending', signup_ip_hash TEXT, created_at INTEGER NOT NULL, success_at INTEGER, order_id INTEGER
);
CREATE TABLE IF NOT EXISTS referral_payouts (
 id TEXT PRIMARY KEY, referral_id INTEGER NOT NULL UNIQUE, user_id INTEGER NOT NULL, wallet_address TEXT NOT NULL,
 amount_micros INTEGER NOT NULL DEFAULT 1000000, status TEXT NOT NULL DEFAULT 'awaiting_confirmation',
 created_at INTEGER NOT NULL, approved_at INTEGER, tx_hash TEXT UNIQUE, error TEXT
);
CREATE TABLE IF NOT EXISTS payment_receipts (
 transaction_id TEXT PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO payment_receipts(transaction_id, order_id, created_at)
 SELECT binance_order_id, id, COALESCE(paid_at, created_at) FROM orders WHERE status='paid' AND binance_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS notification_outbox (
 event_id TEXT PRIMARY KEY, text TEXT NOT NULL, buttons TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, last_attempt INTEGER
);
-- Idempotent welcome grant for every previously sold key (including expired buyers).
INSERT OR IGNORE INTO credit_wallets(key_id, balance, free_granted)
 SELECT id, 300, 300 FROM access_keys WHERE status='sold';
INSERT OR IGNORE INTO credit_ledger(event_id, key_id, delta, reason, created_at)
 SELECT 'welcome:' || key_id, key_id, 300, 'welcome', CAST(strftime('%s','now') AS INTEGER)*1000 FROM credit_wallets WHERE free_granted=300;

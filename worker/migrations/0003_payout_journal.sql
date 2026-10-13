-- Signed transaction journal prevents repeat transfers after network interruptions.
CREATE TABLE IF NOT EXISTS payout_transactions (
 payout_id TEXT PRIMARY KEY, signed_tx TEXT NOT NULL, tx_hash TEXT UNIQUE NOT NULL,
 chain_id INTEGER NOT NULL, payer TEXT NOT NULL, nonce INTEGER NOT NULL,
 created_at INTEGER NOT NULL, broadcast_at INTEGER, confirmed_at INTEGER
);
CREATE TABLE IF NOT EXISTS payout_locks (
 id INTEGER PRIMARY KEY, owner TEXT, expires_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO payout_locks(id,expires_at) VALUES (1,0);

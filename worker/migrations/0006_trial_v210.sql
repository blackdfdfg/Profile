-- Additive only; no customer export, deletes, expiry resets or old migrations.
CREATE TABLE IF NOT EXISTS trial_claims (
 x_username TEXT PRIMARY KEY COLLATE NOCASE,
 user_id INTEGER NOT NULL UNIQUE,
 access_key TEXT NOT NULL UNIQUE,
 claimed_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_trial_username_v210 ON access_keys(lower(x_username));
CREATE INDEX IF NOT EXISTS idx_orders_trial_username_v210 ON orders(lower(x_username),status,kind);

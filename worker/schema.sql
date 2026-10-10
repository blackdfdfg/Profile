-- FixAsif Agent — D1 schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  created_at INTEGER NOT NULL,
  google_id TEXT UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS access_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',   -- available | sold | revoked
  sold_at INTEGER,
  expires_at INTEGER,
  order_id INTEGER,
  last_login_at INTEGER,
  x_username TEXT,                            -- set at purchase; login needs key + this username
  user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keys_user ON access_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_keys_status ON access_keys(status);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | paid | expired
  binance_order_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_id INTEGER NOT NULL,
  paid_at INTEGER,
  x_username TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

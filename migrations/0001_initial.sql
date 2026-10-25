CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data))
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  claim_id TEXT
);
CREATE INDEX IF NOT EXISTS payments_user_product_date ON payments(user_id, product, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_user_date ON payments(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS telegram_updates (
  id INTEGER PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('processing', 'done')),
  lease_until INTEGER NOT NULL,
  claim_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_expiry ON telegram_updates(lease_until);

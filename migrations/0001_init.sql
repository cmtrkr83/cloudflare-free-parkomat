CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  public_token TEXT UNIQUE NOT NULL,
  admin_token TEXT UNIQUE NOT NULL,
  link_code TEXT UNIQUE NOT NULL,
  plate_masked TEXT NOT NULL,
  telegram_chat_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_public ON vehicles(public_token);
CREATE INDEX IF NOT EXISTS idx_vehicles_admin ON vehicles(admin_token);
CREATE INDEX IF NOT EXISTS idx_vehicles_link ON vehicles(link_code);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_vehicle_time ON messages(vehicle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_ip_time ON messages(ip_hash, created_at);

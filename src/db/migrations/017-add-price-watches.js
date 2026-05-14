export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_name TEXT NOT NULL,
      max_price REAL NOT NULL,
      condition TEXT NOT NULL DEFAULT 'nm',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_checked TEXT,
      last_price REAL,
      last_notified TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_price_watches_user ON price_watches(user_id);
    CREATE INDEX idx_price_watches_active ON price_watches(is_active);

    CREATE TABLE IF NOT EXISTS price_check_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watch_id INTEGER NOT NULL REFERENCES price_watches(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      found_price REAL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_price_check_log_watch ON price_check_log(watch_id);
  `);

  console.log('✓ Added price_watches and price_check_log tables');
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_price_check_log_watch;
    DROP TABLE IF EXISTS price_check_log;
    DROP INDEX IF EXISTS idx_price_watches_active;
    DROP INDEX IF EXISTS idx_price_watches_user;
    DROP TABLE IF EXISTS price_watches;
  `);
}

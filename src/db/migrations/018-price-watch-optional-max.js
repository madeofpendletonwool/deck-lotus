export function up(db) {
  // SQLite doesn't support ALTER COLUMN, so recreate the table with max_price nullable
  // and condition allowing 'any'
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_watches_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_name TEXT NOT NULL,
      max_price REAL,
      condition TEXT NOT NULL DEFAULT 'nm',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_checked TEXT,
      last_price REAL,
      last_notified TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO price_watches_new SELECT * FROM price_watches;
    DROP TABLE price_watches;
    ALTER TABLE price_watches_new RENAME TO price_watches;

    CREATE INDEX IF NOT EXISTS idx_price_watches_user ON price_watches(user_id);
    CREATE INDEX IF NOT EXISTS idx_price_watches_active ON price_watches(is_active);
  `);

  console.log('✓ Made price_watches.max_price nullable (supports "alert on new low" mode)');
}

export function down(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_watches_old (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_name TEXT NOT NULL,
      max_price REAL NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'nm',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_checked TEXT,
      last_price REAL,
      last_notified TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO price_watches_old SELECT * FROM price_watches;
    DROP TABLE price_watches;
    ALTER TABLE price_watches_old RENAME TO price_watches;

    CREATE INDEX IF NOT EXISTS idx_price_watches_user ON price_watches(user_id);
    CREATE INDEX IF NOT EXISTS idx_price_watches_active ON price_watches(is_active);
  `);
}

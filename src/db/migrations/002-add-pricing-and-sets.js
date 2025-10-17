export function up(db) {
  // Sets table - import from MTGJSON sets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      release_date TEXT,
      block TEXT,
      base_set_size INTEGER,
      total_set_size INTEGER,
      keyrune_code TEXT,
      tcgplayer_group_id INTEGER,
      is_online_only INTEGER DEFAULT 0,
      is_foil_only INTEGER DEFAULT 0
    );
    CREATE INDEX idx_sets_code ON sets(code);
    CREATE INDEX idx_sets_release_date ON sets(release_date);
  `);

  // Pricing table - stores current prices for printings
  db.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printing_uuid TEXT NOT NULL,
      provider TEXT NOT NULL,
      price_type TEXT NOT NULL,
      price REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (printing_uuid) REFERENCES printings(uuid) ON DELETE CASCADE,
      UNIQUE(printing_uuid, provider, price_type)
    );
    CREATE INDEX idx_prices_printing_uuid ON prices(printing_uuid);
    CREATE INDEX idx_prices_provider ON prices(provider);
  `);

  // Add purchase URLs to printings table
  db.exec(`
    ALTER TABLE printings ADD COLUMN tcgplayer_url TEXT;
    ALTER TABLE printings ADD COLUMN cardmarket_url TEXT;
    ALTER TABLE printings ADD COLUMN cardkingdom_url TEXT;
  `);

  console.log('✓ Added pricing and sets tables');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS prices;
    DROP TABLE IF EXISTS sets;
  `);
  console.log('✓ Pricing and sets tables rolled back');
}

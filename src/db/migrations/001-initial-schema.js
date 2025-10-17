export function up(db) {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_users_username ON users(username);
    CREATE INDEX idx_users_email ON users(email);
  `);

  // API Keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_used DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
    CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
  `);

  // Cards table (atomic card data)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mana_cost TEXT,
      cmc REAL,
      colors TEXT,
      color_identity TEXT,
      type_line TEXT,
      oracle_text TEXT,
      power TEXT,
      toughness TEXT,
      loyalty TEXT,
      keywords TEXT,
      legalities TEXT,
      is_reserved INTEGER DEFAULT 0,
      edhrec_rank INTEGER,
      UNIQUE(name)
    );
    CREATE INDEX idx_cards_name ON cards(name);
    CREATE INDEX idx_cards_colors ON cards(colors);
    CREATE INDEX idx_cards_type_line ON cards(type_line);
  `);

  // Printings table (set-specific card data)
  db.exec(`
    CREATE TABLE IF NOT EXISTS printings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      uuid TEXT UNIQUE NOT NULL,
      set_code TEXT NOT NULL,
      collector_number TEXT,
      rarity TEXT,
      artist TEXT,
      flavor_text TEXT,
      image_url TEXT,
      finishes TEXT,
      is_promo INTEGER DEFAULT 0,
      is_full_art INTEGER DEFAULT 0,
      frame_version TEXT,
      border_color TEXT,
      watermark TEXT,
      language TEXT DEFAULT 'en',
      released_at TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_printings_card_id ON printings(card_id);
    CREATE INDEX idx_printings_uuid ON printings(uuid);
    CREATE INDEX idx_printings_set_code ON printings(set_code);
  `);

  // Decks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      format TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_decks_user_id ON decks(user_id);
  `);

  // Deck Cards table (junction table for decks and printings)
  db.exec(`
    CREATE TABLE IF NOT EXISTS deck_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      printing_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      is_sideboard INTEGER DEFAULT 0,
      is_commander INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      FOREIGN KEY (printing_id) REFERENCES printings(id) ON DELETE CASCADE,
      UNIQUE(deck_id, printing_id, is_sideboard)
    );
    CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
    CREATE INDEX idx_deck_cards_printing_id ON deck_cards(printing_id);
  `);

  console.log('✓ Initial schema created');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS deck_cards;
    DROP TABLE IF EXISTS decks;
    DROP TABLE IF EXISTS printings;
    DROP TABLE IF EXISTS cards;
    DROP TABLE IF EXISTS api_keys;
    DROP TABLE IF EXISTS users;
  `);
  console.log('✓ Schema rolled back');
}

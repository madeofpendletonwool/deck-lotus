export function up(db) {
  // Deck shares table for public sharing functionality
  db.exec(`
    CREATE TABLE IF NOT EXISTS deck_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_deck_shares_token ON deck_shares(share_token);
    CREATE INDEX idx_deck_shares_deck_id ON deck_shares(deck_id);
  `);

  console.log('✓ Deck shares table created');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS deck_shares;
  `);
  console.log('✓ Deck shares table dropped');
}

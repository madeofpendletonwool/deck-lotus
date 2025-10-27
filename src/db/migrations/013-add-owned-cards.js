export function up(db) {
  // Create owned_cards table to track user card ownership
  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      UNIQUE(user_id, card_id)
    );

    CREATE INDEX idx_owned_cards_user_id ON owned_cards(user_id);
    CREATE INDEX idx_owned_cards_card_id ON owned_cards(card_id);
  `);

  console.log('✓ Added owned_cards table');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS owned_cards;
  `);
  console.log('✓ Removed owned_cards table');
}

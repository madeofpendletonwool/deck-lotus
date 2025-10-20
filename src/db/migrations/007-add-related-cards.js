export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS related_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL,
      related_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      FOREIGN KEY (card_name) REFERENCES cards(name) ON DELETE CASCADE
    );
    CREATE INDEX idx_related_cards_name ON related_cards(card_name);
    CREATE INDEX idx_related_relation_type ON related_cards(relation_type);
  `);
  console.log('✓ Created related_cards table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS related_cards;`);
  console.log('✓ Dropped related_cards table');
}

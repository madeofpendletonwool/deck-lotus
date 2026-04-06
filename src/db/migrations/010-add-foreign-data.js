export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_foreign_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL,
      language TEXT NOT NULL,
      foreign_name TEXT,
      foreign_text TEXT,
      foreign_type TEXT,
      foreign_flavor_text TEXT,
      FOREIGN KEY (card_name) REFERENCES cards(name) ON DELETE CASCADE
    );
    CREATE INDEX idx_foreign_card_name ON card_foreign_data(card_name);
    CREATE INDEX idx_foreign_language ON card_foreign_data(language);
    CREATE INDEX idx_foreign_name ON card_foreign_data(foreign_name);
  `);
  console.log('✓ Created card_foreign_data table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS card_foreign_data;`);
  console.log('✓ Dropped card_foreign_data table');
}

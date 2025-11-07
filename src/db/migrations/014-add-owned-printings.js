export function up(db) {
  // Create owned_printings table to track specific printing ownership with quantities
  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_printings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      printing_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (printing_id) REFERENCES printings(id) ON DELETE CASCADE,
      UNIQUE(user_id, printing_id)
    );

    CREATE INDEX idx_owned_printings_user_id ON owned_printings(user_id);
    CREATE INDEX idx_owned_printings_printing_id ON owned_printings(printing_id);
  `);

  console.log('✓ Added owned_printings table');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS owned_printings;
  `);
  console.log('✓ Removed owned_printings table');
}

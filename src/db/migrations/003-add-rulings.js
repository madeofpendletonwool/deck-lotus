export function up(db) {
  // Rulings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      date TEXT NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (uuid) REFERENCES printings(uuid) ON DELETE CASCADE
    );
    CREATE INDEX idx_rulings_uuid ON rulings(uuid);
  `);

  console.log('✓ Rulings table created');
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS rulings;
  `);
  console.log('✓ Rulings table dropped');
}

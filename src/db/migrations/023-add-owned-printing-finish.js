/**
 * Foil tracking, plus idempotent scan uploads from the Android app.
 *  - owned_printings.finish: 'nonfoil' | 'foil' | 'etched'. A foil and a nonfoil copy
 *    of the same printing are separate rows, so the unique key gains the finish.
 *    SQLite can't change a UNIQUE constraint in place, so the table is rebuilt;
 *    existing rows become nonfoil and keep their ids.
 *  - inventory_scan_batches: the phone sends each batch of scanned cards with an id
 *    and retries until it hears back; remembering the id stops a retry after a lost
 *    response from adding the cards twice.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE owned_printings_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      printing_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      finish TEXT NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (printing_id) REFERENCES printings(id) ON DELETE CASCADE,
      UNIQUE(user_id, printing_id, finish)
    );

    INSERT INTO owned_printings_new (id, user_id, printing_id, quantity, finish, created_at, updated_at)
      SELECT id, user_id, printing_id, quantity, 'nonfoil', created_at, updated_at FROM owned_printings;

    DROP TABLE owned_printings;
    ALTER TABLE owned_printings_new RENAME TO owned_printings;

    CREATE INDEX idx_owned_printings_user_id ON owned_printings(user_id);
    CREATE INDEX idx_owned_printings_printing_id ON owned_printings(printing_id);

    CREATE TABLE IF NOT EXISTS inventory_scan_batches (
      user_id INTEGER NOT NULL,
      batch_id TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, batch_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('✓ Added finish (foil/etched) to owned printings, and scan batch tracking');
}

export function down(db) {
  // Folding foil rows back into nonfoil ones would merge quantities; leave the column.
  db.exec(`DROP TABLE IF EXISTS inventory_scan_batches;`);
  console.log('✓ Dropped inventory_scan_batches (finish column remains)');
}

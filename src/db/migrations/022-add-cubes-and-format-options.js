/**
 * Cubes and format options.
 *  - decks.settings: JSON for format options (two-headed giant card pool and teammate deck,
 *    cube pack size, seats, card pool restriction and so on)
 *  - deck_cards.tags / color_category / notes: per-card cube metadata, as CubeCobra keeps it
 *  - deck_changes: what was added and removed and when, for a cube's history
 */
export function up(db) {
  db.exec(`
    ALTER TABLE decks ADD COLUMN settings TEXT;
    ALTER TABLE deck_cards ADD COLUMN tags TEXT;
    ALTER TABLE deck_cards ADD COLUMN color_category TEXT;
    ALTER TABLE deck_cards ADD COLUMN notes TEXT;

    CREATE TABLE IF NOT EXISTS deck_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      action TEXT NOT NULL,          -- 'add' or 'remove'
      card_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      board_type TEXT NOT NULL DEFAULT 'mainboard',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_deck_changes_deck ON deck_changes(deck_id, created_at);
  `);
  console.log('✓ Added cube metadata, deck settings and deck history');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS deck_changes;`);
  console.log('✓ Dropped deck_changes (added columns remain, unused)');
}

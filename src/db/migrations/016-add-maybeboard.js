export function up(db) {
  // Add board_type column to deck_cards table
  // Default to 'mainboard' for existing cards
  db.exec(`
    ALTER TABLE deck_cards ADD COLUMN board_type TEXT DEFAULT 'mainboard';
  `);

  // Update existing cards based on is_sideboard flag
  db.exec(`
    UPDATE deck_cards SET board_type = 'sideboard' WHERE is_sideboard = 1;
    UPDATE deck_cards SET board_type = 'mainboard' WHERE is_sideboard = 0;
  `);

  // Create index on board_type for better query performance
  db.exec(`
    CREATE INDEX idx_deck_cards_board_type ON deck_cards(board_type);
  `);

  console.log('✓ Added maybeboard support with board_type column');
}

export function down(db) {
  // Remove the board_type column and index
  db.exec(`
    DROP INDEX IF EXISTS idx_deck_cards_board_type;
  `);

  // Note: SQLite doesn't support DROP COLUMN in older versions
  // In production, you'd need to recreate the table without the column
  console.log('✓ Maybeboard migration rolled back (board_type column remains but is unused)');
}

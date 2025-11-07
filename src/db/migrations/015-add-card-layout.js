export function up(db) {
  // Add layout column to cards table to distinguish different card types
  // (transform, modal_dfc, split, adventure, etc.)
  db.exec(`
    ALTER TABLE cards ADD COLUMN layout TEXT;
  `);

  console.log('✓ Added layout column to cards table');
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN easily, so we'd need to recreate the table
  // For now, we'll just note this limitation
  console.log('✗ Cannot easily drop column in SQLite - would require table recreation');
}

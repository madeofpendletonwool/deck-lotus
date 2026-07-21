export function up(db) {
  // Index foreign_name so multilingual card search can use it.
  // This lives in its own migration (rather than being added to 010) because 010 has
  // already been applied on existing installs and would never re-run for them.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_foreign_name ON card_foreign_data(foreign_name);
  `);
  console.log('✓ Added idx_foreign_name index on card_foreign_data');
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_foreign_name;`);
  console.log('✓ Dropped idx_foreign_name index');
}

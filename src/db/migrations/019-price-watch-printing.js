export function up(db) {
  db.exec(`
    ALTER TABLE price_watches ADD COLUMN card_id INTEGER;
    ALTER TABLE price_watches ADD COLUMN scryfall_id TEXT;
    ALTER TABLE price_watches ADD COLUMN image_url TEXT;
    ALTER TABLE price_watches ADD COLUMN set_code TEXT;
    ALTER TABLE price_watches ADD COLUMN set_name TEXT;
  `);
  console.log('✓ Added printing fields to price_watches');
}

export function down(db) {
  // SQLite does not support DROP COLUMN before 3.35 — no-op for safety
}

export function up(db) {
  db.exec(`
    ALTER TABLE printings ADD COLUMN scryfall_id TEXT;
    CREATE INDEX idx_printings_scryfall_id ON printings(scryfall_id);
  `);
  console.log('✓ Added scryfall_id to printings table');
}

export function down(db) {
  // SQLite can't drop columns easily, so we recreate the table
  db.exec(`
    CREATE TABLE printings_backup AS
    SELECT id, card_id, uuid, set_code, collector_number, rarity,
           artist, flavor_text, image_url, finishes, is_promo, is_full_art,
           frame_version, border_color, watermark, language, released_at,
           tcgplayer_url, cardmarket_url, cardkingdom_url
    FROM printings;

    DROP TABLE printings;
    ALTER TABLE printings_backup RENAME TO printings;

    -- Recreate indexes
    CREATE INDEX idx_printings_card_id ON printings(card_id);
    CREATE INDEX idx_printings_uuid ON printings(uuid);
    CREATE INDEX idx_printings_set_code ON printings(set_code);
  `);
  console.log('✓ Removed scryfall_id from printings table');
}

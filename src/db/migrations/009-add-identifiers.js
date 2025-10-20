export function up(db) {
  db.exec(`
    ALTER TABLE printings ADD COLUMN mtgo_id INTEGER;
    ALTER TABLE printings ADD COLUMN mtgo_foil_id INTEGER;
    ALTER TABLE printings ADD COLUMN tcgplayer_product_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_foil_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_etched_id INTEGER;
    ALTER TABLE printings ADD COLUMN mtg_arena_id INTEGER;
    ALTER TABLE printings ADD COLUMN multiverse_id INTEGER;

    CREATE INDEX idx_printings_mtgo_id ON printings(mtgo_id);
    CREATE INDEX idx_printings_tcgplayer_product_id ON printings(tcgplayer_product_id);
  `);
  console.log('✓ Added extended identifiers to printings table');
}

export function down(db) {
  // SQLite can't drop columns easily, so we recreate the table
  db.exec(`
    CREATE TABLE printings_backup AS SELECT
      id, card_id, uuid, set_code, collector_number, rarity,
      artist, flavor_text, image_url, finishes, is_promo, is_full_art,
      frame_version, border_color, watermark, language, released_at,
      tcgplayer_url, cardmarket_url, cardkingdom_url, scryfall_id
    FROM printings;

    DROP TABLE printings;
    ALTER TABLE printings_backup RENAME TO printings;

    -- Recreate indexes
    CREATE INDEX idx_printings_card_id ON printings(card_id);
    CREATE INDEX idx_printings_uuid ON printings(uuid);
    CREATE INDEX idx_printings_set_code ON printings(set_code);
    CREATE INDEX idx_printings_scryfall_id ON printings(scryfall_id);
  `);
  console.log('✓ Removed extended identifiers from printings table');
}

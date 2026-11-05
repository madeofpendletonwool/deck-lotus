export function up(db) {
  db.exec(`
    -- LIKE compares case-insensitively, so SQLite can only use an index for a prefix match
    -- when that index is NOCASE too. The BINARY idx_foreign_name from migration 020 never helped.
    DROP INDEX IF EXISTS idx_foreign_name;
    CREATE INDEX IF NOT EXISTS idx_cards_name_nocase ON cards(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_foreign_name_nocase ON card_foreign_data(foreign_name COLLATE NOCASE, card_name);

    -- Finding the second half of a split name needs a scan, so keep it to just those rows.
    CREATE INDEX IF NOT EXISTS idx_foreign_split_names ON card_foreign_data(foreign_name COLLATE NOCASE, card_name)
      WHERE foreign_name LIKE '%//%';

    -- Covers price lookups. idx_prices_provider has about three distinct values and led the
    -- planner to walk most of the table for every card, which froze the server for minutes.
    DROP INDEX IF EXISTS idx_prices_provider;
    CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices(printing_uuid, provider, price_type, price);

    -- Deck import and shared deck import set is_sideboard without board_type, so those
    -- sideboards were shown in the main deck. Normal edits keep the two columns in sync.
    UPDATE deck_cards SET board_type = 'sideboard' WHERE is_sideboard = 1 AND board_type = 'mainboard';

    ANALYZE;
  `);
  console.log('✓ Optimized card search and price indexes, repaired imported sideboards');
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_cards_name_nocase;
    DROP INDEX IF EXISTS idx_foreign_name_nocase;
    DROP INDEX IF EXISTS idx_foreign_split_names;
    DROP INDEX IF EXISTS idx_prices_lookup;
    CREATE INDEX IF NOT EXISTS idx_foreign_name ON card_foreign_data(foreign_name);
    CREATE INDEX IF NOT EXISTS idx_prices_provider ON prices(provider);
  `);
  console.log('✓ Restored previous search and price indexes');
}

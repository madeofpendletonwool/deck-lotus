export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN subtypes TEXT;
    ALTER TABLE cards ADD COLUMN supertypes TEXT;
    ALTER TABLE cards ADD COLUMN types TEXT;
  `);
  console.log('✓ Added type arrays to cards table');
}

export function down(db) {
  // SQLite can't drop columns easily, so we recreate the table
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank
    FROM cards;

    DROP TABLE cards;
    ALTER TABLE cards_backup RENAME TO cards;

    -- Recreate indexes
    CREATE INDEX idx_cards_name ON cards(name);
    CREATE INDEX idx_cards_colors ON cards(colors);
    CREATE INDEX idx_cards_type_line ON cards(type_line);
  `);
  console.log('✓ Removed type arrays from cards table');
}

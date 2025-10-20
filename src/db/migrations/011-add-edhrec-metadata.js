export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN edhrec_saltiness REAL;
    ALTER TABLE cards ADD COLUMN first_printing TEXT;
  `);
  console.log('✓ Added EDHRec metadata to cards table');
}

export function down(db) {
  // SQLite can't drop columns easily, so we recreate the table
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, legalities, is_reserved, edhrec_rank,
      subtypes, supertypes, types, leadership_skills
    FROM cards;

    DROP TABLE cards;
    ALTER TABLE cards_backup RENAME TO cards;

    -- Recreate indexes
    CREATE INDEX idx_cards_name ON cards(name);
    CREATE INDEX idx_cards_colors ON cards(colors);
    CREATE INDEX idx_cards_type_line ON cards(type_line);
  `);
  console.log('✓ Removed EDHRec metadata from cards table');
}

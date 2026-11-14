/**
 * Per-deck ownership. deck_cards.owned_quantity is how many of the row's copies come from your
 * collection, so one owned Ornithopter can be in one deck, not in every deck that lists it.
 *
 * The triggers keep each row's count between 0 and its quantity, and at 0 on the maybeboard.
 * Keeping the total within the collection is src/db/ownership.js's job.
 *
 * Existing copies are handed out once: oldest decks first, mainboard before sideboard.
 */
import { allocateAll } from '../ownership.js';

const CAP = `CASE WHEN COALESCE(NEW.board_type, CASE WHEN NEW.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) = 'maybeboard'
                 THEN 0 ELSE MAX(NEW.quantity, 0) END`;

export function up(db) {
  db.exec(`
    ALTER TABLE deck_cards ADD COLUMN owned_quantity INTEGER NOT NULL DEFAULT 0;

    CREATE TRIGGER IF NOT EXISTS deck_cards_owned_cap_insert
    AFTER INSERT ON deck_cards
    WHEN NEW.owned_quantity < 0 OR NEW.owned_quantity > ${CAP}
    BEGIN
      UPDATE deck_cards SET owned_quantity = MAX(0, MIN(NEW.owned_quantity, ${CAP})) WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS deck_cards_owned_cap_update
    AFTER UPDATE OF quantity, board_type, is_sideboard, owned_quantity ON deck_cards
    WHEN NEW.owned_quantity < 0 OR NEW.owned_quantity > ${CAP}
    BEGIN
      UPDATE deck_cards SET owned_quantity = MAX(0, MIN(NEW.owned_quantity, ${CAP})) WHERE id = NEW.id;
    END;
  `);
  const assigned = allocateAll(db);
  console.log(`✓ Added per-deck ownership (${assigned} owned copies placed in decks)`);
}

export function down(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS deck_cards_owned_cap_insert;
    DROP TRIGGER IF EXISTS deck_cards_owned_cap_update;
    ALTER TABLE deck_cards DROP COLUMN owned_quantity;
  `);
  console.log('✓ Removed per-deck ownership');
}

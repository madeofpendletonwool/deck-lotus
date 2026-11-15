/**
 * Proxies. deck_cards.proxy_quantity is how many of a row's copies are proxies: stand-ins that
 * aren't yours and never touch your collection. They count as covered in a deck, so they're left
 * out of what to buy, but not as owned.
 *
 * A row's real copies and proxies together never pass its quantity, and real copies win: when
 * owned_quantity grows, proxies shrink to make room. Maybeboard rows hold neither. The triggers
 * keep that, so nothing else has to.
 */
const CAP = `CASE WHEN COALESCE(NEW.board_type, CASE WHEN NEW.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) = 'maybeboard'
                 THEN 0 ELSE MAX(NEW.quantity, 0) END`;
const ROOM = `MAX(0, ${CAP} - MAX(NEW.owned_quantity, 0))`;

export function up(db) {
  db.exec(`
    ALTER TABLE deck_cards ADD COLUMN proxy_quantity INTEGER NOT NULL DEFAULT 0;

    CREATE TRIGGER IF NOT EXISTS deck_cards_proxy_cap_insert
    AFTER INSERT ON deck_cards
    WHEN NEW.proxy_quantity < 0 OR NEW.proxy_quantity > ${ROOM}
    BEGIN
      UPDATE deck_cards SET proxy_quantity = MAX(0, MIN(NEW.proxy_quantity, ${ROOM})) WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS deck_cards_proxy_cap_update
    AFTER UPDATE OF quantity, board_type, is_sideboard, owned_quantity, proxy_quantity ON deck_cards
    WHEN NEW.proxy_quantity < 0 OR NEW.proxy_quantity > ${ROOM}
    BEGIN
      UPDATE deck_cards SET proxy_quantity = MAX(0, MIN(NEW.proxy_quantity, ${ROOM})) WHERE id = NEW.id;
    END;
  `);
  console.log('✓ Added deck proxies');
}

export function down(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS deck_cards_proxy_cap_insert;
    DROP TRIGGER IF EXISTS deck_cards_proxy_cap_update;
    ALTER TABLE deck_cards DROP COLUMN proxy_quantity;
  `);
  console.log('✓ Removed deck proxies');
}

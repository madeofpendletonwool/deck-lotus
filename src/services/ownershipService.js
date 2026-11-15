/**
 * Moving owned copies in and out of decks. The rules are in src/db/ownership.js.
 */
import db from '../db/connection.js';
import { isBasicLand } from '../../shared/formats.js';
import { BOARD_SQL, claimFree, copiesOf, fillDeck, releaseExcess, releaseExcessForAll } from '../db/ownership.js';

export { copiesOf };

const badRequest = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Give back copies the collection no longer has, for these cards (null: every card). */
export function releaseExcessCopies(userId, cardIds = null) {
  return releaseExcess(db, userId, cardIds);
}

export function releaseExcessCopiesForAll() {
  return releaseExcessForAll(db);
}

/** Put free copies into a deck row, up to `max` more. Inside the caller's transaction is fine. */
export function claimFreeCopies(userId, deckCardId, max = Infinity) {
  return claimFree(db, userId, deckCardId, max);
}

/** Fill every row of a deck from free copies, for a deck that was just created or imported. */
export function claimFreeCopiesForDeck(userId, deckId) {
  return fillDeck(db, userId, deckId);
}

function rowFor(userId, deckId, deckCardId) {
  return db.get(
    `SELECT dc.id, dc.quantity, dc.owned_quantity, dc.proxy_quantity, dc.printing_id, p.card_id, c.name, ${BOARD_SQL} AS board_type
     FROM deck_cards dc
     JOIN decks d ON d.id = dc.deck_id
     JOIN printings p ON p.id = dc.printing_id
     JOIN cards c ON c.id = p.card_id
     WHERE dc.id = ? AND dc.deck_id = ? AND d.user_id = ?`,
    [deckCardId, deckId, userId]
  );
}

/** Where this card's copies are, from the point of view of one deck. */
function ownershipView(userId, deckId, row) {
  const copies = copiesOf(db, userId, row.card_id);
  return {
    deck_card_id: row.id,
    card_id: row.card_id,
    name: row.name,
    quantity: row.quantity,
    owned_quantity: row.owned_quantity,
    proxy_quantity: row.proxy_quantity,
    collection_quantity: copies.owned,
    free_quantity: copies.free,
    elsewhere: copies.decks.filter((d) => d.deck_id !== Number(deckId) && d.held > 0),
  };
}

export function getDeckCardOwnership(userId, deckId, deckCardId) {
  const row = rowFor(userId, deckId, deckCardId);
  if (!row) throw badRequest('Card not found in that deck', 404);
  return ownershipView(userId, deckId, row);
}

/**
 * Set how many of a deck row's copies come from your collection.
 *
 * Going up, copies come from: free copies first, then the decks in `takeFrom` (in that order),
 * then, when `addToCollection` is set, new copies of the row's printing added to your collection.
 * Whatever can't be covered is reported as `short`. Going down, copies go back to the collection
 * as free copies. They are never removed from it.
 */
export function setDeckCardOwned(userId, deckId, deckCardId, { owned, takeFrom = [], addToCollection = false } = {}) {
  const wanted = Number(owned);
  if (!Number.isInteger(wanted) || wanted < 0) throw badRequest('owned must be a whole number of copies');
  if (!Array.isArray(takeFrom)) throw badRequest('takeFrom must be a list of deck ids');

  return db.transaction(() => {
    const row = rowFor(userId, deckId, deckCardId);
    if (!row) throw badRequest('Card not found in that deck', 404);
    if (row.board_type === 'maybeboard') throw badRequest("Maybeboard cards don't hold copies; move it to the mainboard or sideboard first");

    const target = Math.min(wanted, row.quantity);
    let have = row.owned_quantity;
    const moved = [];
    let added = 0;

    if (target <= have) {
      have = target;
    } else {
      const { free } = copiesOf(db, userId, row.card_id);
      have += Math.min(target - have, free);

      for (const fromId of takeFrom.map(Number)) {
        if (have >= target) break;
        if (!Number.isInteger(fromId) || fromId === Number(deckId)) continue;
        // Their sideboard gives copies up before their mainboard
        const rows = db.all(
          `SELECT dc.id, dc.owned_quantity, d.name AS deck_name FROM deck_cards dc
           JOIN decks d ON d.id = dc.deck_id JOIN printings p ON p.id = dc.printing_id
           WHERE d.id = ? AND d.user_id = ? AND p.card_id = ? AND dc.owned_quantity > 0
           ORDER BY CASE ${BOARD_SQL} WHEN 'sideboard' THEN 0 ELSE 1 END, dc.id DESC`,
          [fromId, userId, row.card_id]
        );
        let took = 0;
        for (const r of rows) {
          if (have >= target) break;
          const take = Math.min(r.owned_quantity, target - have);
          db.run(`UPDATE deck_cards SET owned_quantity = owned_quantity - ? WHERE id = ?`, [take, r.id]);
          have += take;
          took += take;
        }
        if (took) {
          moved.push({ deck_id: fromId, name: rows[0].deck_name, quantity: took });
          db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [fromId]);
        }
      }

      if (addToCollection && have < target) {
        added = target - have;
        db.run(
          `INSERT INTO owned_printings (user_id, printing_id, quantity, finish) VALUES (?, ?, ?, 'nonfoil')
           ON CONFLICT(user_id, printing_id, finish) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
          [userId, row.printing_id, added]
        );
        db.run(
          `INSERT INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
           ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = 1`,
          [userId, row.card_id]
        );
        have = target;
      }
    }

    db.run(`UPDATE deck_cards SET owned_quantity = ? WHERE id = ?`, [have, row.id]);
    db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
    // Real copies push proxies out (migration 026's triggers), so read the row back
    const view = ownershipView(userId, deckId, rowFor(userId, deckId, deckCardId));
    return { ...view, short: Math.max(0, Math.min(wanted, row.quantity) - have), moved, added };
  });
}

/**
 * Fill a deck from your free copies wherever it's short: { claimed }.
 */
export function claimFreeForDeck(userId, deckId) {
  const deck = db.get(`SELECT id FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) throw badRequest('Deck not found', 404);
  return db.transaction(() => {
    const claimed = claimFreeCopiesForDeck(userId, deckId);
    if (claimed) db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
    return { claimed };
  });
}

/**
 * Set how many of a deck row's copies are proxies. Proxies only fill the copies your collection
 * doesn't: the count is capped at quantity − owned copies in the row (the triggers enforce it).
 */
export function setDeckCardProxies(userId, deckId, deckCardId, proxied) {
  const wanted = Number(proxied);
  if (!Number.isInteger(wanted) || wanted < 0) throw badRequest('proxied must be a whole number of copies');
  return db.transaction(() => {
    const row = rowFor(userId, deckId, deckCardId);
    if (!row) throw badRequest('Card not found in that deck', 404);
    if (row.board_type === 'maybeboard') throw badRequest("Maybeboard cards can't be proxied; move it to the mainboard or sideboard first");
    db.run(`UPDATE deck_cards SET proxy_quantity = ? WHERE id = ?`, [wanted, row.id]);
    db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
    return ownershipView(userId, deckId, rowFor(userId, deckId, deckCardId));
  });
}

/**
 * Proxy, or stop proxying, many rows of a deck at once: { changed, proxied, skippedFree }.
 *
 * `mode` 'missing' proxies the copies each row is short. Copies your free (in no deck) copies
 * could cover aren't proxied; those are counted in `skippedFree` so the page can point at them.
 * Basic lands are left alone: nobody proxies a Mountain, and they aren't counted anywhere.
 * `mode` 'clear' takes the proxies off. `deckCardIds` limits it to those rows (default: all).
 */
export function setDeckProxies(userId, deckId, { mode, deckCardIds = null } = {}) {
  if (mode !== 'missing' && mode !== 'clear') throw badRequest("mode must be 'missing' or 'clear'");
  if (deckCardIds != null && !Array.isArray(deckCardIds)) throw badRequest('deckCardIds must be a list');
  const deck = db.get(`SELECT id FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) throw badRequest('Deck not found', 404);
  const only = deckCardIds ? new Set(deckCardIds.map(Number)) : null;

  return db.transaction(() => {
    const rows = db.all(
      `SELECT dc.id, dc.quantity, dc.owned_quantity, dc.proxy_quantity, p.card_id, c.type_line
       FROM deck_cards dc JOIN printings p ON p.id = dc.printing_id JOIN cards c ON c.id = p.card_id
       WHERE dc.deck_id = ? AND ${BOARD_SQL} != 'maybeboard'
       ORDER BY CASE ${BOARD_SQL} WHEN 'mainboard' THEN 0 ELSE 1 END, dc.id`,
      [deckId]
    ).filter((r) => !only || only.has(r.id));

    const set = db.prepare(`UPDATE deck_cards SET proxy_quantity = ? WHERE id = ?`);
    const free = new Map();
    let changed = 0;
    let proxied = 0;
    let skippedFree = 0;
    for (const r of rows) {
      let target = 0;
      if (mode === 'missing') {
        if (isBasicLand(r)) continue;
        const short = Math.max(0, r.quantity - r.owned_quantity);
        if (!free.has(r.card_id)) free.set(r.card_id, copiesOf(db, userId, r.card_id).free);
        const fromFree = Math.min(short, free.get(r.card_id));
        free.set(r.card_id, free.get(r.card_id) - fromFree);
        skippedFree += fromFree;
        target = short - fromFree;
      }
      if (target === r.proxy_quantity) continue;
      set.run(target, r.id);
      changed += 1;
      proxied += target - r.proxy_quantity;
    }
    if (changed) db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
    return { changed, proxied, skippedFree };
  });
}

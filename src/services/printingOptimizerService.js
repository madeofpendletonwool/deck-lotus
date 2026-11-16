import { getDb } from '../db/index.js';
import { isBinderSet, planBinders } from '../../shared/binders.js';

/**
 * Printing optimizer: move a deck's cards onto printings from as few sets as possible, so the
 * deck reads as one set of binders to pull at a store.
 *
 * Only binder sets count (see shared/binders.js): nobody can go look through a Secret Lair or
 * promo binder. With onlyUnowned, cards you already have every copy of (owned or proxied) are
 * left alone, since there's nothing to go find.
 */

const BOARD_SQL = `COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END)`;

function assertDeck(db, deckId, userId) {
  const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
  if (!deck) throw new Error('Deck not found');
}

/**
 * The deck's non-basic cards, each with the binder printing it has in every set
 * (`bySet`: set code -> { printing_id, rarity, image_url, collector_number }).
 */
function loadDeck(db, deckId, userId, { onlyUnowned = false, excludeCommander = false } = {}) {
  assertDeck(db, deckId, userId);
  let rows = db.prepare(`
    SELECT dc.id as deck_card_id, dc.printing_id as current_printing_id, dc.quantity,
           ${BOARD_SQL} as board_type,
           COALESCE(dc.owned_quantity, 0) as owned_quantity, COALESCE(dc.proxy_quantity, 0) as proxy_quantity,
           c.id as card_id, c.name as card_name,
           p.set_code as current_set_code, s.name as current_set_name
    FROM deck_cards dc
    JOIN printings p ON dc.printing_id = p.id
    JOIN cards c ON p.card_id = c.id
    LEFT JOIN sets s ON p.set_code = s.code
    WHERE dc.deck_id = ? AND c.type_line NOT LIKE '%Basic Land%'
  `).all(deckId);
  const totalCards = rows.length;

  if (onlyUnowned) {
    // Maybeboard rows hold no copies; count them as owned if your collection has the card.
    const inCollection = new Set(db.prepare(`
      SELECT DISTINCT p.card_id FROM owned_printings op JOIN printings p ON op.printing_id = p.id
      WHERE op.user_id = ? AND op.quantity > 0
    `).all(userId).map((r) => r.card_id));
    rows = rows.filter((r) => r.board_type === 'maybeboard'
      ? !inCollection.has(r.card_id)
      : r.owned_quantity + r.proxy_quantity < r.quantity);
  }

  const cards = rows.map((r) => ({ ...r, bySet: new Map() }));
  const sets = new Map();
  const ids = [...new Set(cards.map((c) => c.card_id))];
  const byCard = new Map();
  for (const c of cards) {
    if (!byCard.has(c.card_id)) byCard.set(c.card_id, []);
    byCard.get(c.card_id).push(c);
  }

  for (let i = 0; i < ids.length; i += 900) {
    const chunk = ids.slice(i, i + 900);
    const printings = db.prepare(`
      SELECT p.card_id, p.id as printing_id, p.set_code, p.rarity, p.image_url, p.collector_number,
             s.name as set_name, s.release_date, s.type as set_type, s.is_online_only
      FROM printings p JOIN sets s ON s.code = p.set_code
      WHERE p.card_id IN (${chunk.map(() => '?').join(',')})
      ORDER BY p.card_id, p.set_code, p.is_promo, p.is_full_art,
               CAST(p.collector_number AS INTEGER), p.collector_number, p.id
    `).all(...chunk);
    for (const p of printings) {
      const set = { code: p.set_code, type: p.set_type, is_online_only: p.is_online_only };
      if (!isBinderSet(set, { commander: !excludeCommander })) continue;
      if (!sets.has(p.set_code)) sets.set(p.set_code, { code: p.set_code, name: p.set_name, releaseDate: p.release_date, type: p.set_type });
      for (const c of byCard.get(p.card_id)) {
        if (!c.bySet.has(p.set_code)) c.bySet.set(p.set_code, p); // first is the plain printing
      }
    }
  }
  return { cards, sets, totalCards };
}

function cardInSet(card, setCode) {
  const p = card.bySet.get(setCode);
  return {
    deckCardId: card.deck_card_id,
    cardId: card.card_id,
    cardName: card.card_name,
    currentPrintingId: card.current_printing_id,
    currentSetCode: card.current_set_code,
    currentSetName: card.current_set_name,
    newPrintingId: p.printing_id,
    quantity: card.quantity,
    boardType: card.board_type,
    rarity: p.rarity,
    imageUrl: p.image_url,
    // Already this printing: nothing to change. Another printing in the same set still counts as
    // a change, since that's what binders hold.
    unchanged: card.current_printing_id === p.printing_id,
  };
}

function setResult(set, cards, considered, totalCards) {
  const list = cards.sort((a, b) => a.cardName.localeCompare(b.cardName));
  return {
    setCode: set.code,
    setName: set.name,
    releaseDate: set.releaseDate,
    cardCount: list.length,
    changeCount: list.filter((c) => !c.unchanged).length,
    considered,
    totalCards,
    percentage: considered ? Math.round((list.length / considered) * 100) : 0,
    cards: list,
  };
}

/**
 * The best single sets for the deck (most cards printed in them), plus a full plan: the fewest
 * binders that between them hold every card, with each card moved to its binder's printing.
 */
export function analyzeDeckPrintings(deckId, userId, topN = 5, excludeCommander = false, onlyUnowned = false) {
  const db = getDb();
  const { cards, sets, totalCards } = loadDeck(db, deckId, userId, { onlyUnowned, excludeCommander });
  const considered = cards.length;
  if (!considered) return { suggestions: [], plan: null, totalCards, considered, deckId };

  const bySet = new Map();
  for (const card of cards) {
    for (const code of card.bySet.keys()) {
      if (!bySet.has(code)) bySet.set(code, []);
      bySet.get(code).push(card);
    }
  }
  const suggestions = [...bySet]
    .sort(([a, x], [b, y]) => y.length - x.length || String(sets.get(b).releaseDate).localeCompare(String(sets.get(a).releaseDate)))
    .slice(0, topN)
    .map(([code, list], i) => ({ rank: i + 1, ...setResult(sets.get(code), list.map((c) => cardInSet(c, code)), considered, totalCards) }));

  const { binders, unplaced } = planBinders(cards, {
    setsOf: (c) => [...c.bySet.keys()],
    preferred: (c) => c.current_set_code,
    tieBreak: (code) => sets.get(code)?.releaseDate || '',
  });
  const plan = {
    binders: binders.map((b) => setResult(sets.get(b.code), b.items.map((c) => cardInSet(c, b.code)), considered, totalCards)),
    unplaced: unplaced.map((c) => ({ deckCardId: c.deck_card_id, cardName: c.card_name, currentSetCode: c.current_set_code, currentSetName: c.current_set_name, quantity: c.quantity })),
    considered,
    totalCards,
  };
  plan.changeCount = plan.binders.reduce((n, b) => n + b.changeCount, 0);

  return { suggestions, plan, totalCards, considered, deckId };
}

/**
 * Get optimization for a specific set chosen by the user
 */
export function analyzeSpecificSet(deckId, userId, setCode, onlyUnowned = false) {
  const db = getDb();
  const { cards, sets, totalCards } = loadDeck(db, deckId, userId, { onlyUnowned });
  const set = sets.get(setCode) || (() => {
    const s = db.prepare('SELECT code, name, release_date FROM sets WHERE code = ?').get(setCode);
    if (!s) throw new Error('Set not found');
    return { code: s.code, name: s.name, releaseDate: s.release_date };
  })();
  if (!cards.length) return null;
  const list = cards.filter((c) => c.bySet.has(setCode)).map((c) => cardInSet(c, setCode));
  return { ...setResult(set, list, cards.length, totalCards), deckId };
}

/**
 * Apply printing optimization to deck
 * Updates specified cards to use new printings
 */
export function applyPrintingOptimization(deckId, userId, changes) {
  const db = getDb();
  assertDeck(db, deckId, userId);

  const applyChanges = db.transaction(() => {
    // The new printing must be the same card, so a bad request can't swap cards in a deck.
    const updateStmt = db.prepare(`
      UPDATE deck_cards
      SET printing_id = ?
      WHERE id = ? AND deck_id = ? AND printing_id != ?
        AND (SELECT card_id FROM printings WHERE id = ?) = (SELECT card_id FROM printings WHERE id = deck_cards.printing_id)
    `);

    let updated = 0;
    for (const change of changes) {
      const result = updateStmt.run(change.newPrintingId, change.deckCardId, deckId, change.newPrintingId, change.newPrintingId);
      if (result.changes > 0) updated++;
    }
    return updated;
  });

  const updated = applyChanges();
  return {
    success: true,
    updated,
    message: `Updated ${updated} card${updated !== 1 ? 's' : ''} to new printings`
  };
}

/**
 * Every binder set holding at least one of the deck's cards, most cards first.
 */
export function getAvailableSets(deckId, userId, onlyUnowned = false) {
  const db = getDb();
  const { cards, sets } = loadDeck(db, deckId, userId, { onlyUnowned });
  const counts = new Map();
  for (const card of cards) {
    for (const code of card.bySet.keys()) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts]
    .map(([code, n]) => ({ code, name: sets.get(code).name, release_date: sets.get(code).releaseDate, type: sets.get(code).type, card_count: n }))
    .sort((a, b) => b.card_count - a.card_count || String(b.release_date).localeCompare(String(a.release_date)));
}

import { getDb } from '../db/index.js';

/**
 * Analyze deck and find optimal printing sets
 * Returns suggestions sorted by number of cards that can use each set
 */
export function analyzeDeckPrintings(deckId, userId, topN = 5, excludeCommander = false) {
  const db = getDb();

  // Verify deck ownership
  const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
  if (!deck) {
    throw new Error('Deck not found');
  }

  // Sets to always exclude (non-standard sets)
  const excludedSets = ['SLD', 'PRM', 'PLST'];

  // Get all cards in the deck with their current printings (excluding basic lands)
  const deckCards = db.prepare(`
    SELECT
      dc.id as deck_card_id,
      dc.printing_id as current_printing_id,
      dc.quantity,
      dc.board_type,
      c.id as card_id,
      c.name as card_name,
      c.type_line,
      p.set_code as current_set_code,
      s.name as current_set_name
    FROM deck_cards dc
    JOIN printings p ON dc.printing_id = p.id
    JOIN cards c ON p.card_id = c.id
    LEFT JOIN sets s ON p.set_code = s.code
    WHERE dc.deck_id = ?
    AND c.type_line NOT LIKE '%Basic Land%'
  `).all(deckId);

  if (deckCards.length === 0) {
    return { suggestions: [], totalCards: 0 };
  }

  // For each card, get all available printings
  const cardPrintingsMap = new Map();

  for (const deckCard of deckCards) {
    const allPrintings = db.prepare(`
      SELECT
        p.id as printing_id,
        p.set_code,
        s.name as set_name,
        s.release_date,
        p.rarity,
        p.image_url
      FROM printings p
      JOIN sets s ON p.set_code = s.code
      WHERE p.card_id = ?
      ORDER BY s.release_date ASC
    `).all(deckCard.card_id);

    cardPrintingsMap.set(deckCard.card_id, {
      deckCard,
      printings: allPrintings
    });
  }

  // Build a map of sets to cards available in each set
  // Use a nested map to ensure only ONE entry per unique card per set
  const setToCards = new Map();

  for (const [cardId, { deckCard, printings }] of cardPrintingsMap.entries()) {
    for (const printing of printings) {
      if (!setToCards.has(printing.set_code)) {
        setToCards.set(printing.set_code, {
          setCode: printing.set_code,
          setName: printing.set_name,
          releaseDate: printing.release_date,
          cards: [],
          cardIds: new Set() // Track which cards we've already added to this set
        });
      }

      const setData = setToCards.get(printing.set_code);

      // Only add this card if we haven't already added it for this set
      if (!setData.cardIds.has(cardId)) {
        setData.cardIds.add(cardId);
        setData.cards.push({
          deckCardId: deckCard.deck_card_id,
          cardId: deckCard.card_id,
          cardName: deckCard.card_name,
          currentPrintingId: deckCard.current_printing_id,
          currentSetCode: deckCard.current_set_code,
          currentSetName: deckCard.current_set_name,
          newPrintingId: printing.printing_id,
          quantity: deckCard.quantity,
          boardType: deckCard.board_type,
          rarity: printing.rarity,
          imageUrl: printing.image_url
        });
      }
    }
  }

  // Sort sets by number of cards available (descending) and filter
  const suggestions = Array.from(setToCards.values())
    .filter(set => {
      // Exclude banned sets
      if (excludedSets.includes(set.setCode)) {
        return false;
      }
      // Exclude commander sets if requested
      if (excludeCommander && set.setName.toLowerCase().includes('commander')) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.cards.length - a.cards.length)
    .slice(0, topN)
    .map((set, index) => ({
      rank: index + 1,
      setCode: set.setCode,
      setName: set.setName,
      releaseDate: set.releaseDate,
      cardCount: set.cards.length,
      percentage: Math.round((set.cards.length / deckCards.length) * 100),
      cards: set.cards.sort((a, b) => a.cardName.localeCompare(b.cardName))
    }));

  return {
    suggestions,
    totalCards: deckCards.length,
    deckId
  };
}

/**
 * Get optimization for a specific set chosen by the user
 */
export function analyzeSpecificSet(deckId, userId, setCode) {
  const db = getDb();

  // Verify deck ownership
  const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
  if (!deck) {
    throw new Error('Deck not found');
  }

  // Verify set exists
  const set = db.prepare('SELECT code, name, release_date FROM sets WHERE code = ?').get(setCode);
  if (!set) {
    throw new Error('Set not found');
  }

  // Get all cards in the deck (excluding basic lands)
  const deckCards = db.prepare(`
    SELECT
      dc.id as deck_card_id,
      dc.printing_id as current_printing_id,
      dc.quantity,
      dc.board_type,
      c.id as card_id,
      c.name as card_name,
      c.type_line,
      p.set_code as current_set_code,
      s.name as current_set_name
    FROM deck_cards dc
    JOIN printings p ON dc.printing_id = p.id
    JOIN cards c ON p.card_id = c.id
    LEFT JOIN sets s ON p.set_code = s.code
    WHERE dc.deck_id = ?
    AND c.type_line NOT LIKE '%Basic Land%'
  `).all(deckId);

  if (deckCards.length === 0) {
    return null;
  }

  // Find which cards have printings in the specified set
  const availableCards = [];

  for (const deckCard of deckCards) {
    const printing = db.prepare(`
      SELECT
        p.id as printing_id,
        p.rarity,
        p.image_url
      FROM printings p
      WHERE p.card_id = ? AND p.set_code = ?
      LIMIT 1
    `).get(deckCard.card_id, setCode);

    if (printing) {
      availableCards.push({
        deckCardId: deckCard.deck_card_id,
        cardId: deckCard.card_id,
        cardName: deckCard.card_name,
        currentPrintingId: deckCard.current_printing_id,
        currentSetCode: deckCard.current_set_code,
        currentSetName: deckCard.current_set_name,
        newPrintingId: printing.printing_id,
        quantity: deckCard.quantity,
        boardType: deckCard.board_type,
        rarity: printing.rarity,
        imageUrl: printing.image_url
      });
    }
  }

  return {
    setCode: set.code,
    setName: set.name,
    releaseDate: set.release_date,
    cardCount: availableCards.length,
    totalCards: deckCards.length,
    percentage: Math.round((availableCards.length / deckCards.length) * 100),
    cards: availableCards.sort((a, b) => a.cardName.localeCompare(b.cardName)),
    deckId
  };
}

/**
 * Apply printing optimization to deck
 * Updates specified cards to use new printings
 */
export function applyPrintingOptimization(deckId, userId, changes) {
  const db = getDb();

  // Verify deck ownership
  const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
  if (!deck) {
    throw new Error('Deck not found');
  }

  // Apply changes in a transaction
  const applyChanges = db.transaction(() => {
    const updateStmt = db.prepare(`
      UPDATE deck_cards
      SET printing_id = ?
      WHERE id = ? AND deck_id = ?
    `);

    let updated = 0;
    for (const change of changes) {
      const result = updateStmt.run(change.newPrintingId, change.deckCardId, deckId);
      if (result.changes > 0) {
        updated++;
      }
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
 * Get all available sets for the deck
 * Returns all unique sets that have at least one printing for cards in the deck
 */
export function getAvailableSets(deckId, userId) {
  const db = getDb();

  // Verify deck ownership
  const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
  if (!deck) {
    throw new Error('Deck not found');
  }

  // Get all unique sets that have printings for cards in this deck (excluding basic lands)
  const sets = db.prepare(`
    SELECT DISTINCT
      s.code,
      s.name,
      s.release_date,
      s.type,
      COUNT(DISTINCT p.card_id) as card_count
    FROM deck_cards dc
    JOIN printings current_p ON dc.printing_id = current_p.id
    JOIN cards c ON current_p.card_id = c.id
    JOIN printings p ON p.card_id = current_p.card_id
    JOIN sets s ON p.set_code = s.code
    WHERE dc.deck_id = ?
    AND c.type_line NOT LIKE '%Basic Land%'
    GROUP BY s.code
    ORDER BY card_count DESC, s.release_date DESC
  `).all(deckId);

  return sets;
}

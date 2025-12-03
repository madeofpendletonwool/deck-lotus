import db from '../db/connection.js';

/**
 * Get shopping list for selected decks
 * Returns cards needed (not owned) grouped by set
 */
export function getShoppingList(userId, deckIds) {
  if (!deckIds || deckIds.length === 0) {
    return {
      sets: [],
      totalCards: 0,
      totalDecks: 0,
    };
  }

  // Get all unique cards needed from selected decks that user doesn't own
  const placeholders = deckIds.map(() => '?').join(',');

  const query = `
    SELECT DISTINCT
      c.id as card_id,
      c.name,
      c.mana_cost,
      c.type_line,
      c.color_identity,
      p.id as printing_id,
      p.uuid as printing_uuid,
      p.set_code,
      p.collector_number,
      p.rarity,
      p.image_url,
      s.name as set_name,
      s.release_date,
      d.id as deck_id,
      d.name as deck_name,
      dc.quantity,
      (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) as price
    FROM deck_cards dc
    JOIN decks d ON dc.deck_id = d.id
    JOIN printings p ON dc.printing_id = p.id
    JOIN cards c ON p.card_id = c.id
    LEFT JOIN sets s ON p.set_code = s.code
    LEFT JOIN owned_cards oc ON oc.user_id = ? AND oc.card_id = c.id
    WHERE d.user_id = ?
      AND d.id IN (${placeholders})
      AND dc.is_sideboard = 0
      AND oc.id IS NULL
    ORDER BY s.name, p.collector_number, c.name
  `;

  const params = [userId, userId, ...deckIds];
  const cards = db.all(query, params);

  // Group cards by set
  const setMap = new Map();

  for (const card of cards) {
    const setCode = card.set_code;

    if (!setMap.has(setCode)) {
      setMap.set(setCode, {
        setCode,
        setName: card.set_name || setCode.toUpperCase(),
        releaseDate: card.release_date,
        cards: [],
      });
    }

    const set = setMap.get(setCode);

    // Check if this card already exists in this set
    let existingCard = set.cards.find(c => c.cardId === card.card_id && c.printingId === card.printing_id);

    if (existingCard) {
      // Add this deck to the card's deck list
      if (!existingCard.decks.find(d => d.deckId === card.deck_id)) {
        existingCard.decks.push({
          deckId: card.deck_id,
          deckName: card.deck_name,
          quantity: card.quantity,
        });
      }
    } else {
      // Add new card
      set.cards.push({
        cardId: card.card_id,
        printingId: card.printing_id,
        name: card.name,
        manaCost: card.mana_cost,
        typeLine: card.type_line,
        colorIdentity: card.color_identity,
        setCode: card.set_code,
        collectorNumber: card.collector_number,
        rarity: card.rarity,
        imageUrl: card.image_url,
        price: card.price,
        decks: [{
          deckId: card.deck_id,
          deckName: card.deck_name,
          quantity: card.quantity,
        }],
      });
    }
  }

  // Convert map to array and sort by set name
  const sets = Array.from(setMap.values()).sort((a, b) =>
    a.setName.localeCompare(b.setName)
  );

  // Calculate total cards needed
  const totalCards = sets.reduce((sum, set) => sum + set.cards.length, 0);

  return {
    sets,
    totalCards,
    totalDecks: deckIds.length,
  };
}

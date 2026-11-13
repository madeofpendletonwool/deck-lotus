import db from '../db/connection.js';

// SQL for a printing's prices, for queries that alias printings as p. The deck total, inventory,
// shopping and the printing picker all use these, so a printing has one price everywhere.
// Cardmarket is left out because its prices are in euros and everything here is shown in dollars.
const USD_PROVIDERS = `provider IN ('tcgplayer', 'cardkingdom', 'manapool')`;
const priceSql = (priceType) => `(SELECT price FROM prices
  WHERE printing_uuid = p.uuid AND price_type = '${priceType}' AND ${USD_PROVIDERS}
  ORDER BY CASE provider WHEN 'tcgplayer' THEN 0 WHEN 'cardkingdom' THEN 1 ELSE 2 END
  LIMIT 1)`;
export const NORMAL_PRICE_SQL = priceSql('normal');
export const FOIL_PRICE_SQL = priceSql('foil');
export const ETCHED_PRICE_SQL = priceSql('etched');

// A printing's value: its normal price, or for foil-only and etched-only printings, that finish.
export const PRINTING_PRICE_SQL = `COALESCE(${NORMAL_PRICE_SQL}, ${FOIL_PRICE_SQL}, ${ETCHED_PRICE_SQL})`;

// What one owned copy is worth, for queries that alias owned_printings as op and printings as p:
// the price for the copy's finish. A printing with no price for that finish (an etched copy
// that only has a foil price, or older data without foil prices) falls back to the closest one,
// and OWNED_PRICE_ESTIMATED_SQL says so. A nonfoil copy uses PRINTING_PRICE_SQL, which already
// covers foil-only printings.
export const OWNED_PRICE_SQL = `(CASE op.finish
  WHEN 'foil' THEN COALESCE(${FOIL_PRICE_SQL}, ${PRINTING_PRICE_SQL})
  WHEN 'etched' THEN COALESCE(${ETCHED_PRICE_SQL}, ${FOIL_PRICE_SQL}, ${PRINTING_PRICE_SQL})
  ELSE ${PRINTING_PRICE_SQL} END)`;
export const OWNED_PRICE_ESTIMATED_SQL = `(CASE op.finish
  WHEN 'foil' THEN ${FOIL_PRICE_SQL} IS NULL
  WHEN 'etched' THEN ${ETCHED_PRICE_SQL} IS NULL
  ELSE 0 END)`;

// ORDER BY for picking which printing a card gets when nobody chose one (queries alias printings
// as p): the cheapest one you could play in a real deck. Gold and silver borders and memorabilia
// sets are often cheapest but aren't legal, so they only win for cards with nothing else, like
// Un-cards. Unpriced paper comes next, and digital printings last.
const isNotTournamentPrintingSql = `(p.border_color IN ('gold', 'silver')
  OR (SELECT type FROM sets WHERE code = p.set_code) = 'memorabilia')`;
const isDigitalPrintingSql = `COALESCE((SELECT is_online_only FROM sets WHERE code = p.set_code), 0)`;
export const DEFAULT_PRINTING_ORDER_SQL = `
  CASE
    WHEN ${PRINTING_PRICE_SQL} IS NULL THEN 2 + ${isDigitalPrintingSql}
    WHEN ${isNotTournamentPrintingSql} THEN 1
    ELSE 0
  END,
  ${PRINTING_PRICE_SQL},
  p.set_code, p.collector_number, p.id`;

// Digital printings can't be bought, so they have no price. The card's cheapest paper price is
// a fair stand-in, and callers must show it as an estimate.
export const CHEAPEST_PRINTING_SQL = `(SELECT MIN(pr.price)
  FROM printings alt JOIN prices pr ON pr.printing_uuid = alt.uuid
  WHERE alt.card_id = p.card_id AND pr.${USD_PROVIDERS})`;

/**
 * Get prices for a printing by UUID
 */
export function getPrintingPrices(uuid) {
  const prices = db.all(
    `SELECT provider, price_type, price, updated_at
     FROM prices
     WHERE printing_uuid = ?
     ORDER BY provider, price_type`,
    [uuid]
  );

  // Format as object for easier access
  const formatted = {};
  for (const p of prices) {
    if (!formatted[p.provider]) {
      formatted[p.provider] = {};
    }
    formatted[p.provider][p.price_type] = p.price;
  }

  return formatted;
}

/**
 * Get deck total price
 */
export function getDeckPrice(deckId) {
  const cards = db.all(
    `SELECT
      dc.id as deck_card_id,
      c.name,
      p.image_url,
      dc.quantity,
      ${PRINTING_PRICE_SQL} as printing_price,
      ${CHEAPEST_PRINTING_SQL} as cheapest_price
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ?`,
    [deckId]
  );

  let total = 0;
  let unpricedCount = 0;
  let mostExpensive = null;
  const cardPrices = {};
  const estimatedCards = [];
  let estimatedCount = 0;

  for (const card of cards) {
    const price = card.printing_price ?? card.cheapest_price;
    cardPrices[card.deck_card_id] = price ?? 0;

    if (price == null) {
      unpricedCount += card.quantity;
      continue;
    }
    total += price * card.quantity;
    if (card.printing_price == null) {
      estimatedCards.push(card.deck_card_id);
      estimatedCount += card.quantity;
    }
    if (!mostExpensive || price > mostExpensive.price) {
      mostExpensive = { name: card.name, price, imageUrl: card.image_url };
    }
  }

  return {
    total,
    provider: 'market',
    currency: 'USD',
    mostExpensive,
    cardPrices,
    estimatedCards,
    estimatedCount,
    unpricedCount,
  };
}

/**
 * Get prices for multiple printings
 */
export function getBulkPrices(uuids) {
  if (!uuids || uuids.length === 0) return {};

  const placeholders = uuids.map(() => '?').join(',');
  const prices = db.all(
    `SELECT printing_uuid, provider, price_type, price
     FROM prices
     WHERE printing_uuid IN (${placeholders})`,
    uuids
  );

  // Group by UUID
  const grouped = {};
  for (const p of prices) {
    if (!grouped[p.printing_uuid]) {
      grouped[p.printing_uuid] = {};
    }
    if (!grouped[p.printing_uuid][p.provider]) {
      grouped[p.printing_uuid][p.provider] = {};
    }
    grouped[p.printing_uuid][p.provider][p.price_type] = p.price;
  }

  return grouped;
}

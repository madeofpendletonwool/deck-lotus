import db from '../db/connection.js';

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
  const result = db.get(
    `SELECT
      SUM(
        COALESCE(
          (SELECT price FROM prices
           WHERE printing_uuid = p.uuid
           AND provider = 'tcgplayer'
           AND price_type = 'normal'
           LIMIT 1),
          0
        ) * dc.quantity
      ) as total_price
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     WHERE dc.deck_id = ?`,
    [deckId]
  );

  return {
    total: result?.total_price || 0,
    provider: 'tcgplayer',
    currency: 'USD'
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

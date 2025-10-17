import db from '../db/connection.js';

/**
 * Get all sets
 */
export function getAllSets() {
  return db.all(
    `SELECT * FROM sets
     ORDER BY release_date DESC, name ASC`
  );
}

/**
 * Get set by code
 */
export function getSetByCode(code) {
  return db.get(
    `SELECT * FROM sets WHERE code = ?`,
    [code]
  );
}

/**
 * Get cards in a set
 */
export function getSetCards(setCode, limit = 100, offset = 0) {
  const cards = db.all(
    `SELECT DISTINCT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line,
            p.rarity, p.collector_number, p.image_url, p.uuid
     FROM cards c
     JOIN printings p ON p.card_id = c.id
     WHERE p.set_code = ?
     ORDER BY
       CAST(p.collector_number AS INTEGER) ASC,
       p.collector_number ASC
     LIMIT ? OFFSET ?`,
    [setCode, limit, offset]
  );

  const total = db.get(
    `SELECT COUNT(DISTINCT c.id) as total
     FROM cards c
     JOIN printings p ON p.card_id = c.id
     WHERE p.set_code = ?`,
    [setCode]
  );

  return {
    cards: cards.map(card => ({
      ...card,
      large_image_url: card.image_url ? card.image_url.replace('/normal/', '/large/') : null,
      art_crop_url: card.image_url ? card.image_url.replace('/normal/', '/art_crop/') : null
    })),
    total: total.total,
    page: Math.floor(offset / limit) + 1,
    totalPages: Math.ceil(total.total / limit),
    limit
  };
}

/**
 * Search sets by name
 */
export function searchSets(query) {
  return db.all(
    `SELECT * FROM sets
     WHERE name LIKE ? OR code LIKE ?
     ORDER BY release_date DESC
     LIMIT 20`,
    [`%${query}%`, `%${query}%`]
  );
}

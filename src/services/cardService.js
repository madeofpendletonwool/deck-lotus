import db from '../db/connection.js';

/**
 * Generate Scryfall CDN image URLs (no rate limits on *.scryfall.io domains)
 */
function generateImageUrls(uuid) {
  if (!uuid) return { image_url: null, large_image_url: null, art_crop_url: null };
  
  // Scryfall CDN URLs have no rate limits
  const baseUrl = `https://cards.scryfall.io`;
  const frontPath = `/front/${uuid[0]}/${uuid[1]}/${uuid}`;
  
  return {
    image_url: `${baseUrl}/normal${frontPath}.jpg`,
    large_image_url: `${baseUrl}/large${frontPath}.jpg`,
    art_crop_url: `${baseUrl}/art_crop${frontPath}.jpg`
  };
}

/**
 * Search cards by name (for autocomplete)
 */
export function searchCards(query, limit = 20) {
  const searchTerm = `%${query}%`;

  // Update the query to include image_url
  const cards = db.all(
    `SELECT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
            p.image_url,
            (SELECT p.uuid FROM printings p WHERE p.card_id = c.id LIMIT 1) as sample_uuid
     FROM cards c
     LEFT JOIN printings p ON p.card_id = c.id
     WHERE c.name LIKE ?
     ORDER BY
       CASE
         WHEN c.name LIKE ? THEN 0
         ELSE 1
       END,
       c.name
     LIMIT ?`,
    [searchTerm, `${query}%`, limit]
  );

  // Add image URLs from database
  return cards.map(card => ({
    ...card,
    image_url: card.image_url,
    large_image_url: card.image_url ? card.image_url.replace('/normal/', '/large/') : null,
    art_crop_url: card.image_url ? card.image_url.replace('/normal/', '/art_crop/') : null
  }));
}

/**
 * Get card by ID with all printings and prices
 */
export function getCardById(cardId) {
  const card = db.get(
    `SELECT * FROM cards WHERE id = ?`,
    [cardId]
  );

  if (!card) {
    return null;
  }

  // Get all printings for this card with prices
  const printings = db.all(
    `SELECT p.*,
            (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) as price_normal,
            (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'foil' LIMIT 1) as price_foil
     FROM printings p
     WHERE p.card_id = ?
     ORDER BY p.set_code, p.collector_number`,
    [cardId]
  );

  // Get rulings for the first printing (rulings are the same across all printings of a card)
  const rulings = printings.length > 0 ? db.all(
    `SELECT date, text
     FROM rulings
     WHERE uuid = ?
     ORDER BY date DESC`,
    [printings[0].uuid]
  ) : [];

  return {
    ...card,
    printings,
    rulings,
  };
}

/**
 * Get card by name
 */
export function getCardByName(name) {
  const card = db.get(
    `SELECT * FROM cards WHERE name = ?`,
    [name]
  );

  if (!card) {
    return null;
  }

  // Get all printings
  const printings = db.all(
    `SELECT * FROM printings WHERE card_id = ? ORDER BY set_code, collector_number`,
    [card.id]
  );

  return {
    ...card,
    printings,
  };
}

/**
 * Get printings for a card
 */
export function getCardPrintings(cardId) {
  const printings = db.all(
    `SELECT p.*, c.name as card_name
     FROM printings p
     JOIN cards c ON p.card_id = c.id
     WHERE p.card_id = ?
     ORDER BY p.set_code, p.collector_number`,
    [cardId]
  );

  // Add different image sizes to each printing
  return printings.map(printing => ({
    ...printing,
    large_image_url: printing.image_url ? printing.image_url.replace('/normal/', '/large/') : null,
    art_crop_url: printing.image_url ? printing.image_url.replace('/normal/', '/art_crop/') : null
  }));
}

/**
 * Get printing by UUID
 */
export function getPrintingByUuid(uuid) {
  return db.get(
    `SELECT p.*, c.*
     FROM printings p
     JOIN cards c ON p.card_id = c.id
     WHERE p.uuid = ?`,
    [uuid]
  );
}

/**
 * Browse cards with filters, sorting, and pagination
 */
export function browseCards(filters = {}) {
  const {
    name,
    colors = [],
    type,
    sort = 'random',
    limit = 50,
    offset = 0
  } = filters;

  let sql = `SELECT DISTINCT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
             (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url
             FROM cards c
             WHERE 1=1`;

  const params = [];

  // Name filter
  if (name && name.trim()) {
    sql += ` AND c.name LIKE ?`;
    params.push(`%${name}%`);
  }

  // Color filter - cards that contain ALL selected colors
  if (colors && colors.length > 0) {
    colors.forEach(color => {
      sql += ` AND (c.colors LIKE ? OR c.color_identity LIKE ?)`;
      params.push(`%${color}%`, `%${color}%`);
    });
  }

  // Type filter
  if (type && type.trim() && type !== 'all') {
    sql += ` AND c.type_line LIKE ?`;
    params.push(`%${type}%`);
  }

  // Get total count for pagination - build count query from scratch
  let countSql = `SELECT COUNT(DISTINCT c.id) as total FROM cards c WHERE 1=1`;
  const countParams = [];

  if (name && name.trim()) {
    countSql += ` AND c.name LIKE ?`;
    countParams.push(`%${name}%`);
  }

  if (colors && colors.length > 0) {
    colors.forEach(color => {
      countSql += ` AND (c.colors LIKE ? OR c.color_identity LIKE ?)`;
      countParams.push(`%${color}%`, `%${color}%`);
    });
  }

  if (type && type.trim() && type !== 'all') {
    countSql += ` AND c.type_line LIKE ?`;
    countParams.push(`%${type}%`);
  }

  const countResult = db.get(countSql, countParams);
  const total = countResult ? countResult.total : 0;

  // Sorting
  switch(sort) {
    case 'name':
      sql += ` ORDER BY c.name ASC`;
      break;
    case 'cmc':
      sql += ` ORDER BY c.cmc ASC, c.name ASC`;
      break;
    case 'color':
      sql += ` ORDER BY c.colors ASC, c.name ASC`;
      break;
    case 'random':
    default:
      sql += ` ORDER BY RANDOM()`;
      break;
  }

  // Pagination
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const cards = db.all(sql, params);

  // Add image URL variations
  const cardsWithImages = cards.map(card => ({
    ...card,
    large_image_url: card.image_url ? card.image_url.replace('/normal/', '/large/') : null,
    art_crop_url: card.image_url ? card.image_url.replace('/normal/', '/art_crop/') : null
  }));

  return {
    cards: cardsWithImages,
    total,
    page: Math.floor(offset / limit) + 1,
    totalPages: Math.ceil(total / limit),
    limit
  };
}

/**
 * Get random cards
 */
export function getRandomCards(count = 10) {
  return db.all(
    `SELECT c.*,
      (SELECT uuid FROM printings WHERE card_id = c.id LIMIT 1) as sample_uuid
     FROM cards c
     ORDER BY RANDOM()
     LIMIT ?`,
    [count]
  );
}

/**
 * Get card statistics
 */
export function getCardStats() {
  const stats = db.get(`
    SELECT
      (SELECT COUNT(*) FROM cards) as total_cards,
      (SELECT COUNT(*) FROM printings) as total_printings,
      (SELECT COUNT(DISTINCT set_code) FROM printings) as total_sets
  `);

  return stats;
}

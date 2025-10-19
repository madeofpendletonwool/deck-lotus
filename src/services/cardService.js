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
    sets = [],
    cmcMin = null,
    cmcMax = null,
    limit = 50,
    offset = 0
  } = filters;

  // Ensure colors and sets are arrays
  const colorsArray = Array.isArray(colors) ? colors : [];
  const setsArray = Array.isArray(sets) ? sets : [];

  console.log('Browse cards filters:', { name, colors: colorsArray, type, sort, sets: setsArray, cmcMin, cmcMax, limit, offset });

  // Need LEFT JOIN for price sorting
  const needsPriceJoin = sort === 'price';
  const needsSetJoin = setsArray && setsArray.length > 0;

  let sql = `SELECT DISTINCT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
             (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url`;

  if (needsPriceJoin) {
    sql += `,
             (SELECT pr.price FROM printings p2
              LEFT JOIN prices pr ON p2.uuid = pr.printing_uuid
              WHERE p2.card_id = c.id AND pr.provider = 'tcgplayer' AND pr.price_type = 'normal'
              ORDER BY pr.price DESC LIMIT 1) as max_price`;
  }

  sql += `
             FROM cards c`;

  if (needsSetJoin) {
    sql += ` LEFT JOIN printings p ON p.card_id = c.id`;
  }

  sql += `
             WHERE 1=1`;

  const params = [];

  // Name filter
  if (name && name.trim()) {
    sql += ` AND c.name LIKE ?`;
    params.push(`%${name}%`);
  }

  // Color filter - cards that contain ALL selected colors (based on actual colors, not color identity)
  if (colorsArray && colorsArray.length > 0) {
    // Check if colorless (C) is in the filter
    const hasColorless = colorsArray.includes('C');
    const actualColors = colorsArray.filter(c => c !== 'C');

    if (hasColorless && actualColors.length === 0) {
      // Only colorless selected - show cards with no colors
      sql += ` AND (c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else if (hasColorless && actualColors.length > 0) {
      // Colorless AND other colors - show cards matching colors OR colorless cards
      sql += ` AND (`;
      const colorConditions = [];
      actualColors.forEach(color => {
        colorConditions.push(`c.colors LIKE ?`);
        params.push(`%${color}%`);
      });
      sql += colorConditions.join(' AND ');
      sql += ` OR c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else {
      // Only actual colors selected
      actualColors.forEach(color => {
        sql += ` AND c.colors LIKE ?`;
        params.push(`%${color}%`);
      });
    }
  }

  // Type filter
  if (type && type.trim() && type !== 'all') {
    sql += ` AND c.type_line LIKE ?`;
    params.push(`%${type}%`);
  }

  // Set filter - cards that have printings in any of the selected sets
  if (setsArray && setsArray.length > 0) {
    const placeholders = setsArray.map(() => '?').join(',');
    sql += ` AND p.set_code IN (${placeholders})`;
    params.push(...setsArray);
  }

  // CMC filter
  if (cmcMin !== null && cmcMin !== undefined) {
    sql += ` AND c.cmc >= ?`;
    params.push(cmcMin);
  }

  if (cmcMax !== null && cmcMax !== undefined) {
    sql += ` AND c.cmc <= ?`;
    params.push(cmcMax);
  }

  // Get total count for pagination - build count query from scratch
  let countSql = `SELECT COUNT(DISTINCT c.id) as total FROM cards c`;

  if (needsSetJoin) {
    countSql += ` LEFT JOIN printings p ON p.card_id = c.id`;
  }

  countSql += ` WHERE 1=1`;
  const countParams = [];

  if (name && name.trim()) {
    countSql += ` AND c.name LIKE ?`;
    countParams.push(`%${name}%`);
  }

  if (colorsArray && colorsArray.length > 0) {
    const hasColorless = colorsArray.includes('C');
    const actualColors = colorsArray.filter(c => c !== 'C');

    if (hasColorless && actualColors.length === 0) {
      countSql += ` AND (c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else if (hasColorless && actualColors.length > 0) {
      countSql += ` AND (`;
      const colorConditions = [];
      actualColors.forEach(color => {
        colorConditions.push(`c.colors LIKE ?`);
        countParams.push(`%${color}%`);
      });
      countSql += colorConditions.join(' AND ');
      countSql += ` OR c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else {
      actualColors.forEach(color => {
        countSql += ` AND c.colors LIKE ?`;
        countParams.push(`%${color}%`);
      });
    }
  }

  if (type && type.trim() && type !== 'all') {
    countSql += ` AND c.type_line LIKE ?`;
    countParams.push(`%${type}%`);
  }

  if (setsArray && setsArray.length > 0) {
    const placeholders = setsArray.map(() => '?').join(',');
    countSql += ` AND p.set_code IN (${placeholders})`;
    countParams.push(...setsArray);
  }

  if (cmcMin !== null && cmcMin !== undefined) {
    countSql += ` AND c.cmc >= ?`;
    countParams.push(cmcMin);
  }

  if (cmcMax !== null && cmcMax !== undefined) {
    countSql += ` AND c.cmc <= ?`;
    countParams.push(cmcMax);
  }

  const countResult = db.get(countSql, countParams);
  const total = countResult ? countResult.total : 0;

  console.log('Count SQL:', countSql);
  console.log('Count Params:', countParams);
  console.log('Total cards found:', total);

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
    case 'price':
      sql += ` ORDER BY max_price DESC, c.name ASC`;
      break;
    case 'random':
    default:
      sql += ` ORDER BY RANDOM()`;
      break;
  }

  // Pagination
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  console.log('Main SQL:', sql);
  console.log('Main Params:', params);

  const cards = db.all(sql, params);
  console.log('Cards returned:', cards.length);

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

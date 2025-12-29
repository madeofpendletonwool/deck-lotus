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
 * Supports both English names and foreign language names
 */
export function searchCards(query, limit = 20) {
  const prefix = `${query}%`;

  // Try fast path using FTS5 if available (populated during import)
  const ftsQuery = query.replace(/"/g, '').trim();
  if (ftsQuery) {
    try {
      const ftsParam = `${ftsQuery}*`;
      const cards = db.all(
        `SELECT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
                (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url,
                (SELECT p.uuid FROM printings p WHERE p.card_id = c.id LIMIT 1) as sample_uuid,
                cs.foreign_names,
                CASE
                  WHEN c.name LIKE ? THEN 0
                  WHEN cs.foreign_names LIKE ? THEN 1
                  ELSE 2
                END as match_priority
         FROM card_search cs
         JOIN cards c ON c.id = cs.card_id
         WHERE cs MATCH ?
         ORDER BY match_priority, c.name
         LIMIT ?`,
        [prefix, prefix, ftsParam, limit]
      );

      return cards.map(card => ({
        ...card,
        image_url: card.image_url,
        large_image_url: card.image_url ? card.image_url.replace('/normal/', '/large/') : null,
        art_crop_url: card.image_url ? card.image_url.replace('/normal/', '/art_crop/') : null
      }));
    } catch (e) {
      // FTS unavailable or query failed; fall through to indexed prefix/exist strategy
      console.log('FTS search failed, falling back to indexed LIKE/EXISTS:', e.message);
    }
  }

  // Fallback: Use subqueries and EXISTS to avoid joining printings and foreign data
  // which can multiply rows and slow searches. Use prefix matching so
  // indexes on `cards.name` and `card_foreign_data(foreign_name)` can be used.
  const cards = db.all(
    `SELECT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
            (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url,
            (SELECT p.uuid FROM printings p WHERE p.card_id = c.id LIMIT 1) as sample_uuid,
            CASE
              WHEN c.name LIKE ? THEN 0
              WHEN EXISTS(SELECT 1 FROM card_foreign_data f WHERE f.card_name = c.name AND f.foreign_name LIKE ? LIMIT 1) THEN 1
              ELSE 2
            END as match_priority
     FROM cards c
     WHERE c.name LIKE ?
       OR EXISTS(SELECT 1 FROM card_foreign_data f WHERE f.card_name = c.name AND f.foreign_name LIKE ? LIMIT 1)
     ORDER BY match_priority, c.name
     LIMIT ?`,
    [prefix, prefix, prefix, prefix, limit]
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

  // Get all printings for this card with prices and set names
  // Order by lowest price first, so users see the cheapest available printing
  const printings = db.all(
    `SELECT p.*,
            s.name as set_name,
            (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) as price_normal,
            (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'foil' LIMIT 1) as price_foil
     FROM printings p
     LEFT JOIN sets s ON p.set_code = s.code
     WHERE p.card_id = ?
     ORDER BY
       CASE
         WHEN (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) IS NULL THEN 999999
         ELSE (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1)
       END ASC,
       p.set_code, p.collector_number`,
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

  // Get related cards
  const relatedCards = db.all(
    `SELECT related_name, relation_type
     FROM related_cards
     WHERE card_name = ?
     ORDER BY relation_type, related_name`,
    [card.name]
  );

  // Get foreign data
  const foreignData = db.all(
    `SELECT language, foreign_name, foreign_text, foreign_type, foreign_flavor_text
     FROM card_foreign_data
     WHERE card_name = ?
     ORDER BY language`,
    [card.name]
  );

  return {
    ...card,
    printings,
    rulings,
    relatedCards,
    foreignData,
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
    `SELECT p.*, c.name as card_name, s.name as set_name
     FROM printings p
     JOIN cards c ON p.card_id = c.id
     LEFT JOIN sets s ON p.set_code = s.code
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
    subtypes = [],
    cmcMin = null,
    cmcMax = null,
    onlyOwned = false,
    userId = null,
    limit = 50,
    offset = 0
  } = filters;

  // Ensure colors, sets, and subtypes are arrays
  const colorsArray = Array.isArray(colors) ? colors : [];
  const setsArray = Array.isArray(sets) ? sets : [];
  const subtypesArray = Array.isArray(subtypes) ? subtypes : [];

  console.log('Browse cards filters:', { name, colors: colorsArray, type, sort, sets: setsArray, subtypes: subtypesArray, cmcMin, cmcMax, limit, offset });

  // Need LEFT JOIN for price sorting
  const needsPriceJoin = sort === 'price';
  const needsSetJoin = setsArray && setsArray.length > 0;
  const needsOwnedJoin = onlyOwned && userId;

  let sql = `SELECT DISTINCT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
             (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url`;

  // Add owned status to query
  if (userId) {
    sql += `,
             (SELECT CASE WHEN oc.id IS NOT NULL THEN 1 ELSE 0 END FROM owned_cards oc WHERE oc.user_id = ? AND oc.card_id = c.id LIMIT 1) as is_owned`;
  }

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

  if (needsOwnedJoin) {
    sql += ` INNER JOIN owned_cards oc ON oc.card_id = c.id AND oc.user_id = ?`;
  }

  sql += `
             WHERE 1=1`;

  const params = [];

  // Add userId param if needed
  if (userId) {
    params.push(userId);
  }

  // Add it again for the owned join if needed
  if (needsOwnedJoin) {
    params.push(userId);
  }

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

  // Subtype filter - cards that have ANY of the selected subtypes
  if (subtypesArray && subtypesArray.length > 0) {
    sql += ` AND (`;
    const subtypeConditions = [];
    subtypesArray.forEach(subtype => {
      subtypeConditions.push(`c.subtypes LIKE ?`);
      params.push(`%${subtype}%`);
    });
    sql += subtypeConditions.join(' OR ');
    sql += `)`;
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

  if (needsOwnedJoin) {
    countSql += ` INNER JOIN owned_cards oc ON oc.card_id = c.id AND oc.user_id = ?`;
  }

  countSql += ` WHERE 1=1`;
  const countParams = [];

  // Add userId for owned join if needed
  if (needsOwnedJoin) {
    countParams.push(userId);
  }

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

  // Subtype filter for count query
  if (subtypesArray && subtypesArray.length > 0) {
    countSql += ` AND (`;
    const subtypeConditions = [];
    subtypesArray.forEach(subtype => {
      subtypeConditions.push(`c.subtypes LIKE ?`);
      countParams.push(`%${subtype}%`);
    });
    countSql += subtypeConditions.join(' OR ');
    countSql += `)`;
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

/**
 * Get all unique subtypes from cards
 */
export function getAllSubtypes() {
  // Get all non-null subtypes
  const cards = db.all(
    `SELECT DISTINCT subtypes FROM cards WHERE subtypes IS NOT NULL AND subtypes != ''`
  );

  // Parse comma-separated subtypes and collect unique ones
  const subtypesSet = new Set();

  cards.forEach(card => {
    if (card.subtypes) {
      const subtypesList = card.subtypes.split(',').map(s => s.trim()).filter(s => s);
      subtypesList.forEach(subtype => subtypesSet.add(subtype));
    }
  });

  // Convert to array and sort alphabetically
  const subtypes = Array.from(subtypesSet).sort((a, b) => a.localeCompare(b));

  return subtypes;
}

/**
 * Toggle card ownership for a user
 * This now manages owned_printings instead of owned_cards
 */
export function toggleCardOwnership(userId, cardId) {
  // Check if any printings are owned
  const ownedPrintings = db.all(
    `SELECT op.id, op.printing_id
     FROM owned_printings op
     JOIN printings p ON op.printing_id = p.id
     WHERE op.user_id = ? AND p.card_id = ?`,
    [userId, cardId]
  );

  if (ownedPrintings.length > 0) {
    // Remove all owned printings for this card
    db.run(
      `DELETE FROM owned_printings
       WHERE user_id = ? AND printing_id IN (
         SELECT p.id FROM printings p WHERE p.card_id = ?
       )`,
      [userId, cardId]
    );
    // Also remove from owned_cards
    db.run(
      `DELETE FROM owned_cards WHERE user_id = ? AND card_id = ?`,
      [userId, cardId]
    );
    return { owned: false, message: 'Card removed from collection' };
  } else {
    // Add the first printing with quantity 1
    const firstPrinting = db.get(
      `SELECT id FROM printings WHERE card_id = ? ORDER BY set_code, collector_number LIMIT 1`,
      [cardId]
    );

    if (firstPrinting) {
      db.run(
        `INSERT INTO owned_printings (user_id, printing_id, quantity) VALUES (?, ?, 1)`,
        [userId, firstPrinting.id]
      );
      // Also add to owned_cards for backward compatibility
      db.run(
        `INSERT INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
         ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = 1`,
        [userId, cardId]
      );
    }
    return { owned: true, message: 'Card added to collection' };
  }
}

/**
 * Get all owned cards for a user
 */
export function getUserOwnedCards(userId) {
  return db.all(
    `SELECT oc.*, c.name, c.mana_cost, c.type_line,
            (SELECT p.image_url FROM printings p WHERE p.card_id = c.id LIMIT 1) as image_url
     FROM owned_cards oc
     JOIN cards c ON oc.card_id = c.id
     WHERE oc.user_id = ?
     ORDER BY c.name ASC`,
    [userId]
  );
}

/**
 * Check if a card is owned by a user
 */
export function getCardOwnershipStatus(userId, cardId) {
  const owned = db.get(
    `SELECT id, quantity FROM owned_cards WHERE user_id = ? AND card_id = ?`,
    [userId, cardId]
  );

  return {
    owned: !!owned,
    quantity: owned ? owned.quantity : 0
  };
}

/**
 * Get owned printings for a specific card
 */
export function getCardOwnedPrintings(userId, cardId) {
  return db.all(
    `SELECT op.*, p.set_code, p.collector_number, p.rarity, p.image_url,
            s.name as set_name
     FROM owned_printings op
     JOIN printings p ON op.printing_id = p.id
     LEFT JOIN sets s ON p.set_code = s.code
     WHERE op.user_id = ? AND p.card_id = ?
     ORDER BY p.set_code, p.collector_number`,
    [userId, cardId]
  );
}

/**
 * Add or update owned printing quantity
 * Also syncs with owned_cards table
 */
export function setOwnedPrintingQuantity(userId, printingId, quantity) {
  // Get the card_id for this printing
  const printing = db.get(
    `SELECT card_id FROM printings WHERE id = ?`,
    [printingId]
  );

  if (!printing) {
    throw new Error('Printing not found');
  }

  const cardId = printing.card_id;

  if (quantity <= 0) {
    // Remove if quantity is 0 or less
    db.run(
      `DELETE FROM owned_printings WHERE user_id = ? AND printing_id = ?`,
      [userId, printingId]
    );

    // Check if any other printings of this card are still owned
    const otherPrintings = db.get(
      `SELECT COUNT(*) as count
       FROM owned_printings op
       JOIN printings p ON op.printing_id = p.id
       WHERE op.user_id = ? AND p.card_id = ?`,
      [userId, cardId]
    );

    if (otherPrintings.count === 0) {
      // No more printings owned, remove from owned_cards
      db.run(
        `DELETE FROM owned_cards WHERE user_id = ? AND card_id = ?`,
        [userId, cardId]
      );
    }

    return { success: true, message: 'Printing removed from collection' };
  }

  // Check if already exists
  const existing = db.get(
    `SELECT id FROM owned_printings WHERE user_id = ? AND printing_id = ?`,
    [userId, printingId]
  );

  if (existing) {
    // Update quantity
    db.run(
      `UPDATE owned_printings SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [quantity, existing.id]
    );
  } else {
    // Insert new
    db.run(
      `INSERT INTO owned_printings (user_id, printing_id, quantity) VALUES (?, ?, ?)`,
      [userId, printingId, quantity]
    );
  }

  // Ensure owned_cards is marked as owned
  db.run(
    `INSERT INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
     ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = 1`,
    [userId, cardId]
  );

  return { success: true, quantity };
}

/**
 * Get all decks that contain a specific card
 */
export function getCardDeckUsage(userId, cardId) {
  return db.all(
    `SELECT DISTINCT d.id, d.name, d.format,
            SUM(dc.quantity) as total_quantity,
            GROUP_CONCAT(CASE WHEN dc.is_sideboard = 1 THEN dc.quantity ELSE 0 END) as sideboard_quantities,
            GROUP_CONCAT(CASE WHEN dc.is_sideboard = 0 THEN dc.quantity ELSE 0 END) as mainboard_quantities
     FROM deck_cards dc
     JOIN decks d ON dc.deck_id = d.id
     JOIN printings p ON dc.printing_id = p.id
     WHERE d.user_id = ? AND p.card_id = ?
     GROUP BY d.id, d.name, d.format
     ORDER BY d.name ASC`,
    [userId, cardId]
  );
}

/**
 * Get comprehensive card ownership and usage info
 */
export function getCardOwnershipAndUsage(userId, cardId) {
  // Get owned printings
  const ownedPrintings = getCardOwnedPrintings(userId, cardId);

  // Get deck usage
  const deckUsage = getCardDeckUsage(userId, cardId);

  // Calculate total owned
  const totalOwned = ownedPrintings.reduce((sum, op) => sum + op.quantity, 0);

  // Calculate total in decks
  const totalInDecks = deckUsage.reduce((sum, deck) => sum + deck.total_quantity, 0);

  // Calculate available (not in decks)
  const available = totalOwned - totalInDecks;

  return {
    ownedPrintings,
    deckUsage,
    totalOwned,
    totalInDecks,
    available
  };
}

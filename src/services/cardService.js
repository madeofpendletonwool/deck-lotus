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

// better-sqlite3 runs on the main thread, so a slow query here stalls every other request.
// Each step below only touches a small index, which also keeps it fast on a cold disk cache.
const BY_POPULARITY = 'c.edhrec_rank IS NULL, c.edhrec_rank, c.name COLLATE NOCASE';
const statements = new Map();
function statement(sql) {
  if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
  return statements.get(sql);
}

/**
 * Search cards by name (autocomplete). Returns one row per card, best matches first:
 * an exact name, names starting with the query, then a word in the name starting with it, then
 * anywhere in the name, most played first within each. Foreign names (including the second part of split cards) are only checked when
 * English names leave room, so typing an English name never pays for them.
 */
export function searchCards(query, limit = 20, typeFilter = null) {
  const term = query.trim();
  if (!term) return [];

  const typeClause = typeFilter ? 'AND c.type_line LIKE ?' : '';
  const typeParam = typeFilter ? [`%${typeFilter}%`] : [];
  const ids = new Set();

  // Placeholders must run: name match, type filter, then anything in ORDER BY, then LIMIT.
  const collect = (sql, nameParam, orderParams = []) => {
    if (ids.size >= limit) return;
    // Ask for `limit` rows, since earlier steps may already hold some of these matches.
    for (const row of statement(sql).all(nameParam, ...typeParam, ...orderParams, limit)) {
      if (ids.size >= limit) break;
      ids.add(row.id);
    }
  };

  collect(
    `SELECT c.id FROM cards c WHERE c.name LIKE ? ${typeClause}
     ORDER BY c.name = ? COLLATE NOCASE DESC, ${BY_POPULARITY} LIMIT ?`,
    `${term}%`,
    [term]
  );
  collect(
    `SELECT c.id FROM cards c WHERE c.name LIKE ? ${typeClause}
     ORDER BY CASE WHEN c.name LIKE '% ' || ? || '%' THEN 0 ELSE 1 END, ${BY_POPULARITY} LIMIT ?`,
    `%${term}%`,
    [term]
  );
  collect(
    `SELECT DISTINCT c.id FROM card_foreign_data f JOIN cards c ON c.name = f.card_name
     WHERE f.foreign_name LIKE ? ${typeClause} LIMIT ?`,
    `${term}%`
  );
  collect(
    `SELECT DISTINCT c.id FROM card_foreign_data f JOIN cards c ON c.name = f.card_name
     WHERE f.foreign_name LIKE '%//%' AND f.foreign_name LIKE ? ${typeClause} LIMIT ?`,
    `%// ${term}%`
  );

  const cardQuery = statement(
    `SELECT id, name, mana_cost, cmc, colors, type_line, oracle_text FROM cards WHERE id = ?`
  );
  // Same order addCardToDeck picks from, so the thumbnail matches the printing that gets added.
  const printingQuery = statement(
    `SELECT p.id as printing_id, p.image_url, p.set_code, s.name as set_name, p.collector_number, p.rarity, p.uuid as sample_uuid
     FROM printings p LEFT JOIN sets s ON p.set_code = s.code
     WHERE p.card_id = ?
     ORDER BY p.set_code, p.collector_number
     LIMIT 1`
  );

  return [...ids].map((id) => ({
    ...cardQuery.get(id),
    ...withImageSizes(printingQuery.get(id)),
  }));
}

function withImageSizes(row) {
  const imageUrl = row?.image_url;
  return {
    ...row,
    small_image_url: imageUrl ? imageUrl.replace('/normal/', '/small/') : null,
    large_image_url: imageUrl ? imageUrl.replace('/normal/', '/large/') : null,
    art_crop_url: imageUrl ? imageUrl.replace('/normal/', '/art_crop/') : null,
  };
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

const RANDOM_MODULUS = 104729; // prime, so multiplying by a seed shuffles without collisions
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;
let priceCache = { byCard: null, loadedAt: 0 };

/**
 * Highest TCGplayer normal price per card. Aggregating every price takes around half a second,
 * so it is shared between requests. Prices only change on a sync, so an hour stale is fine.
 */
function getMaxPriceByCard() {
  if (priceCache.byCard && Date.now() - priceCache.loadedAt < PRICE_CACHE_TTL_MS) {
    return priceCache.byCard;
  }
  const rows = db.all(
    `SELECT p.card_id, MAX(pr.price) as price
     FROM printings p
     JOIN prices pr ON pr.printing_uuid = p.uuid AND pr.provider = 'tcgplayer' AND pr.price_type = 'normal'
     GROUP BY p.card_id`
  );
  priceCache = { byCard: new Map(rows.map((r) => [r.card_id, r.price])), loadedAt: Date.now() };
  return priceCache.byCard;
}

function buildBrowseFilter({ name, colors, type, rarities, sets, subtypes, cmcMin, cmcMax, onlyOwned, userId }) {
  const where = ['1=1'];
  const params = [];

  if (name && name.trim()) {
    where.push('c.name LIKE ?');
    params.push(`%${name.trim()}%`);
  }

  // Cards containing ALL selected colors. Colorless ("C") also lets colorless cards through.
  if (colors.length > 0) {
    const noColor = `c.colors IS NULL OR c.colors = '' OR c.colors = '[]'`;
    const actualColors = colors.filter((c) => c !== 'C');
    const allColors = actualColors.map(() => 'c.colors LIKE ?').join(' AND ');
    if (colors.includes('C')) {
      where.push(actualColors.length ? `((${allColors}) OR ${noColor})` : `(${noColor})`);
    } else {
      where.push(allColors);
    }
    params.push(...actualColors.map((c) => `%${c}%`));
  }

  if (type && type.trim() && type !== 'all') {
    where.push('c.type_line LIKE ?');
    params.push(`%${type}%`);
  }

  // A single printing has to satisfy both the rarity and the set filter.
  if (rarities.length > 0 || sets.length > 0) {
    const printingWhere = ['p.card_id = c.id'];
    if (rarities.length > 0) {
      printingWhere.push(`LOWER(p.rarity) IN (${rarities.map(() => '?').join(',')})`);
      params.push(...rarities.map((r) => r.toLowerCase()));
    }
    if (sets.length > 0) {
      printingWhere.push(`p.set_code IN (${sets.map(() => '?').join(',')})`);
      params.push(...sets);
    }
    where.push(`EXISTS (SELECT 1 FROM printings p WHERE ${printingWhere.join(' AND ')})`);
  }

  if (subtypes.length > 0) {
    where.push(`(${subtypes.map(() => 'c.subtypes LIKE ?').join(' OR ')})`);
    params.push(...subtypes.map((s) => `%${s}%`));
  }

  if (cmcMin !== null && cmcMin !== undefined) {
    where.push('c.cmc >= ?');
    params.push(cmcMin);
  }
  if (cmcMax !== null && cmcMax !== undefined) {
    where.push('c.cmc <= ?');
    params.push(cmcMax);
  }

  if (onlyOwned && userId) {
    where.push('EXISTS (SELECT 1 FROM owned_cards oc WHERE oc.card_id = c.id AND oc.user_id = ?)');
    params.push(userId);
  }

  return { whereSql: where.join(' AND '), params };
}

/**
 * Pick the ids for one page. Filtering and sorting only ever touch ids; images and ownership
 * are looked up afterwards for just those rows.
 */
function selectBrowsePage({ whereSql, params }, { sort, name, seed, limit, offset }) {
  if (sort === 'price') {
    const prices = getMaxPriceByCard();
    const matches = db.all(`SELECT c.id, c.name FROM cards c WHERE ${whereSql}`, params);
    matches.sort((a, b) => (prices.get(b.id) ?? -1) - (prices.get(a.id) ?? -1) || a.name.localeCompare(b.name));
    return matches.slice(offset, offset + limit).map((m) => m.id);
  }

  const orderParams = [];
  let orderSql;
  const term = name && name.trim();

  if (sort === 'name') {
    orderSql = 'c.name ASC';
  } else if (sort === 'cmc') {
    orderSql = 'c.cmc ASC, c.name ASC';
  } else if (sort === 'color') {
    orderSql = 'c.colors ASC, c.name ASC';
  } else if (term) {
    // Random order is no use when someone typed a name: show the closest matches first.
    orderSql = `CASE WHEN c.name LIKE ? THEN 0 WHEN c.name LIKE ? THEN 1 ELSE 2 END, c.name ASC`;
    orderParams.push(`${term}%`, `% ${term}%`);
  } else {
    // Seeded, so paging through "random" neither repeats nor skips cards.
    const multiplier = (Number.isInteger(seed) && seed > 0 ? seed : Math.floor(Math.random() * 90000) + 10007) % RANDOM_MODULUS;
    const hash = `((c.id * ${multiplier}) % ${RANDOM_MODULUS})`;
    orderSql = `(${hash} * ${hash}) % ${RANDOM_MODULUS}, c.id`;
  }

  return db
    .all(`SELECT c.id FROM cards c WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`, [...params, ...orderParams, limit, offset])
    .map((row) => row.id);
}

/**
 * Browse cards with filters, sorting, and pagination
 */
export function browseCards(filters = {}) {
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const {
    name,
    type,
    sort = 'random',
    seed = null,
    cmcMin = null,
    cmcMax = null,
    onlyOwned = false,
    userId = null,
    limit = 50,
    offset = 0,
  } = filters;

  const filter = buildBrowseFilter({
    name,
    type,
    colors: asArray(filters.colors),
    rarities: asArray(filters.rarities),
    sets: asArray(filters.sets),
    subtypes: asArray(filters.subtypes),
    cmcMin,
    cmcMax,
    onlyOwned,
    userId,
  });

  const { total } = db.get(`SELECT COUNT(*) as total FROM cards c WHERE ${filter.whereSql}`, filter.params);
  const ids = selectBrowsePage(filter, { sort, name, seed, limit, offset });

  const rows = db.all(
    `SELECT c.id, c.name, c.mana_cost, c.cmc, c.colors, c.type_line, c.oracle_text,
            (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url,
            EXISTS (SELECT 1 FROM owned_cards oc WHERE oc.user_id = ? AND oc.card_id = c.id) as is_owned
     FROM cards c
     WHERE c.id IN (SELECT value FROM json_each(?))`,
    [userId, JSON.stringify(ids)]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards = ids.map((id) => withImageSizes(byId.get(id)));

  return {
    cards,
    total,
    page: Math.floor(offset / limit) + 1,
    totalPages: Math.ceil(total / limit),
    limit,
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
            GROUP_CONCAT(CASE WHEN COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) = 'sideboard' THEN dc.quantity ELSE 0 END) as sideboard_quantities,
            GROUP_CONCAT(CASE WHEN COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) = 'mainboard' THEN dc.quantity ELSE 0 END) as mainboard_quantities
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

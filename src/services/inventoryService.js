import db from '../db/connection.js';

/**
 * Get all owned cards for inventory display
 * Returns cards with printing details, quantities, and deck usage stats
 */
export function getInventory(userId, filters = {}) {
  const {
    name,
    colors = [],
    type,
    sets = [],
    sort = 'name',
    availability = 'all', // 'all', 'available', 'in_decks'
    page = 1,
    limit = 50
  } = filters;

  const offset = (page - 1) * limit;
  const params = [userId];
  const countParams = [userId];

  // Base query - get all owned cards with their details
  let sql = `
    SELECT DISTINCT
      c.id as card_id,
      c.name,
      c.mana_cost,
      c.cmc,
      c.colors,
      c.type_line,
      c.oracle_text,
      (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url,
      (
        SELECT COALESCE(SUM(op.quantity), 0)
        FROM owned_printings op
        JOIN printings p ON op.printing_id = p.id
        WHERE op.user_id = ? AND p.card_id = c.id
      ) as total_owned,
      (
        SELECT COALESCE(SUM(dc.quantity), 0)
        FROM deck_cards dc
        JOIN printings p ON dc.printing_id = p.id
        JOIN decks d ON dc.deck_id = d.id
        WHERE d.user_id = ? AND p.card_id = c.id
      ) as total_in_decks
    FROM cards c
    WHERE c.id IN (
      SELECT DISTINCT p.card_id
      FROM owned_printings op
      JOIN printings p ON op.printing_id = p.id
      WHERE op.user_id = ?
    )
  `;

  // Add userId params for the subqueries
  params.push(userId, userId);

  // Count query
  let countSql = `
    SELECT COUNT(DISTINCT c.id) as total
    FROM cards c
    WHERE c.id IN (
      SELECT DISTINCT p.card_id
      FROM owned_printings op
      JOIN printings p ON op.printing_id = p.id
      WHERE op.user_id = ?
    )
  `;

  // Name filter
  if (name && name.trim()) {
    sql += ` AND c.name LIKE ?`;
    countSql += ` AND c.name LIKE ?`;
    params.push(`%${name}%`);
    countParams.push(`%${name}%`);
  }

  // Color filter
  const colorsArray = Array.isArray(colors) ? colors : [];
  if (colorsArray.length > 0) {
    const hasColorless = colorsArray.includes('C');
    const actualColors = colorsArray.filter(c => c !== 'C');

    if (hasColorless && actualColors.length === 0) {
      sql += ` AND (c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
      countSql += ` AND (c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else if (hasColorless && actualColors.length > 0) {
      sql += ` AND (`;
      countSql += ` AND (`;
      const colorConditions = [];
      actualColors.forEach(color => {
        colorConditions.push(`c.colors LIKE ?`);
        params.push(`%${color}%`);
        countParams.push(`%${color}%`);
      });
      sql += colorConditions.join(' AND ');
      countSql += colorConditions.join(' AND ');
      sql += ` OR c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
      countSql += ` OR c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    } else {
      actualColors.forEach(color => {
        sql += ` AND c.colors LIKE ?`;
        countSql += ` AND c.colors LIKE ?`;
        params.push(`%${color}%`);
        countParams.push(`%${color}%`);
      });
    }
  }

  // Type filter
  if (type && type.trim() && type !== 'all') {
    sql += ` AND c.type_line LIKE ?`;
    countSql += ` AND c.type_line LIKE ?`;
    params.push(`%${type}%`);
    countParams.push(`%${type}%`);
  }

  // Set filter - cards that have owned printings in the selected sets
  const setsArray = Array.isArray(sets) ? sets : [];
  if (setsArray.length > 0) {
    const placeholders = setsArray.map(() => '?').join(',');
    sql += ` AND c.id IN (
      SELECT DISTINCT p2.card_id
      FROM owned_printings op2
      JOIN printings p2 ON op2.printing_id = p2.id
      WHERE op2.user_id = ? AND p2.set_code IN (${placeholders})
    )`;
    countSql += ` AND c.id IN (
      SELECT DISTINCT p2.card_id
      FROM owned_printings op2
      JOIN printings p2 ON op2.printing_id = p2.id
      WHERE op2.user_id = ? AND p2.set_code IN (${placeholders})
    )`;
    params.push(userId, ...setsArray);
    countParams.push(userId, ...setsArray);
  }

  // Get total count
  const countResult = db.get(countSql, countParams);
  const total = countResult ? countResult.total : 0;

  // Sorting
  switch (sort) {
    case 'name':
      sql += ` ORDER BY c.name ASC`;
      break;
    case 'cmc':
      sql += ` ORDER BY c.cmc ASC, c.name ASC`;
      break;
    case 'color':
      sql += ` ORDER BY c.colors ASC, c.name ASC`;
      break;
    case 'quantity':
      sql += ` ORDER BY total_owned DESC, c.name ASC`;
      break;
    case 'type':
      sql += ` ORDER BY c.type_line ASC, c.name ASC`;
      break;
    default:
      sql += ` ORDER BY c.name ASC`;
  }

  // Pagination
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const cards = db.all(sql, params);

  // Filter by availability after fetching (since it involves calculated fields)
  let filteredCards = cards;
  if (availability === 'available') {
    filteredCards = cards.filter(card => (card.total_owned - card.total_in_decks) > 0);
  } else if (availability === 'in_decks') {
    filteredCards = cards.filter(card => card.total_in_decks > 0);
  }

  // Get printings for each card
  const cardsWithPrintings = filteredCards.map(card => {
    const printings = db.all(`
      SELECT
        op.id as owned_printing_id,
        op.quantity,
        p.id as printing_id,
        p.set_code,
        p.collector_number,
        p.rarity,
        p.image_url,
        s.name as set_name,
        (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) as price
      FROM owned_printings op
      JOIN printings p ON op.printing_id = p.id
      LEFT JOIN sets s ON p.set_code = s.code
      WHERE op.user_id = ? AND p.card_id = ?
      ORDER BY p.set_code, p.collector_number
    `, [userId, card.card_id]);

    return {
      ...card,
      available: card.total_owned - card.total_in_decks,
      printings
    };
  });

  return {
    cards: cardsWithPrintings,
    pagination: {
      page,
      totalPages: Math.ceil(total / limit),
      totalCards: total,
      limit
    }
  };
}

/**
 * Get inventory statistics
 */
export function getInventoryStats(userId) {
  // Total unique cards owned
  const uniqueCards = db.get(`
    SELECT COUNT(DISTINCT p.card_id) as count
    FROM owned_printings op
    JOIN printings p ON op.printing_id = p.id
    WHERE op.user_id = ?
  `, [userId]);

  // Total copies owned
  const totalCopies = db.get(`
    SELECT COALESCE(SUM(quantity), 0) as count
    FROM owned_printings
    WHERE user_id = ?
  `, [userId]);

  // Total in decks
  const inDecks = db.get(`
    SELECT COALESCE(SUM(dc.quantity), 0) as count
    FROM deck_cards dc
    JOIN decks d ON dc.deck_id = d.id
    WHERE d.user_id = ?
  `, [userId]);

  // Estimated total value
  const estimatedValue = db.get(`
    SELECT COALESCE(SUM(
      op.quantity * COALESCE(
        (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1),
        0
      )
    ), 0) as total
    FROM owned_printings op
    JOIN printings p ON op.printing_id = p.id
    WHERE op.user_id = ?
  `, [userId]);

  const totalOwned = totalCopies?.count || 0;
  const totalInDecks = inDecks?.count || 0;

  return {
    uniqueCards: uniqueCards?.count || 0,
    totalCopies: totalOwned,
    inDecks: totalInDecks,
    available: totalOwned - totalInDecks,
    estimatedValue: estimatedValue?.total || 0
  };
}

/**
 * Search cards for quick-add to inventory
 * Returns cards with their ownership status
 */
export function searchCardsForInventoryAdd(userId, query, limit = 10) {
  if (!query || query.length < 2) {
    return [];
  }

  const searchTerm = `%${query}%`;

  const cards = db.all(`
    SELECT
      c.id as card_id,
      c.name,
      c.mana_cost,
      c.type_line,
      (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1) as image_url,
      (SELECT p.id FROM printings p WHERE p.card_id = c.id ORDER BY
        CASE WHEN (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) IS NULL THEN 999999
        ELSE (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) END ASC
        LIMIT 1) as cheapest_printing_id,
      (
        SELECT COALESCE(SUM(op.quantity), 0)
        FROM owned_printings op
        JOIN printings p ON op.printing_id = p.id
        WHERE op.user_id = ? AND p.card_id = c.id
      ) as total_owned
    FROM cards c
    WHERE c.name LIKE ?
    ORDER BY
      CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END,
      c.name
    LIMIT ?
  `, [userId, searchTerm, `${query}%`, limit]);

  return cards;
}

/**
 * Bulk add cards to inventory
 * Accepts array of items: { cardName, setCode (optional), quantity }
 */
export function bulkAddToInventory(userId, items) {
  const results = {
    added: 0,
    failed: 0,
    errors: []
  };

  for (const item of items) {
    try {
      const { cardName, setCode, quantity = 1 } = item;

      if (!cardName) {
        results.failed++;
        results.errors.push({ cardName, error: 'Card name is required' });
        continue;
      }

      // Find the card
      const card = db.get(`SELECT id FROM cards WHERE name = ?`, [cardName]);

      if (!card) {
        // Try fuzzy match
        const fuzzyCard = db.get(
          `SELECT id FROM cards WHERE name LIKE ? LIMIT 1`,
          [`%${cardName}%`]
        );

        if (!fuzzyCard) {
          results.failed++;
          results.errors.push({ cardName, error: 'Card not found' });
          continue;
        }

        card.id = fuzzyCard.id;
      }

      // Find the printing
      let printing;
      if (setCode) {
        printing = db.get(
          `SELECT id FROM printings WHERE card_id = ? AND set_code = ? LIMIT 1`,
          [card.id, setCode.toLowerCase()]
        );
      }

      if (!printing) {
        // Get cheapest printing
        printing = db.get(`
          SELECT p.id
          FROM printings p
          WHERE p.card_id = ?
          ORDER BY
            CASE WHEN (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) IS NULL THEN 999999
            ELSE (SELECT price FROM prices WHERE printing_uuid = p.uuid AND provider = 'tcgplayer' AND price_type = 'normal' LIMIT 1) END ASC
          LIMIT 1
        `, [card.id]);
      }

      if (!printing) {
        results.failed++;
        results.errors.push({ cardName, setCode, error: 'Printing not found' });
        continue;
      }

      // Add or update owned_printings
      const existing = db.get(
        `SELECT id, quantity FROM owned_printings WHERE user_id = ? AND printing_id = ?`,
        [userId, printing.id]
      );

      if (existing) {
        db.run(
          `UPDATE owned_printings SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [quantity, existing.id]
        );
      } else {
        db.run(
          `INSERT INTO owned_printings (user_id, printing_id, quantity) VALUES (?, ?, ?)`,
          [userId, printing.id, quantity]
        );
      }

      // Update owned_cards for backward compatibility
      db.run(
        `INSERT INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
         ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = 1`,
        [userId, card.id]
      );

      results.added += quantity;
    } catch (error) {
      results.failed++;
      results.errors.push({ cardName: item.cardName, error: error.message });
    }
  }

  return results;
}

/**
 * Get sets that the user owns cards from (for filtering)
 */
export function getOwnedSets(userId) {
  return db.all(`
    SELECT DISTINCT s.code, s.name, s.release_date,
      (SELECT COUNT(*) FROM owned_printings op2
       JOIN printings p2 ON op2.printing_id = p2.id
       WHERE op2.user_id = ? AND p2.set_code = s.code) as owned_count
    FROM sets s
    WHERE s.code IN (
      SELECT DISTINCT p.set_code
      FROM owned_printings op
      JOIN printings p ON op.printing_id = p.id
      WHERE op.user_id = ?
    )
    ORDER BY s.release_date DESC, s.name
  `, [userId, userId]);
}

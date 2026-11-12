import db from '../db/connection.js';
import { OWNED_PRICE_SQL, OWNED_PRICE_ESTIMATED_SQL, DEFAULT_PRINTING_ORDER_SQL } from './pricingService.js';
import { parseFinish } from './cardService.js';

const INVENTORY_SORTS = {
  name: 'c.name ASC',
  cmc: 'c.cmc ASC, c.name ASC',
  color: 'c.colors ASC, c.name ASC',
  quantity: 'pc.total_owned DESC, c.name ASC',
  type: 'c.type_line ASC, c.name ASC',
  value: 'pc.total_value DESC, c.name ASC',
};

const FINISH_FILTERS = {
  foil: "o.finish <> 'nonfoil'", // foil or etched
  nonfoil: "o.finish = 'nonfoil'",
};

/**
 * Get all owned cards for inventory display, one entry per card with its owned
 * printings, quantities, value and deck usage.
 *
 * Filters: name, colors (W/U/B/R/G, C for colorless; a card must have every color
 * picked), type (type line contains), sets (set codes), finish ('all' | 'foil' |
 * 'nonfoil'), availability ('all' | 'available' | 'in_decks'). Set and finish are
 * about your copies: with both, a card needs a copy that matches both.
 * Sorts: name, cmc, color, quantity, type, value.
 */
export function getInventory(userId, filters = {}) {
  const {
    name,
    colors = [],
    type,
    sets = [],
    finish = 'all',
    sort = 'name',
    availability = 'all',
    page = 1,
    limit = 50
  } = filters;

  const safeLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
  const safePage = Math.max(Number.isInteger(page) ? page : 1, 1);

  // owned: each of the user's owned rows with what it's worth in its finish.
  // per_card and in_decks roll those up per card, so every filter and sort below
  // works on whole-collection numbers rather than on the current page.
  const ctes = `
    WITH owned AS (
      SELECT p.card_id, p.id AS printing_id, p.set_code, p.image_url, op.quantity, op.finish,
             ${OWNED_PRICE_SQL} AS price
      FROM owned_printings op
      JOIN printings p ON op.printing_id = p.id
      WHERE op.user_id = ?
    ),
    per_card AS (
      SELECT card_id, SUM(quantity) AS total_owned, SUM(quantity * COALESCE(price, 0)) AS total_value
      FROM owned
      GROUP BY card_id
    ),
    in_decks AS (
      SELECT p.card_id, SUM(dc.quantity) AS total_in_decks
      FROM deck_cards dc
      JOIN decks d ON dc.deck_id = d.id
      JOIN printings p ON dc.printing_id = p.id
      WHERE d.user_id = ?
      GROUP BY p.card_id
    )`;
  const params = [userId, userId];

  const where = [];
  if (name && name.trim()) {
    where.push('c.name LIKE ?');
    params.push(`%${name.trim()}%`);
  }

  const colorsArray = (Array.isArray(colors) ? colors : []).filter(c => /^[WUBRGC]$/.test(c));
  if (colorsArray.length > 0) {
    const colorless = `(c.colors IS NULL OR c.colors = '' OR c.colors = '[]')`;
    const actual = colorsArray.filter(c => c !== 'C');
    const hasAll = actual.map(() => 'c.colors LIKE ?').join(' AND ');
    params.push(...actual.map(color => `%${color}%`));
    if (colorsArray.includes('C')) {
      where.push(actual.length ? `((${hasAll}) OR ${colorless})` : colorless);
    } else {
      where.push(`(${hasAll})`);
    }
  }

  if (type && type.trim() && type !== 'all') {
    where.push('c.type_line LIKE ?');
    params.push(`%${type.trim()}%`);
  }

  const setsArray = Array.isArray(sets) ? sets.filter(Boolean) : [];
  const copyConditions = [];
  if (setsArray.length > 0) {
    copyConditions.push(`o.set_code IN (${setsArray.map(() => '?').join(',')})`);
    params.push(...setsArray);
  }
  if (FINISH_FILTERS[finish]) copyConditions.push(FINISH_FILTERS[finish]);
  if (copyConditions.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM owned o WHERE o.card_id = c.id AND ${copyConditions.join(' AND ')})`);
  }

  if (availability === 'available') {
    where.push('pc.total_owned > COALESCE(idk.total_in_decks, 0)');
  } else if (availability === 'in_decks') {
    where.push('COALESCE(idk.total_in_decks, 0) > 0');
  }

  const from = `
    FROM per_card pc
    JOIN cards c ON c.id = pc.card_id
    LEFT JOIN in_decks idk ON idk.card_id = c.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

  const total = db.get(`${ctes} SELECT COUNT(*) AS total ${from}`, params)?.total || 0;

  // The thumbnail is the printing you own the most copies of, not just any printing
  const cards = db.all(`${ctes}
    SELECT
      c.id AS card_id,
      c.name,
      c.mana_cost,
      c.cmc,
      c.colors,
      c.type_line,
      c.oracle_text,
      COALESCE(
        (SELECT o.image_url FROM owned o WHERE o.card_id = c.id AND o.image_url IS NOT NULL
          ORDER BY o.quantity DESC, o.printing_id LIMIT 1),
        (SELECT p.image_url FROM printings p WHERE p.card_id = c.id AND p.image_url IS NOT NULL LIMIT 1)
      ) AS image_url,
      pc.total_owned,
      ROUND(pc.total_value, 2) AS total_value,
      COALESCE(idk.total_in_decks, 0) AS total_in_decks
    ${from}
    ORDER BY ${INVENTORY_SORTS[sort] || INVENTORY_SORTS.name}
    LIMIT ? OFFSET ?
  `, [...params, safeLimit, (safePage - 1) * safeLimit]);

  const printingsFor = db.prepare(`
    SELECT
      op.id as owned_printing_id,
      op.quantity,
      op.finish,
      p.id as printing_id,
      p.set_code,
      p.collector_number,
      p.rarity,
      p.image_url,
      s.name as set_name,
      ${OWNED_PRICE_SQL} as price,
      ${OWNED_PRICE_ESTIMATED_SQL} as price_estimated
    FROM owned_printings op
    JOIN printings p ON op.printing_id = p.id
    LEFT JOIN sets s ON p.set_code = s.code
    WHERE op.user_id = ? AND p.card_id = ?
    ORDER BY p.set_code, p.collector_number, op.finish DESC
  `);

  return {
    cards: cards.map(card => ({
      ...card,
      available: card.total_owned - card.total_in_decks,
      printings: printingsFor.all(userId, card.card_id).map(p => ({ ...p, price_estimated: !!p.price_estimated }))
    })),
    pagination: {
      page: safePage,
      totalPages: Math.ceil(total / safeLimit),
      totalCards: total,
      limit: safeLimit
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

  // Estimated total value, each copy at the price for its finish
  const estimatedValue = db.get(`
    SELECT COALESCE(SUM(op.quantity * COALESCE(${OWNED_PRICE_SQL}, 0)), 0) as total
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
      (SELECT p.id FROM printings p WHERE p.card_id = c.id ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
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
 * Accepts array of items: { cardName, setCode (optional), quantity, finish (optional) }
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
      const finish = parseFinish(item.finish);

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
        // Get the default printing
        printing = db.get(`
          SELECT p.id
          FROM printings p
          WHERE p.card_id = ?
          ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
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
        `SELECT id, quantity FROM owned_printings WHERE user_id = ? AND printing_id = ? AND finish = ?`,
        [userId, printing.id, finish]
      );

      if (existing) {
        db.run(
          `UPDATE owned_printings SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [quantity, existing.id]
        );
      } else {
        db.run(
          `INSERT INTO owned_printings (user_id, printing_id, quantity, finish) VALUES (?, ?, ?, ?)`,
          [userId, printing.id, quantity, finish]
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

const MAX_SCAN_BATCH = 2000;

/**
 * Add a batch of cards scanned on the phone. Items are
 * { scryfallId, finish, quantity }: the scanner identifies exact printings by
 * Scryfall id, so there's no name or set guessing here.
 *
 * The phone retries a batch until it gets an answer. A batch id it has
 * already sent returns the stored result instead of adding the cards again.
 * The whole batch is one transaction: it lands completely or not at all.
 */
export function addScannedBatch(userId, batchId, items) {
  if (typeof batchId !== 'string' || batchId.length < 8 || batchId.length > 64) {
    throw Object.assign(new Error('batchId is required (8-64 characters)'), { statusCode: 400 });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_SCAN_BATCH) {
    throw Object.assign(new Error(`items must be a non-empty array of at most ${MAX_SCAN_BATCH}`), { statusCode: 400 });
  }

  return db.transaction(() => {
    const previous = db.get(
      'SELECT result FROM inventory_scan_batches WHERE user_id = ? AND batch_id = ?',
      [userId, batchId]
    );
    if (previous) return { ...JSON.parse(previous.result), duplicate: true };

    const result = { added: 0, failed: [] };
    // A double-faced card has a printings row per face, both with the same
    // Scryfall id; the lowest id is the one the rest of the app treats as the card.
    const findPrinting = db.prepare('SELECT MIN(id) AS id, card_id FROM printings WHERE scryfall_id = ?');
    const upsert = db.prepare(`
      INSERT INTO owned_printings (user_id, printing_id, quantity, finish) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, printing_id, finish)
      DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
    `);
    const markOwned = db.prepare(`
      INSERT INTO owned_cards (user_id, card_id, quantity) VALUES (?, ?, 1)
      ON CONFLICT(user_id, card_id) DO UPDATE SET quantity = 1
    `);

    for (const item of items) {
      const scryfallId = item?.scryfallId;
      const quantity = Number.isInteger(item?.quantity) ? item.quantity : 1;
      let finish;
      try {
        finish = parseFinish(item?.finish);
      } catch (e) {
        result.failed.push({ scryfallId, error: e.message });
        continue;
      }
      if (typeof scryfallId !== 'string' || quantity < 1) {
        result.failed.push({ scryfallId, error: 'scryfallId and a positive quantity are required' });
        continue;
      }
      const printing = findPrinting.get(scryfallId);
      if (!printing?.id) {
        // The phone's card index can be newer than this server's card data.
        result.failed.push({ scryfallId, error: 'Printing not on this server yet (update card data)' });
        continue;
      }
      upsert.run(userId, printing.id, quantity, finish);
      markOwned.run(userId, printing.card_id);
      result.added += quantity;
    }

    db.run(
      'INSERT INTO inventory_scan_batches (user_id, batch_id, result) VALUES (?, ?, ?)',
      [userId, batchId, JSON.stringify(result)]
    );
    return result;
  });
}

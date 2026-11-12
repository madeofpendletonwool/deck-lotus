import db from '../db/connection.js';
import crypto from 'crypto';
import { validateDeck, FORMATS, isCubeFormat, DEFAULT_CUBE_SETTINGS, parsePointsList } from '../../shared/formats.js';
import { getSettings } from './settingsService.js';

const RARITY_RANK_SQL = `CASE rarity WHEN 'common' THEN 0 WHEN 'uncommon' THEN 1 WHEN 'rare' THEN 2 WHEN 'mythic' THEN 3 ELSE 4 END`;

/** Deck settings are stored as JSON text; hand back an object either way. */
function parseSettings(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Clean a settings object from a request: plain JSON values only, and a size cap. */
function serializeSettings(settings) {
  if (settings === undefined) return undefined;
  if (settings === null) return null;
  if (typeof settings !== 'object' || Array.isArray(settings)) throw Object.assign(new Error('settings must be an object'), { statusCode: 400 });
  const text = JSON.stringify(settings);
  if (text.length > 10000) throw Object.assign(new Error('settings are too large'), { statusCode: 400 });
  return text;
}

/** Tags arrive as an array of strings; store a de-duplicated, trimmed JSON array (or NULL). */
function serializeTags(tags) {
  if (tags === undefined) return undefined;
  if (tags === null) return null;
  if (!Array.isArray(tags)) throw Object.assign(new Error('tags must be an array'), { statusCode: 400 });
  const clean = [...new Set(tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
  return clean.length ? JSON.stringify(clean) : null;
}

const COLOR_CATEGORY_IDS = new Set(['W', 'U', 'B', 'R', 'G', 'M', 'H', 'C', 'L']);

// ---- Cube history ----

function logChange(deckId, action, cardName, quantity, boardType = 'mainboard') {
  if (!cardName || !quantity) return;
  db.run(
    `INSERT INTO deck_changes (deck_id, action, card_name, quantity, board_type) VALUES (?, ?, ?, ?, ?)`,
    [deckId, action, cardName, quantity, boardType || 'mainboard']
  );
}

function deckCardInfo(deckId, deckCardId) {
  return db.get(
    `SELECT dc.id, dc.quantity, COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) as board_type, c.name
     FROM deck_cards dc JOIN printings p ON dc.printing_id = p.id JOIN cards c ON p.card_id = c.id
     WHERE dc.id = ? AND dc.deck_id = ?`,
    [deckCardId, deckId]
  );
}

function ownedDeck(deckId, userId) {
  const deck = db.get(`SELECT id, format FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) throw new Error('Deck not found or access denied');
  return deck;
}

/**
 * Get all decks for a user
 */
export function getUserDecks(userId) {
  const decks = db.all(
    `SELECT d.*,
      (SELECT COALESCE(SUM(quantity), 0) FROM deck_cards WHERE deck_id = d.id AND (board_type = 'mainboard' OR (board_type IS NULL AND is_sideboard = 0))) as mainboard_count,
      (SELECT COALESCE(SUM(quantity), 0) FROM deck_cards WHERE deck_id = d.id AND (board_type = 'sideboard' OR (board_type IS NULL AND is_sideboard = 1))) as sideboard_count,
      (SELECT COALESCE(SUM(quantity), 0) FROM deck_cards WHERE deck_id = d.id AND board_type = 'maybeboard') as maybeboard_count
     FROM decks d
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );

  // Cover image: the commander if there is one, otherwise the highest mana value creature.
  // Stable on purpose, so a deck's tile doesn't change every time the page loads.
  return decks.map(deck => {
    const randomCard = db.get(
      `SELECT p.image_url, p.uuid
       FROM deck_cards dc
       JOIN printings p ON dc.printing_id = p.id
       JOIN cards c ON p.card_id = c.id
       WHERE dc.deck_id = ? AND (dc.board_type = 'mainboard' OR (dc.board_type IS NULL AND dc.is_sideboard = 0)) AND p.image_url IS NOT NULL
       ORDER BY
         dc.is_commander DESC,
         CASE WHEN c.type_line LIKE '%Creature%' THEN 0 ELSE 1 END,
         c.cmc DESC,
         c.name
       LIMIT 1`,
      [deck.id]
    );

    return {
      ...deck,
      preview_image: randomCard?.image_url || null
    };
  });
}

/**
 * Get deck by ID (only if owned by user)
 */
export function getDeckById(deckId, userId) {
  const deck = db.get(
    `SELECT * FROM decks WHERE id = ? AND user_id = ?`,
    [deckId, userId]
  );

  if (!deck) {
    return null;
  }

  // Get all cards in deck with full details
  const cards = db.all(
    `SELECT
      dc.id as deck_card_id,
      dc.quantity,
      dc.is_sideboard,
      COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) as board_type,
      dc.is_commander,
      p.id as printing_id,
      p.card_id,
      p.set_code,
      p.collector_number,
      p.rarity,
      p.artist,
      p.image_url,
      p.uuid,
      s.name as set_name,
      c.name,
      c.mana_cost,
      c.cmc,
      c.colors,
      c.color_identity,
      c.type_line,
      c.oracle_text,
      c.power,
      c.toughness,
      c.loyalty,
      c.layout,
      c.edhrec_rank,
      c.leadership_skills,
      dc.tags,
      dc.color_category,
      dc.notes,
      (SELECT CASE WHEN oc.id IS NOT NULL THEN 1 ELSE 0 END FROM owned_cards oc WHERE oc.user_id = ? AND oc.card_id = c.id LIMIT 1) as is_owned,
      (SELECT SUM(op.quantity) FROM owned_printings op JOIN printings op_p ON op.printing_id = op_p.id WHERE op.user_id = ? AND op_p.card_id = c.id) as owned_quantity
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     LEFT JOIN sets s ON p.set_code = s.code
     WHERE dc.deck_id = ?
     ORDER BY
       CASE board_type
         WHEN 'mainboard' THEN 0
         WHEN 'sideboard' THEN 1
         WHEN 'maybeboard' THEN 2
         ELSE 3
       END,
       c.cmc, c.name`,
    [userId, userId, deckId]
  );

  return {
    ...deck,
    settings: parseSettings(deck.settings),
    cards,
  };
}

/**
 * Create a new deck
 */
export function createDeck(userId, name, format, description, settings = undefined) {
  // A new cube starts with the default draft settings so its tools work straight away
  const initial = settings ?? (isCubeFormat(format) ? { ...DEFAULT_CUBE_SETTINGS } : undefined);
  const result = db.run(
    `INSERT INTO decks (user_id, name, format, description, settings) VALUES (?, ?, ?, ?, ?)`,
    [userId, name, format || null, description || null, serializeSettings(initial) ?? null]
  );

  return {
    id: result.lastInsertRowid,
    user_id: userId,
    name,
    format,
    description,
    settings: initial || {},
  };
}

/**
 * Update deck
 */
export function updateDeck(deckId, userId, updates) {
  const { name, format, description, settings } = updates;

  // Check if deck belongs to user
  const deck = db.get(
    `SELECT id FROM decks WHERE id = ? AND user_id = ?`,
    [deckId, userId]
  );

  if (!deck) {
    throw new Error('Deck not found or access denied');
  }

  const fields = [];
  const params = [];

  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name);
  }
  if (format !== undefined) {
    fields.push('format = ?');
    params.push(format);
  }
  if (description !== undefined) {
    fields.push('description = ?');
    params.push(description);
  }
  if (settings !== undefined) {
    fields.push('settings = ?');
    params.push(serializeSettings(settings));
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');

  if (fields.length === 1) {
    // Only updated_at, no changes
    return getDeckById(deckId, userId);
  }

  params.push(deckId, userId);

  db.run(
    `UPDATE decks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    params
  );

  return getDeckById(deckId, userId);
}

/**
 * Delete deck
 */
export function deleteDeck(deckId, userId) {
  const result = db.run(
    `DELETE FROM decks WHERE id = ? AND user_id = ?`,
    [deckId, userId]
  );

  return result.changes > 0;
}

/**
 * Add card to deck
 */
export function addCardToDeck(deckId, userId, printingId, quantity = 1, isSideboard = false, isCommander = false, boardType = null) {
  const deck = ownedDeck(deckId, userId);

  // Determine board type
  const finalBoardType = boardType || (isSideboard ? 'sideboard' : 'mainboard');

  // Check if card already exists in deck
  const existing = db.get(
    `SELECT id, quantity FROM deck_cards
     WHERE deck_id = ? AND printing_id = ? AND board_type = ?`,
    [deckId, printingId, finalBoardType]
  );

  if (existing) {
    // Update quantity
    db.run(
      `UPDATE deck_cards SET quantity = quantity + ?, is_commander = ?
       WHERE id = ?`,
      [quantity, isCommander ? 1 : 0, existing.id]
    );
  } else {
    // Insert new
    db.run(
      `INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, board_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [deckId, printingId, quantity, isSideboard ? 1 : 0, isCommander ? 1 : 0, finalBoardType]
    );
  }

  if (isCubeFormat(deck.format)) {
    const card = db.get(`SELECT c.name FROM printings p JOIN cards c ON p.card_id = c.id WHERE p.id = ?`, [printingId]);
    logChange(deckId, 'add', card?.name, quantity, finalBoardType);
  }

  // Update deck timestamp
  db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);

  return getDeckById(deckId, userId);
}

export const DECK_BOARDS = ['mainboard', 'sideboard', 'maybeboard'];

/**
 * Add scanned copies of a printing to a deck, inside the caller's transaction. `deck` is
 * { id, format } and already checked to be the user's.
 *
 * A deck holds a printing once per is_sideboard value, and the mainboard and maybeboard share
 * is_sideboard = 0. So when the printing is already on the other one of those two boards, the
 * copies join that row. A card scanned into the mainboard that was sitting in the maybeboard
 * moves up to the mainboard, which is what putting a physical card in a deck means.
 * Returns the board the copies ended up on.
 */
export function addScannedPrintingToDeck(deck, printingId, quantity, board = 'mainboard') {
  const isSideboard = board === 'sideboard' ? 1 : 0;
  const row = db.get(
    `SELECT id, COALESCE(board_type, CASE WHEN is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) AS board_type
     FROM deck_cards WHERE deck_id = ? AND printing_id = ? AND is_sideboard = ?`,
    [deck.id, printingId, isSideboard]
  );
  let landed = board;
  if (!row) {
    db.run(
      `INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, board_type) VALUES (?, ?, ?, ?, ?)`,
      [deck.id, printingId, quantity, isSideboard, board]
    );
  } else if (row.board_type === board || (row.board_type === 'maybeboard' && board === 'mainboard')) {
    db.run(`UPDATE deck_cards SET quantity = quantity + ?, board_type = ? WHERE id = ?`, [quantity, board, row.id]);
  } else {
    // Asked for the maybeboard, but the printing is already in the mainboard: add it there
    db.run(`UPDATE deck_cards SET quantity = quantity + ? WHERE id = ?`, [quantity, row.id]);
    landed = row.board_type;
  }
  if (isCubeFormat(deck.format)) {
    const card = db.get(`SELECT c.name FROM printings p JOIN cards c ON p.card_id = c.id WHERE p.id = ?`, [printingId]);
    logChange(deck.id, 'add', card?.name, quantity, landed);
  }
  return landed;
}

/**
 * A deck can only hold a printing once per is_sideboard value. When a row is switched to a printing
 * another row already uses, combine the two so the copies aren't lost.
 * Returns true if the rows were merged, false if the row can simply take the new printing.
 */
function mergeIntoExistingPrinting(deckId, deckCardId, printingId) {
  const row = db.get(
    `SELECT id, quantity, is_sideboard, is_commander, board_type FROM deck_cards WHERE id = ? AND deck_id = ?`,
    [deckCardId, deckId]
  );
  if (!row) return false;

  const other = db.get(
    `SELECT id, board_type FROM deck_cards
     WHERE deck_id = ? AND printing_id = ? AND is_sideboard = ? AND id != ?`,
    [deckId, printingId, row.is_sideboard, row.id]
  );
  if (!other) return false;

  // The mainboard and maybeboard share is_sideboard = 0, so the constraint stops them holding the
  // same printing. Merging would silently move copies between boards, so refuse instead.
  if (other.board_type !== row.board_type) {
    const error = new Error(`That printing is already in your ${other.board_type}`);
    error.statusCode = 409;
    throw error;
  }

  db.transaction(() => {
    db.run(
      `UPDATE deck_cards SET quantity = quantity + ?, is_commander = MAX(is_commander, ?) WHERE id = ?`,
      [row.quantity, row.is_commander, other.id]
    );
    db.run(`DELETE FROM deck_cards WHERE id = ?`, [row.id]);
  });
  return true;
}

/**
 * Update card quantity in deck
 */
export function updateDeckCard(deckId, userId, deckCardId, updates) {
  const deck = ownedDeck(deckId, userId);
  const { quantity, isSideboard, isCommander, printingId, boardType, tags, colorCategory, notes } = updates;
  const before = isCubeFormat(deck.format) ? deckCardInfo(deckId, deckCardId) : null;

  const fields = [];
  const params = [];

  if (quantity !== undefined) {
    if (quantity <= 0) {
      // Remove card if quantity is 0 or less
      return removeCardFromDeck(deckId, userId, deckCardId);
    }
    fields.push('quantity = ?');
    params.push(quantity);
  }
  if (boardType !== undefined) {
    fields.push('board_type = ?');
    params.push(boardType);
    // Update is_sideboard for backward compatibility
    fields.push('is_sideboard = ?');
    params.push(boardType === 'sideboard' ? 1 : 0);
  } else if (isSideboard !== undefined) {
    // Backward compatibility
    fields.push('is_sideboard = ?');
    params.push(isSideboard ? 1 : 0);
    fields.push('board_type = ?');
    params.push(isSideboard ? 'sideboard' : 'mainboard');
  }
  if (isCommander !== undefined) {
    fields.push('is_commander = ?');
    params.push(isCommander ? 1 : 0);
  }
  if (tags !== undefined) {
    fields.push('tags = ?');
    params.push(serializeTags(tags));
  }
  if (colorCategory !== undefined) {
    fields.push('color_category = ?');
    params.push(COLOR_CATEGORY_IDS.has(colorCategory) ? colorCategory : null);
  }
  if (notes !== undefined) {
    fields.push('notes = ?');
    params.push(notes ? String(notes).slice(0, 1000) : null);
  }
  if (printingId !== undefined) {
    if (mergeIntoExistingPrinting(deckId, deckCardId, printingId)) {
      db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
      return getDeckById(deckId, userId);
    }
    fields.push('printing_id = ?');
    params.push(printingId);
  }

  if (fields.length === 0) {
    return getDeckById(deckId, userId);
  }

  params.push(deckCardId, deckId);

  db.run(
    `UPDATE deck_cards SET ${fields.join(', ')}
     WHERE id = ? AND deck_id = ?`,
    params
  );

  if (before) logRowChange(deckId, before, deckCardInfo(deckId, deckCardId));

  // Update deck timestamp
  db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);

  return getDeckById(deckId, userId);
}

/** Record what a row edit changed: copies added or removed, or a move between boards. */
function logRowChange(deckId, before, after) {
  if (!after) {
    logChange(deckId, 'remove', before.name, before.quantity, before.board_type);
    return;
  }
  if (before.board_type !== after.board_type) {
    logChange(deckId, 'remove', before.name, before.quantity, before.board_type);
    logChange(deckId, 'add', after.name, after.quantity, after.board_type);
  } else if (after.quantity !== before.quantity) {
    const diff = after.quantity - before.quantity;
    logChange(deckId, diff > 0 ? 'add' : 'remove', after.name, Math.abs(diff), after.board_type);
  }
}

/**
 * Change many cards at once: add or remove tags, set a color category, move boards or remove.
 * Used by the cube editor's multi-select.
 */
export function bulkUpdateDeckCards(deckId, userId, deckCardIds, changes = {}) {
  const deck = ownedDeck(deckId, userId);
  if (!Array.isArray(deckCardIds) || deckCardIds.length === 0) return getDeckById(deckId, userId);
  if (deckCardIds.length > 2000) throw Object.assign(new Error('Too many cards at once'), { statusCode: 400 });
  const { addTags = [], removeTags = [], colorCategory, boardType, remove } = changes;
  const cube = isCubeFormat(deck.format);

  db.transaction(() => {
    for (const id of deckCardIds) {
      const row = db.get(`SELECT id, tags FROM deck_cards WHERE id = ? AND deck_id = ?`, [id, deckId]);
      if (!row) continue;
      const before = cube ? deckCardInfo(deckId, id) : null;

      if (remove) {
        if (before) logChange(deckId, 'remove', before.name, before.quantity, before.board_type);
        db.run(`DELETE FROM deck_cards WHERE id = ?`, [id]);
        continue;
      }

      if (addTags.length || removeTags.length) {
        let tags = [];
        try { tags = JSON.parse(row.tags || '[]'); } catch { tags = []; }
        const drop = new Set(removeTags.map((t) => String(t).toLowerCase()));
        tags = tags.filter((t) => !drop.has(String(t).toLowerCase()));
        for (const t of addTags) if (!tags.some((x) => x.toLowerCase() === String(t).toLowerCase())) tags.push(t);
        db.run(`UPDATE deck_cards SET tags = ? WHERE id = ?`, [serializeTags(tags), id]);
      }
      if (colorCategory !== undefined) {
        db.run(`UPDATE deck_cards SET color_category = ? WHERE id = ?`, [COLOR_CATEGORY_IDS.has(colorCategory) ? colorCategory : null, id]);
      }
      if (boardType && ['mainboard', 'sideboard', 'maybeboard'].includes(boardType)) {
        try {
          db.run(`UPDATE deck_cards SET board_type = ?, is_sideboard = ? WHERE id = ?`, [boardType, boardType === 'sideboard' ? 1 : 0, id]);
        } catch (error) {
          // The same printing is already on the other board (see mergeIntoExistingPrinting); leave this one
          if (!/UNIQUE/.test(error.message)) throw error;
        }
        if (before) logRowChange(deckId, before, deckCardInfo(deckId, id));
      }
    }
    db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);
  });

  return getDeckById(deckId, userId);
}

/**
 * A deck's change history, newest first, grouped into days for display.
 */
export function getDeckHistory(deckId, userId, limit = 500) {
  ownedDeck(deckId, userId);
  return db.all(
    `SELECT action, card_name, quantity, board_type, created_at FROM deck_changes
     WHERE deck_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [deckId, Math.min(Number(limit) || 500, 5000)]
  );
}

/**
 * Remove card from deck
 */
export function removeCardFromDeck(deckId, userId, deckCardId) {
  const deck = ownedDeck(deckId, userId);
  if (isCubeFormat(deck.format)) {
    const before = deckCardInfo(deckId, deckCardId);
    if (before) logChange(deckId, 'remove', before.name, before.quantity, before.board_type);
  }

  db.run(
    `DELETE FROM deck_cards WHERE id = ? AND deck_id = ?`,
    [deckCardId, deckId]
  );

  // Update deck timestamp
  db.run(`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [deckId]);

  return getDeckById(deckId, userId);
}

/**
 * Get deck statistics
 */
export function getDeckStats(deckId, userId) {
  const deck = getDeckById(deckId, userId);

  if (!deck) {
    return null;
  }

  // Calculate mana curve
  const manaCurve = db.all(
    `SELECT
      CAST(c.cmc AS INTEGER) as cmc,
      COUNT(*) as count,
      SUM(dc.quantity) as total_cards
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ? AND (dc.board_type = 'mainboard' OR (dc.board_type IS NULL AND dc.is_sideboard = 0))
     GROUP BY CAST(c.cmc AS INTEGER)
     ORDER BY cmc`,
    [deckId]
  );

  // Calculate color distribution
  const colorDistribution = db.all(
    `SELECT
      c.colors,
      COUNT(*) as count,
      SUM(dc.quantity) as total_cards
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ? AND (dc.board_type = 'mainboard' OR (dc.board_type IS NULL AND dc.is_sideboard = 0))
     GROUP BY c.colors`,
    [deckId]
  );

  // Calculate type distribution
  const typeDistribution = db.all(
    `SELECT
      CASE
        WHEN c.type_line LIKE '%Creature%' THEN 'Creature'
        WHEN c.type_line LIKE '%Instant%' THEN 'Instant'
        WHEN c.type_line LIKE '%Sorcery%' THEN 'Sorcery'
        WHEN c.type_line LIKE '%Enchantment%' THEN 'Enchantment'
        WHEN c.type_line LIKE '%Artifact%' THEN 'Artifact'
        WHEN c.type_line LIKE '%Planeswalker%' THEN 'Planeswalker'
        WHEN c.type_line LIKE '%Land%' THEN 'Land'
        ELSE 'Other'
      END as type,
      COUNT(*) as count,
      SUM(dc.quantity) as total_cards
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ? AND (dc.board_type = 'mainboard' OR (dc.board_type IS NULL AND dc.is_sideboard = 0))
     GROUP BY type`,
    [deckId]
  );

  return {
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
    },
    manaCurve,
    colorDistribution,
    typeDistribution,
  };
}

/**
 * Create a share link for a deck
 */
export function createDeckShare(deckId, userId) {
  // Verify deck ownership
  const deck = db.get(
    `SELECT id FROM decks WHERE id = ? AND user_id = ?`,
    [deckId, userId]
  );

  if (!deck) {
    throw new Error('Deck not found or access denied');
  }

  // Check if share already exists
  const existingShare = db.get(
    `SELECT share_token FROM deck_shares WHERE deck_id = ? AND user_id = ? AND is_active = 1`,
    [deckId, userId]
  );

  if (existingShare) {
    return existingShare.share_token;
  }

  // Generate unique share token
  const shareToken = crypto.randomBytes(16).toString('hex');

  db.run(
    `INSERT INTO deck_shares (deck_id, user_id, share_token)
     VALUES (?, ?, ?)`,
    [deckId, userId, shareToken]
  );

  return shareToken;
}

/**
 * Get deck by share token (public access, no authentication required)
 */
export function getDeckByShareToken(shareToken) {
  // Get share info
  const share = db.get(
    `SELECT ds.deck_id, ds.is_active, ds.expires_at, d.user_id
     FROM deck_shares ds
     JOIN decks d ON ds.deck_id = d.id
     WHERE ds.share_token = ?`,
    [shareToken]
  );

  if (!share) {
    return null;
  }

  // Check if share is active
  if (!share.is_active) {
    return null;
  }

  // Check if share is expired
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }

  // Get deck with cards (similar to getDeckById but without user ownership check)
  const deck = db.get(
    `SELECT id, name, format, description, settings, created_at, updated_at FROM decks WHERE id = ?`,
    [share.deck_id]
  );

  if (!deck) {
    return null;
  }

  // Get all cards in deck with full details
  const cards = db.all(
    `SELECT
      dc.id as deck_card_id,
      dc.quantity,
      dc.is_sideboard,
      COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) as board_type,
      dc.is_commander,
      p.id as printing_id,
      p.card_id,
      p.set_code,
      p.collector_number,
      p.rarity,
      p.artist,
      p.image_url,
      p.uuid,
      s.name as set_name,
      c.name,
      c.mana_cost,
      c.cmc,
      c.colors,
      c.color_identity,
      c.type_line,
      c.oracle_text,
      c.power,
      c.toughness,
      c.loyalty,
      c.layout,
      c.edhrec_rank,
      dc.tags,
      dc.color_category,
      dc.notes
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     LEFT JOIN sets s ON p.set_code = s.code
     WHERE dc.deck_id = ?
       AND COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) != 'maybeboard'
     ORDER BY dc.is_sideboard, c.cmc, c.name`,
    [share.deck_id]
  );

  return {
    ...deck,
    settings: parseSettings(deck.settings),
    cards,
    is_shared: true,
  };
}

/**
 * Render a shared deck as "quantity name" lines, commander first. Multi-face names follow what
 * MPC Autofill can find: names printed on one side are joined, so "Fire // Ice" becomes
 * "Fire Ice", and anything else uses its front name. Mirrors mpcName in the client's deckExport.js.
 */
export function formatSharedDeckAsText(deck) {
  const oneSidedLayouts = new Set(['split', 'aftermath', 'flip']);
  const totals = new Map();

  const ordered = [...deck.cards].sort((a, b) => (b.is_commander || 0) - (a.is_commander || 0));
  for (const card of ordered) {
    const name = oneSidedLayouts.has(card.layout) ? card.name.replaceAll(' // ', ' ') : card.name.split(' // ')[0];
    totals.set(name, (totals.get(name) || 0) + card.quantity);
  }

  return [...totals].map(([name, quantity]) => `${quantity} ${name}`).join('\n');
}

/**
 * Delete/deactivate a deck share
 */
export function deleteDeckShare(deckId, userId) {
  const result = db.run(
    `UPDATE deck_shares SET is_active = 0
     WHERE deck_id = ? AND user_id = ?`,
    [deckId, userId]
  );

  return result.changes > 0;
}

/**
 * Import a shared deck to user's collection
 */
export function importSharedDeck(shareToken, userId) {
  // Get the shared deck
  const sharedDeck = getDeckByShareToken(shareToken);

  if (!sharedDeck) {
    throw new Error('Shared deck not found or no longer available');
  }

  // Create new deck for the user
  // A teammate deck belongs to the original owner, so it doesn't carry over
  const { teammateDeckId, ...settings } = sharedDeck.settings || {};
  const newDeck = createDeck(
    userId,
    `${sharedDeck.name} (imported)`,
    sharedDeck.format,
    sharedDeck.description,
    Object.keys(settings).length ? settings : undefined
  );

  // Copy all cards to the new deck
  for (const card of sharedDeck.cards) {
    db.run(
      `INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, board_type, tags, color_category, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newDeck.id, card.printing_id, card.quantity, card.is_sideboard, card.is_commander, card.board_type, card.tags, card.color_category, card.notes]
    );
  }

  return getDeckById(newDeck.id, userId);
}

/**
 * Cards with what the format rules need: legalities, leadership skills and the lowest rarity the
 * card was ever printed at (for pauper-style cube pools).
 */
function cardsForValidation(deckId) {
  return db.all(
    `SELECT
      dc.quantity,
      dc.is_commander,
      COALESCE(dc.board_type, CASE WHEN dc.is_sideboard = 1 THEN 'sideboard' ELSE 'mainboard' END) as board_type,
      c.id as card_id,
      c.name,
      c.type_line,
      c.oracle_text,
      c.color_identity,
      c.legalities,
      c.leadership_skills,
      p.rarity,
      p.image_url,
      (SELECT CASE MIN(${RARITY_RANK_SQL}) WHEN 0 THEN 'common' WHEN 1 THEN 'uncommon' WHEN 2 THEN 'rare' WHEN 3 THEN 'mythic' ELSE NULL END
         FROM printings lp WHERE lp.card_id = c.id) as lowest_rarity
     FROM deck_cards dc
     JOIN printings p ON dc.printing_id = p.id
     JOIN cards c ON p.card_id = c.id
     WHERE dc.deck_id = ?`,
    [deckId]
  );
}

/** The admin-maintained Canadian Highlander points list. */
export function getPointsList() {
  return parsePointsList(getSettings().canlanderPoints || '');
}

function validationOptions(deck, userId, formatId) {
  const settings = parseSettings(deck.settings);
  const options = { ...settings, pointsList: getPointsList() };
  if (formatId === 'twoheadedgiant' && settings.teammateDeckId && Number(settings.teammateDeckId) !== Number(deck.id)) {
    const teammate = db.get(`SELECT id FROM decks WHERE id = ? AND user_id = ?`, [settings.teammateDeckId, userId]);
    if (teammate) options.teammateCards = cardsForValidation(teammate.id);
  }
  return options;
}

/**
 * Check a deck against a format: card legality, deck size, copy limits, commanders, color
 * identity, points and so on (see shared/formats.js). The format defaults to the deck's own.
 */
export function checkDeckLegality(deckId, userId, format) {
  const deck = db.get(`SELECT id, format, settings FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) {
    throw new Error('Deck not found or access denied');
  }
  const formatId = format || deck.format;
  // Only the deck's own format uses its saved options (2HG card pool, cube settings)
  const options = formatId === deck.format ? validationOptions(deck, userId, formatId) : { pointsList: getPointsList() };
  return validateDeck(cardsForValidation(deckId), formatId, options);
}

/**
 * Which formats is this deck legal in? Checks every constructed, commander and highlander format.
 */
export function checkAllFormats(deckId, userId) {
  const deck = db.get(`SELECT id, format, settings FROM decks WHERE id = ? AND user_id = ?`, [deckId, userId]);
  if (!deck) {
    throw new Error('Deck not found or access denied');
  }
  const cards = cardsForValidation(deckId);
  const pointsList = getPointsList();
  return FORMATS
    .filter((f) => !f.isCube && f.id !== 'limited' && !f.baseFormat)
    .map((f) => {
      const result = validateDeck(cards, f.id, { pointsList });
      return {
        format: f.id,
        label: f.label,
        group: f.group,
        isLegal: result.isLegal,
        errors: result.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      };
    });
}

import db from '../db/connection.js';
import { DEFAULT_PRINTING_ORDER_SQL } from './pricingService.js';
import { isCubeFormat, DEFAULT_CUBE_SETTINGS } from '../../shared/formats.js';

/**
 * Split one CSV line into fields, honoring quotes ("a, b" and doubled "" escapes).
 */
export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/** Split CSV text into records, keeping newlines that sit inside quotes. */
function csvRecords(text) {
  const records = [];
  let current = '';
  let quotes = 0;
  for (const line of text.split(/\r?\n/)) {
    current = current ? `${current}\n${line}` : line;
    quotes += (line.match(/"/g) || []).length;
    if (quotes % 2 === 0) {
      if (current.trim()) records.push(current);
      current = '';
      quotes = 0;
    }
  }
  if (current.trim()) records.push(current);
  return records;
}

const CUBECOBRA_CATEGORIES = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  multicolored: 'M', multicolor: 'M', gold: 'M', hybrid: 'H', colorless: 'C', lands: 'L', land: 'L',
};

/** Does this look like a CSV with a header row (CubeCobra, or our own CSV export)? */
export function looksLikeCsv(text) {
  const first = (text || '').trim().split(/\r?\n/)[0] || '';
  const header = parseCsvLine(first).map((h) => h.toLowerCase());
  return header.includes('name') && header.length >= 3;
}

/**
 * Parse a CSV deck or cube. Understands CubeCobra's columns (name, Set, Collector Number,
 * Color Category, tags, Notes, maybeboard) and Deck Lotus's own CSV (Count, Board).
 * Every row of a CubeCobra file is one copy; rows of the same card are summed later.
 */
export function parseCsvDeckList(text) {
  const [headerLine, ...rows] = csvRecords(text.trim());
  const header = parseCsvLine(headerLine).map((h) => h.toLowerCase());
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const idx = {
    name: col('name', 'card name'),
    count: col('count', 'quantity', 'qty'),
    set: col('set', 'set code', 'edition'),
    number: col('collector number', 'collector_number', 'number'),
    category: col('color category', 'color_category'),
    tags: col('tags', 'tag'),
    notes: col('notes', 'note'),
    maybe: col('maybeboard'),
    board: col('board'),
  };
  if (idx.name < 0) return [];

  const cards = [];
  for (const record of rows) {
    const f = parseCsvLine(record);
    const name = f[idx.name];
    if (!name) continue;
    const quantity = idx.count >= 0 ? parseInt(f[idx.count], 10) || 1 : 1;
    const boardField = (idx.board >= 0 ? f[idx.board] : '').toLowerCase();
    const isMaybe = (idx.maybe >= 0 && /^(true|1|yes)$/i.test(f[idx.maybe])) || boardField === 'maybeboard';
    const category = idx.category >= 0 ? CUBECOBRA_CATEGORIES[(f[idx.category] || '').toLowerCase()] || null : null;
    const tags = idx.tags >= 0 && f[idx.tags] ? f[idx.tags].split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
    cards.push({
      quantity,
      name,
      setCode: idx.set >= 0 && f[idx.set] ? f[idx.set].toUpperCase() : null,
      collectorNumber: idx.number >= 0 && f[idx.number] ? f[idx.number] : null,
      isFoil: false,
      isSideboard: boardField === 'sideboard',
      isCommander: boardField === 'commander',
      boardType: isMaybe ? 'maybeboard' : boardField === 'sideboard' ? 'sideboard' : 'mainboard',
      tags,
      colorCategory: category,
      notes: idx.notes >= 0 ? f[idx.notes] || null : null,
    });
  }
  return cards;
}

/**
 * Parse deck list from various formats
 * Supports: Moxfield, Arena, MTGO, plain text, and CSV (CubeCobra or Deck Lotus)
 */
export function parseDeckList(text) {
  if (looksLikeCsv(text)) return parseCsvDeckList(text);

  const lines = text.trim().split('\n').filter(line => line.trim());
  const cards = [];
  let currentSection = 'mainboard'; // mainboard, sideboard, maybeboard, commander

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) continue;

    // Check for section headers ("Sideboard", "SIDEBOARD:", "Maybeboard", "Considering", ...)
    if (/^(sideboard|commander|deck|companion|maybeboard|maybe|considering|mainboard|main)\b\s*:?\s*(\(\d+\))?$/i.test(trimmedLine)) {
      if (/^sideboard/i.test(trimmedLine)) currentSection = 'sideboard';
      else if (/^commander/i.test(trimmedLine)) currentSection = 'commander';
      else if (/^(maybe|considering)/i.test(trimmedLine)) currentSection = 'maybeboard';
      else if (/^companion/i.test(trimmedLine)) currentSection = 'sideboard';
      else currentSection = 'mainboard';
      continue;
    }

    // Parse card line. A cube list is often one name per line with no count.
    const parsed = parseCardLine(trimmedLine) || parseCardLine(`1 ${trimmedLine}`);
    if (parsed) {
      cards.push({
        ...parsed,
        isSideboard: currentSection === 'sideboard',
        isCommander: currentSection === 'commander',
        boardType: currentSection === 'commander' ? 'mainboard' : currentSection,
      });
    }
  }

  return cards;
}

/**
 * Parse a single card line
 * Supports formats:
 * - "1 Card Name" (plain text)
 * - "1 Card Name (SET) 123" (Moxfield)
 * - "1 Card Name (SET) 123 *F*" (Moxfield with foil)
 * - "1 Card Name [SET]" (TCGplayer)
 */
function parseCardLine(line) {
  // Remove leading/trailing whitespace
  line = line.trim();

  // Match quantity at start ("4 Bolt" or "4x Bolt")
  const quantityMatch = line.match(/^(\d+)x?\s+(.+)$/i);
  if (!quantityMatch) return null;

  const quantity = parseInt(quantityMatch[1]);
  let remainder = quantityMatch[2];

  // Check for foil marker
  const isFoil = remainder.includes('*F*');
  remainder = remainder.replace(/\*F\*/g, '').trim();

  // Extract set code and collector number (Moxfield format)
  let setCode = null;
  let collectorNumber = null;
  let cardName = remainder;

  // Moxfield format: "Card Name (SET) 123" or "Card Name (SET) ABC-123"
  // Collector numbers can carry symbols, e.g. "46★" for promos, so take any non-space run
  const moxfieldMatch = remainder.match(/^(.+?)\s*\(([A-Z0-9]+)\)\s*(\S+)?$/i);
  if (moxfieldMatch) {
    cardName = moxfieldMatch[1].trim();
    setCode = moxfieldMatch[2].toUpperCase();
    collectorNumber = moxfieldMatch[3] || null;
  } else {
    // TCGplayer format: "Card Name [SET]"
    const tcgMatch = remainder.match(/^(.+?)\s*\[([A-Z0-9]+)\]$/i);
    if (tcgMatch) {
      cardName = tcgMatch[1].trim();
      setCode = tcgMatch[2].toUpperCase();
    }
  }

  return {
    quantity,
    name: cardName,
    setCode,
    collectorNumber,
    isFoil
  };
}

/**
 * Normalize card name for database lookup
 * Handles DFC (double-faced card) separator differences between sources
 */
function normalizeCardName(name) {
  // Convert single slash with spaces to double slash (Moxfield -> MTGJSON format)
  // Example: "Kefka, Court Mage / Kefka, Ruler of Ruin" -> "Kefka, Court Mage // Kefka, Ruler of Ruin"
  return name.replace(/\s\/\s/g, ' // ');
}

/**
 * Find card in database by name and optional set/collector number
 */
export function findCard(name, setCode = null, collectorNumber = null) {
  // Normalize the card name for consistent matching
  const normalizedName = normalizeCardName(name);

  // Try exact match with set and collector number
  if (setCode && collectorNumber) {
    const card = db.get(
      `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
       FROM cards c
       JOIN printings p ON c.id = p.card_id
       WHERE c.name = ? AND p.set_code = ? AND p.collector_number = ?
       LIMIT 1`,
      [normalizedName, setCode, collectorNumber]
    );
    if (card) return card;

    // Fallback: Try matching as front face of DFC with set and collector number
    const dfcCard = db.get(
      `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
       FROM cards c
       JOIN printings p ON c.id = p.card_id
       WHERE c.name LIKE ? AND p.set_code = ? AND p.collector_number = ?
       LIMIT 1`,
      [normalizedName + ' //%', setCode, collectorNumber]
    );
    if (dfcCard) return dfcCard;
  }

  // Try match with set only
  if (setCode) {
    const card = db.get(
      `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
       FROM cards c
       JOIN printings p ON c.id = p.card_id
       WHERE c.name = ? AND p.set_code = ?
       ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
       LIMIT 1`,
      [normalizedName, setCode]
    );
    if (card) return card;

    // Fallback: Try matching as front face of DFC with set only
    const dfcCard = db.get(
      `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
       FROM cards c
       JOIN printings p ON c.id = p.card_id
       WHERE c.name LIKE ? AND p.set_code = ?
       ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
       LIMIT 1`,
      [normalizedName + ' //%', setCode]
    );
    if (dfcCard) return dfcCard;
  }

  // Fall back to name-only search
  const card = db.get(
    `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
     FROM cards c
     JOIN printings p ON c.id = p.card_id
     WHERE c.name = ?
     ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
     LIMIT 1`,
    [normalizedName]
  );
  if (card) return card;

  // Final fallback: Try matching as front face of DFC (name only)
  const dfcCard = db.get(
    `SELECT c.id, c.name, p.id as printing_id, p.set_code, p.collector_number
     FROM cards c
     JOIN printings p ON c.id = p.card_id
     WHERE c.name LIKE ?
     ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
     LIMIT 1`,
    [normalizedName + ' //%']
  );

  return dfcCard;
}

/**
 * Import deck from parsed card list. Lines that resolve to the same printing and board are
 * summed, since a deck holds each printing once per board.
 */
export function importDeck(userId, deckName, format, cardList) {
  const settings = isCubeFormat(format) ? JSON.stringify(DEFAULT_CUBE_SETTINGS) : null;
  const result = db.prepare(
    `INSERT INTO decks (user_id, name, format, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(userId, deckName, format || '', settings);

  const deckId = result.lastInsertRowid;
  const logHistory = isCubeFormat(format);

  const findRow = db.prepare(`SELECT id, board_type FROM deck_cards WHERE deck_id = ? AND printing_id = ? AND is_sideboard = ?`);
  const insertCard = db.prepare(
    `INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander, board_type, tags, color_category, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Another printing of the same card that this board doesn't use yet
  const otherPrinting = db.prepare(
    `SELECT p.id FROM printings p
     WHERE p.card_id = (SELECT card_id FROM printings WHERE id = ?)
       AND p.id NOT IN (SELECT printing_id FROM deck_cards WHERE deck_id = ? AND is_sideboard = ?)
     ORDER BY ${DEFAULT_PRINTING_ORDER_SQL}
     LIMIT 1`
  );
  const addCopies = db.prepare(`UPDATE deck_cards SET quantity = quantity + ?, is_commander = MAX(is_commander, ?) WHERE id = ?`);
  const logChange = db.prepare(`INSERT INTO deck_changes (deck_id, action, card_name, quantity, board_type) VALUES (?, 'add', ?, ?, ?)`);

  let imported = 0;
  let notFound = 0;
  const missing = [];

  db.transaction(() => {
    for (const cardData of cardList) {
      const card = findCard(cardData.name, cardData.setCode, cardData.collectorNumber);
      if (!card) {
        notFound++;
        if (missing.length < 50) missing.push(cardData.name);
        continue;
      }

      const boardType = cardData.boardType || (cardData.isSideboard ? 'sideboard' : 'mainboard');
      const isSideboard = boardType === 'sideboard' ? 1 : 0;
      const tags = cardData.tags?.length ? JSON.stringify([...new Set(cardData.tags)].slice(0, 30)) : null;
      let printingId = card.printing_id;
      let existing = findRow.get(deckId, printingId, isSideboard);
      if (existing && existing.board_type !== boardType) {
        // Mainboard and maybeboard can't share a printing, so use another one of the same card
        const alt = otherPrinting.get(printingId, deckId, isSideboard);
        if (alt) {
          printingId = alt.id;
          existing = null;
        }
      }
      if (existing) {
        addCopies.run(cardData.quantity, cardData.isCommander ? 1 : 0, existing.id);
      } else {
        insertCard.run(deckId, printingId, cardData.quantity, isSideboard, cardData.isCommander ? 1 : 0, boardType, tags, cardData.colorCategory || null, cardData.notes || null);
      }
      if (logHistory) logChange.run(deckId, card.name, cardData.quantity, boardType);
      imported += cardData.quantity;
    }
  });

  return { deckId, imported, notFound, missing };
}

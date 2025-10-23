import db from '../db/connection.js';

/**
 * Parse deck list from various formats
 * Supports: Moxfield, Arena, MTGO, plain text
 */
export function parseDeckList(text) {
  const lines = text.trim().split('\n').filter(line => line.trim());
  const cards = [];
  let currentSection = 'mainboard'; // mainboard, sideboard, commander

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Check for section headers
    if (/^(sideboard|commander|deck|companion)/i.test(trimmedLine)) {
      if (/^sideboard/i.test(trimmedLine)) currentSection = 'sideboard';
      if (/^commander/i.test(trimmedLine)) currentSection = 'commander';
      if (/^deck/i.test(trimmedLine)) currentSection = 'mainboard';
      continue;
    }

    // Parse card line
    const parsed = parseCardLine(trimmedLine);
    if (parsed) {
      cards.push({
        ...parsed,
        isSideboard: currentSection === 'sideboard',
        isCommander: currentSection === 'commander'
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

  // Match quantity at start
  const quantityMatch = line.match(/^(\d+)\s+(.+)$/);
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
  const moxfieldMatch = remainder.match(/^(.+?)\s*\(([A-Z0-9]+)\)\s*([A-Z0-9\-]+)?$/i);
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
     LIMIT 1`,
    [normalizedName + ' //%']
  );

  return dfcCard;
}

/**
 * Import deck from parsed card list
 */
export function importDeck(userId, deckName, format, cardList) {
  // Create deck
  const result = db.prepare(
    `INSERT INTO decks (user_id, name, format, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(userId, deckName, format || '');

  const deckId = result.lastInsertRowid;

  // Add cards to deck
  const insertCard = db.prepare(
    `INSERT INTO deck_cards (deck_id, printing_id, quantity, is_sideboard, is_commander)
     VALUES (?, ?, ?, ?, ?)`
  );

  // Process each card in the list
  let imported = 0;
  let notFound = 0;

  for (const cardData of cardList) {
    const card = findCard(cardData.name, cardData.setCode, cardData.collectorNumber);

    if (card) {
      insertCard.run(
        deckId,
        card.printing_id,
        cardData.quantity,
        cardData.isSideboard ? 1 : 0,
        cardData.isCommander ? 1 : 0
      );
      imported++;
    } else {
      notFound++;
      console.warn(`Card not found: ${cardData.name}${cardData.setCode ? ` (${cardData.setCode})` : ''}${cardData.collectorNumber ? ` ${cardData.collectorNumber}` : ''}`);
    }
  }

  return { deckId, imported, notFound };
}

# MTGJSON Data Enhancement Guide

This document outlines how to add additional MTGJSON data features to Deck Lotus. Each section provides complete implementation details for adding specific features.

## Overview

MTGJSON provides rich card data that we're not currently utilizing. This guide covers how to import and display:
1. Legalities (format legality)
2. Subtypes, Supertypes, Types (as separate fields)
3. Related Cards (tokens, meld pairs)
4. Leadership Skills (Commander compatibility)
5. Card Identifiers (cross-platform IDs)

## Current State

### What We Already Import
- ✅ Basic card data (name, mana cost, colors, type_line, oracle text, power/toughness, loyalty)
- ✅ Printings (set code, collector number, rarity, artist, image URLs)
- ✅ Purchase URLs (TCGPlayer, Cardmarket, Card Kingdom)
- ✅ Pricing data (TCGPlayer, Cardmarket, Card Kingdom)
- ✅ Rulings
- ✅ Sets metadata

### What We're Missing
- ❌ Legalities (Standard, Modern, Commander, etc.)
- ❌ Subtypes/Supertypes/Types as separate arrays
- ❌ Related cards (tokens created, meld pairs)
- ❌ Leadership skills (Commander color identity)
- ❌ Card identifiers (Scryfall ID, MTGO ID, TCGPlayer Product ID)

## 1. Adding Legalities

### Database Schema Change

Create migration: `src/db/migrations/004-add-legalities.js`

```javascript
export function up(db) {
  // Add legalities column to cards table
  db.exec(`
    ALTER TABLE cards ADD COLUMN legalities TEXT;
  `);

  console.log('✓ Added legalities column to cards table');
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN easily, so recreate table
  db.exec(`
    CREATE TABLE cards_backup AS SELECT
      id, name, mana_cost, cmc, colors, color_identity,
      type_line, oracle_text, power, toughness, loyalty,
      keywords, is_reserved, edhrec_rank
    FROM cards;

    DROP TABLE cards;

    ALTER TABLE cards_backup RENAME TO cards;
  `);

  console.log('✓ Removed legalities column from cards table');
}
```

### Import Script Changes

Update `scripts/import-mtgjson.js`:

```javascript
// In the importCards function, update the SELECT query:
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT name, manaCost, manaValue, colors, colorIdentity,
         type, text, power, toughness, loyalty, keywords,
         isReserved, edhrecRank, legalities
  FROM cards
  WHERE name IS NOT NULL
`).all();

// Update the INSERT statement:
const insertCard = targetDb.prepare(`
  INSERT OR IGNORE INTO cards (
    name, mana_cost, cmc, colors, color_identity,
    type_line, oracle_text, power, toughness, loyalty,
    keywords, legalities, is_reserved, edhrec_rank
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// In the insertMany transaction, parse legalities JSON:
const insertMany = targetDb.transaction((cards) => {
  for (const card of cards) {
    // ... existing color/keyword parsing ...

    let legalities = null;
    try {
      if (card.legalities) {
        const legalObj = typeof card.legalities === 'string'
          ? JSON.parse(card.legalities)
          : card.legalities;
        // Store as JSON string
        legalities = JSON.stringify(legalObj);
      }
    } catch (e) {
      legalities = card.legalities;
    }

    insertCard.run(
      card.name,
      card.manaCost,
      card.manaValue,
      colors,
      colorIdentity,
      card.type,
      card.text,
      card.power,
      card.toughness,
      card.loyalty,
      keywords,
      legalities,  // Add this
      card.isReserved ? 1 : 0,
      card.edhrecRank
    );
  }
});
```

### Backend Service Changes

No changes needed - legalities will be returned with card data automatically.

### Frontend Display

Update `client/src/components/cards.js` in the `showCardDetail` function:

```javascript
// After the Type/Subtype display, add:
${card.legalities ? `
  <div style="margin-bottom: 1rem;">
    <strong>Legal In:</strong>
    <div style="margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
      ${(() => {
        const legalities = JSON.parse(card.legalities);
        const legalFormats = Object.entries(legalities)
          .filter(([_, status]) => status === 'Legal')
          .map(([format, _]) => format);

        return legalFormats.length > 0
          ? legalFormats.map(format => `
              <span style="
                padding: 0.25rem 0.5rem;
                background: var(--success, #10b981);
                color: white;
                border-radius: 4px;
                font-size: 0.875rem;
                text-transform: capitalize;
              ">${format}</span>
            `).join('')
          : '<span style="color: var(--text-secondary);">Not legal in any format</span>';
      })()}
    </div>
  </div>
` : ''}
```

### MTGJSON Legalities Format

Legalities are stored as a JSON object:
```json
{
  "commander": "Legal",
  "duel": "Legal",
  "legacy": "Legal",
  "modern": "Legal",
  "vintage": "Legal",
  "standard": "Not Legal",
  "pioneer": "Banned"
}
```

Possible values: `"Legal"`, `"Not Legal"`, `"Banned"`, `"Restricted"`

---

## 2. Adding Subtypes, Supertypes, Types

### Database Schema Change

Create migration: `src/db/migrations/005-add-type-arrays.js`

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN subtypes TEXT;
    ALTER TABLE cards ADD COLUMN supertypes TEXT;
    ALTER TABLE cards ADD COLUMN types TEXT;
  `);

  console.log('✓ Added type fields to cards table');
}

export function down(db) {
  // Similar to legalities - recreate table without these columns
}
```

### Import Script Changes

```javascript
// Update SELECT:
const sourceCards = srcDb.prepare(`
  SELECT DISTINCT name, manaCost, manaValue, colors, colorIdentity,
         type, text, power, toughness, loyalty, keywords,
         isReserved, edhrecRank, legalities,
         subtypes, supertypes, types
  FROM cards
  WHERE name IS NOT NULL
`).all();

// Update INSERT:
const insertCard = targetDb.prepare(`
  INSERT OR IGNORE INTO cards (
    name, mana_cost, cmc, colors, color_identity,
    type_line, oracle_text, power, toughness, loyalty,
    keywords, legalities, is_reserved, edhrec_rank,
    subtypes, supertypes, types
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// In transaction, parse arrays:
let subtypes = null, supertypes = null, types = null;
try {
  if (card.subtypes) subtypes = Array.isArray(card.subtypes)
    ? card.subtypes.join(',')
    : JSON.parse(card.subtypes).join(',');
} catch (e) { subtypes = card.subtypes; }

try {
  if (card.supertypes) supertypes = Array.isArray(card.supertypes)
    ? card.supertypes.join(',')
    : JSON.parse(card.supertypes).join(',');
} catch (e) { supertypes = card.supertypes; }

try {
  if (card.types) types = Array.isArray(card.types)
    ? card.types.join(',')
    : JSON.parse(card.types).join(',');
} catch (e) { types = card.types; }

insertCard.run(
  // ... existing fields ...
  subtypes, supertypes, types
);
```

### Frontend Display

We're already parsing from `type_line`, but with separate fields we can enhance filtering:

```javascript
// In the card modal, replace the type parsing with:
const supertypes = card.supertypes ? card.supertypes.split(',') : [];
const types = card.types ? card.types.split(',') : [];
const subtypes = card.subtypes ? card.subtypes.split(',') : [];

// Display:
${supertypes.length > 0 ? `
  <div style="margin-bottom: 1rem;">
    <strong>Supertypes:</strong> ${supertypes.join(', ')}
  </div>
` : ''}
<div style="margin-bottom: 1rem;">
  <strong>Type:</strong> ${types.join(', ') || 'Unknown'}
</div>
${subtypes.length > 0 ? `
  <div style="margin-bottom: 1rem;">
    <strong>Subtypes:</strong> ${subtypes.join(', ')}
  </div>
` : ''}
```

---

## 3. Adding Related Cards

### Database Schema Change

Create migration: `src/db/migrations/006-add-related-cards.js`

```javascript
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS related_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL,
      related_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      FOREIGN KEY (card_name) REFERENCES cards(name) ON DELETE CASCADE
    );
    CREATE INDEX idx_related_cards_name ON related_cards(card_name);
  `);

  console.log('✓ Created related_cards table');
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS related_cards;`);
}
```

### Import Script Changes

Add after rulings import:

```javascript
// Import related cards
console.log('Importing related cards...');
const relatedCards = srcDb.prepare(`
  SELECT name, reverseRelated
  FROM cards
  WHERE reverseRelated IS NOT NULL
`).all();

const insertRelated = targetDb.prepare(`
  INSERT OR IGNORE INTO related_cards (card_name, related_name, relation_type)
  VALUES (?, ?, ?)
`);

const insertRelatedMany = targetDb.transaction((relations) => {
  for (const card of relations) {
    try {
      const related = typeof card.reverseRelated === 'string'
        ? JSON.parse(card.reverseRelated)
        : card.reverseRelated;

      if (Array.isArray(related)) {
        for (const relatedName of related) {
          insertRelated.run(card.name, relatedName, 'reverse');
        }
      }
    } catch (e) {
      console.error(`Failed to parse reverseRelated for ${card.name}`);
    }
  }
});

insertRelatedMany(relatedCards);
console.log(`✓ Imported related cards`);
```

### Backend Service Changes

Update `src/services/cardService.js`:

```javascript
export function getCardById(cardId) {
  const card = db.get(`SELECT * FROM cards WHERE id = ?`, [cardId]);

  if (!card) return null;

  const printings = db.all(/* existing query */);
  const rulings = /* existing query */;

  // Get related cards
  const relatedCards = db.all(
    `SELECT related_name, relation_type
     FROM related_cards
     WHERE card_name = ?`,
    [card.name]
  );

  return {
    ...card,
    printings,
    rulings,
    relatedCards,
  };
}
```

### Frontend Display

```javascript
${card.relatedCards && card.relatedCards.length > 0 ? `
  <div style="margin-top: 2rem;">
    <h3>Related Cards</h3>
    <div style="margin-top: 1rem; display: grid; gap: 0.5rem;">
      ${card.relatedCards.map(r => `
        <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 6px;">
          <strong>${r.related_name}</strong>
          <span style="margin-left: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">
            (${r.relation_type === 'reverse' ? 'Token/Related' : r.relation_type})
          </span>
        </div>
      `).join('')}
    </div>
  </div>
` : ''}
```

---

## 4. Adding Leadership Skills

### Database Schema Change

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE cards ADD COLUMN leadership_skills TEXT;
  `);
}
```

### Import and Display

```javascript
// Import:
SELECT /* ... */, leadershipSkills FROM cards

// Parse as JSON object with properties:
// - brawl: boolean
// - commander: boolean
// - oathbreaker: boolean

// Display:
${card.leadership_skills ? `
  <div style="margin-bottom: 1rem;">
    <strong>Can Be Commander:</strong>
    ${(() => {
      const skills = JSON.parse(card.leadership_skills);
      const formats = [];
      if (skills.commander) formats.push('Commander');
      if (skills.brawl) formats.push('Brawl');
      if (skills.oathbreaker) formats.push('Oathbreaker');
      return formats.length > 0 ? formats.join(', ') : 'No';
    })()}
  </div>
` : ''}
```

---

## 5. Adding Card Identifiers

### Database Schema

The `cardIdentifiers` table in MTGJSON has:
- `uuid` (PRIMARY KEY)
- `scryfallId`
- `scryfallOracleId`
- `scryfallIllustrationId`
- `mtgoId`
- `mtgoFoilId`
- `tcgplayerProductId`
- `cardKingdomId`

Add to printings table:

```javascript
export function up(db) {
  db.exec(`
    ALTER TABLE printings ADD COLUMN scryfall_id TEXT;
    ALTER TABLE printings ADD COLUMN mtgo_id INTEGER;
    ALTER TABLE printings ADD COLUMN tcgplayer_product_id INTEGER;
    ALTER TABLE printings ADD COLUMN cardkingdom_id INTEGER;

    CREATE INDEX idx_printings_scryfall_id ON printings(scryfall_id);
  `);
}
```

### Import Changes

```javascript
// Update printings SELECT:
SELECT c.uuid, c.name, c.setCode, c.number, c.rarity, c.artist,
       c.flavorText, c.finishes, c.isPromo, c.isFullArt,
       c.frameVersion, c.borderColor, c.watermark,
       ci.scryfallId, ci.mtgoId, ci.tcgplayerProductId, ci.cardKingdomId
FROM cards c
LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid

// Update INSERT to include these IDs
```

### Use Cases

With these IDs you can:
- Link directly to Scryfall: `https://scryfall.com/card/{scryfallId}`
- Link to MTGO: `https://www.mtgo.com/card/{mtgoId}`
- Direct TCGPlayer product link
- Direct Card Kingdom product link

---

## Testing Checklist

After implementing any feature:

1. ✅ Delete existing database: `rm data/deck-lotus.db`
2. ✅ Restart container to run migrations and reimport
3. ✅ Check Docker logs for import success
4. ✅ Test card detail modal shows new data
5. ✅ Verify data is correct by comparing to Scryfall/MTGJSON

---

## Common Pitfalls

1. **JSON Parsing**: MTGJSON stores arrays as JSON strings, always try-catch parse attempts
2. **Column Order**: Make sure INSERT statement column order matches VALUES order
3. **NULL Handling**: Many fields are optional, check for NULL before parsing
4. **SQLite ALTER TABLE**: Can't drop columns easily, must recreate table for down migrations
5. **Transaction Performance**: Wrap bulk inserts in transactions for 100x speed improvement

---

## Performance Notes

- Each new column adds minimal overhead (~1-2% query time)
- Related cards table is small (< 50k rows typically)
- JSON parsing on frontend is negligible for single card views
- Consider indexing frequently queried fields (scryfall_id, etc.)

---

## Reference Links

- [MTGJSON Documentation](https://mtgjson.com/data-models/)
- [MTGJSON SQLite Structure](https://mtgjson.com/file-models/)
- [Card (Atomic) Model](https://mtgjson.com/data-models/card/atomic/)
- [Legalities Format](https://mtgjson.com/data-models/legalities/)
- [Related Cards](https://mtgjson.com/data-models/related-cards/)
